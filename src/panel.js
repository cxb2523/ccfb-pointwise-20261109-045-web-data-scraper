const output = document.getElementById("output");
const copyBtn = document.getElementById("copyBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusEl = document.getElementById("status");

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs[0];
}

async function extractPageText() {
  statusEl.textContent = "Loading...";
  output.value = "";

  try {
    const tab = await getActiveTab();

    if (!tab || !tab.id) {
      output.value = "";
      statusEl.textContent = "No active tab found.";
      return;
    }

    if (tab.url && (
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("edge://") ||
      tab.url.startsWith("about:") ||
      tab.url.startsWith("chrome-extension://")
    )) {
      output.value = "";
      statusEl.textContent = "This page does not allow script injection.";
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
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
          if (rect.width === 0 && rect.height === 0) {
            return true;
          }

          return false;
        };

        const shouldSkipNode = (node) => {
          let el = node.parentElement;

          while (el) {
            if (SKIP_TAGS.has(el.tagName)) return true;

            if (
              el.matches?.(
                "pre, code, samp, kbd, script, style, noscript, template"
              )
            ) {
              return true;
            }

            if (el.getAttribute?.("aria-hidden") === "true") return true;
            if (el.hidden) return true;
            if (isHidden(el)) return true;

            el = el.parentElement;
          }

          return false;
        };

        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const text = node.nodeValue?.replace(/\s+/g, " ").trim();
              if (!text) return NodeFilter.FILTER_REJECT;
              if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        const parts = [];
        let currentNode;

        while ((currentNode = walker.nextNode())) {
          const text = currentNode.nodeValue.replace(/\s+/g, " ").trim();
          if (text) parts.push(text);
        }

        const fullText = parts
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        return fullText;
      }
    });

    const text = results?.[0]?.result || "";
    output.value = text;

    if (text) {
      statusEl.textContent = `Done. ${text.length.toLocaleString()} characters extracted.`;
    } else {
      statusEl.textContent = "No visible text found on this page.";
    }
  } catch (error) {
    console.error(error);
    output.value = "";
    statusEl.textContent = "Failed to extract text from this page.";
  }
}

async function copyText() {
  const text = output.value;

  if (!text) {
    statusEl.textContent = "Nothing to copy.";
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = "Copied to clipboard.";
  } catch (error) {
    try {
      output.focus();
      output.select();
      document.execCommand("copy");
      statusEl.textContent = "Copied to clipboard.";
    } catch (fallbackError) {
      console.error(fallbackError);
      statusEl.textContent = "Copy failed.";
    }
  }
}

copyBtn.addEventListener("click", copyText);
refreshBtn.addEventListener("click", extractPageText);

document.addEventListener("DOMContentLoaded", extractPageText);