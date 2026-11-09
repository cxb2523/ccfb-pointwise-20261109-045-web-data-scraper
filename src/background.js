importScripts("scrapeFsmCore.js");

const { runScrapeFSM } = self.ScrapeFsmCore;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.windowId) return;

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error("Failed to open side panel:", error);
  }
});

// tabId -> { cancelled: boolean }. One scrape session per tab; CANCEL_SCRAPE
// just flips the flag that runScrapeFSM's hooks.isCancelled() polls, it never
// touches the Set/items directly, so there is no "second scrape"/double-write
// race between a cancel request and the FSM's own checkpoints.
const activeScrapeSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "START_SCRAPE") {
    handleStartScrape(message.payload || {}, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: String((error && error.message) || error) })
      );
    return true; // keep the message channel open for the async response
  }

  if (message.type === "CANCEL_SCRAPE") {
    const session = activeScrapeSessions.get(message.tabId);
    if (session) session.cancelled = true;
    sendResponse({ ok: true });
    return undefined;
  }

  return undefined;
});

/**
 * Extends the existing START_SCRAPE payload (unchanged shape otherwise) with
 * maxPages / maxIdleRounds / waitTimeoutMs, and drives runScrapeFSM with hooks
 * backed by chrome.scripting.executeScript against the requesting tab.
 */
async function handleStartScrape(payload, sender) {
  const tabId = payload.tabId ?? sender?.tab?.id;
  if (!tabId) throw new Error("START_SCRAPE requires a target tabId.");

  if (activeScrapeSessions.has(tabId)) {
    throw new Error("A scrape is already running for this tab.");
  }

  const config = {
    maxPages: Number(payload.maxPages) > 0 ? Number(payload.maxPages) : 20,
    maxIdleRounds:
      Number(payload.maxIdleRounds) > 0 ? Number(payload.maxIdleRounds) : 2,
    waitTimeoutMs:
      Number(payload.waitTimeoutMs) > 0 ? Number(payload.waitTimeoutMs) : 8000
  };

  const session = { cancelled: false };
  activeScrapeSessions.set(tabId, session);

  try {
    const hooks = {
      capture: () => captureInTab(tabId),
      advance: () => advanceInTab(tabId),
      waitStable: (timeoutMs) => waitStableInTab(tabId, timeoutMs),
      isCancelled: () => session.cancelled,
      onTransition: (state, meta) => {
        chrome.runtime
          .sendMessage({ type: "SCRAPE_PROGRESS", tabId, state, meta })
          .catch(() => {
            // No listener (panel closed) - progress updates are best-effort only.
          });
      }
    };

    return await runScrapeFSM(hooks, config);
  } finally {
    activeScrapeSessions.delete(tabId);
  }
}

async function captureInTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: capturePageTextItems
  });
  return (results && results[0] && results[0].result) || [];
}

async function advanceInTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: scrollPageForward
  });
}

async function waitStableInTab(tabId, timeoutMs) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: waitForDomStable,
    args: [timeoutMs, 300]
  });
  return (
    (results && results[0] && results[0].result) || { stable: false, elapsedMs: timeoutMs }
  );
}

// Injected into the page. Returns one scrape "item" per visible text block,
// reusing the same visible-text walker the plain Page Text Extractor uses, so
// a scroll/pagination round captures discrete, hashable units instead of one
// whole-page blob (which would never dedupe cleanly round over round).
function capturePageTextItems() {
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "CODE",
    "PRE",
    "SAMP",
    "KBD"
  ]);

  const isHidden = (el) => {
    if (!el) return true;
    const style = window.getComputedStyle(el);

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return true;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return true;

    return false;
  };

  const shouldSkipNode = (node) => {
    let el = node.parentElement;

    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.matches?.("pre, code, samp, kbd, script, style, noscript, template")) {
        return true;
      }
      if (el.getAttribute?.("aria-hidden") === "true") return true;
      if (el.hidden) return true;
      if (isHidden(el)) return true;

      el = el.parentElement;
    }

    return false;
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue?.replace(/\s+/g, " ").trim();
      if (!text) return NodeFilter.FILTER_REJECT;
      if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const items = [];
  let currentNode;

  while ((currentNode = walker.nextNode())) {
    const text = currentNode.nodeValue.replace(/\s+/g, " ").trim();
    if (text) items.push({ text });
  }

  return items;
}

// Injected into the page. Generic, selector-free "advance" step: scrolls to the
// bottom of the document to trigger lazy-loaded content.
function scrollPageForward() {
  const before = window.scrollY;
  window.scrollTo(0, document.body.scrollHeight);
  return { before, after: window.scrollY };
}

// Injected into the page. MutationObserver-driven stability check: resolves
// stable:true once `quietMs` has passed with no DOM mutations, or stable:false
// once `waitTimeoutMs` total has elapsed without ever reaching that quiet
// window. The polling loop here only ever enforces the outer ceiling - it never
// itself declares success - so this is not a disguised fixed sleep.
function waitForDomStable(waitTimeoutMs, quietMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    let settleTimer = null;
    let pollTimer = null;

    const finish = (stable) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(settleTimer);
      clearInterval(pollTimer);
      resolve({ stable, elapsedMs: Date.now() - start });
    };

    const scheduleSettleCheck = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => finish(true), quietMs);
    };

    const observer = new MutationObserver(() => {
      scheduleSettleCheck();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    const pollIntervalMs = Math.min(200, Math.max(50, quietMs));
    pollTimer = setInterval(() => {
      if (Date.now() - start >= waitTimeoutMs) finish(false);
    }, pollIntervalMs);

    // Covers the case where the advance step caused no mutations at all (page
    // was already fully loaded), so the quiet window still gets a chance to
    // elapse and report stable:true instead of always timing out.
    scheduleSettleCheck();
  });
}