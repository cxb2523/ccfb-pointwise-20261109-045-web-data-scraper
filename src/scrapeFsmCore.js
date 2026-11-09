/**
 * Pure, browser-free core of the paginated/scroll scrape state machine.
 *
 * No chrome.* or DOM APIs are used anywhere in this file. background.js loads it
 * via importScripts() inside the service worker and supplies real browser-backed
 * hooks (capture/advance/waitStable/isCancelled). src/test/*.test.js loads it via
 * require() in plain Node and supplies simulated hooks over in-memory arrays, so
 * the exact same transition/dedup logic that ships in the extension is what gets
 * exercised by the unit tests - no duplicated "test version" of the FSM.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;
  }
  if (root) {
    root.ScrapeFsmCore = mod;
  }
})(
  typeof self !== "undefined"
    ? self
    : typeof globalThis !== "undefined"
    ? globalThis
    : null,
  function () {
    "use strict";

    var STATES = Object.freeze({
      CAPTURE: "CAPTURE",
      MERGE: "MERGE",
      CHECK_NEXT: "CHECK_NEXT",
      ADVANCE: "ADVANCE",
      WAIT_STABLE: "WAIT_STABLE",
      DONE: "DONE",
      ABORTED: "ABORTED"
    });

    var REASONS = Object.freeze({
      LIMIT: "limit",
      EXHAUSTED: "exhausted",
      TIMEOUT: "timeout",
      CANCELLED: "cancelled"
    });

    function normalizeValue(value) {
      if (value === null || value === undefined) return "";
      return String(value).replace(/\s+/g, " ").trim();
    }

    // Sorted key=value join so the hash only depends on an item's own field
    // combination, never on where it currently sits in an array. This is what
    // keeps dedup correct across DOM reflows during scroll capture: an item that
    // gets re-ordered by the page's virtualization still normalizes to the same
    // string, while two different items (even with the same keys in a different
    // insertion order) still collide only if their actual content matches.
    function stableStringify(item) {
      var obj = item || {};
      var keys = Object.keys(obj).sort();
      var parts = new Array(keys.length);
      for (var i = 0; i < keys.length; i++) {
        parts[i] = keys[i] + "=" + normalizeValue(obj[keys[i]]);
      }
      return parts.join("");
    }

    // FNV-1a 32-bit. No crypto dependency, deterministic across Node and the
    // content-script sandbox, and more than sufficient collision resistance for
    // the per-session item counts this extension deals with.
    function hashString(str) {
      var hash = 0x811c9dc5;
      for (var i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function computeItemHash(item) {
      return hashString(stableStringify(item));
    }

    /**
     * Single source of truth for which terminal reason wins when more than one
     * condition is true at the same checkpoint. Priority: timeout > exhausted > limit.
     *
     * Why this order, not another one:
     *  - timeout first: a WAIT_STABLE timeout means the DOM never confirmed it had
     *    settled after the last advance. We cannot trust whatever the counters say
     *    at that point (pageCount may have been bumped for a page we never actually
     *    got a clean read of), so an unstable render must always be reported as an
     *    interruption, never silently relabelled as a tidy "limit" or "exhausted"
     *    finish that would wrongly imply the collected data is complete.
     *  - exhausted second: hitting maxIdleRounds means several consecutive rounds
     *    of confirmed-stable, confirmed-read pages produced zero new items - a
     *    confident, content-driven signal that we reached the real end of the list.
     *    That is strictly more informative than an arbitrary page-count ceiling, so
     *    it should be reported over "limit" whenever both are true at once.
     *  - limit last: maxPages is just a safety cap chosen by the caller, not a
     *    statement about the data itself. It only gets to be the reported reason
     *    when nothing more specific (timeout/exhausted) explains the stop.
     */
    function decideTerminalReason(ctx) {
      if (ctx.waitTimedOut) return REASONS.TIMEOUT;
      if (ctx.idleRounds >= ctx.maxIdleRounds) return REASONS.EXHAUSTED;
      if (ctx.pageCount >= ctx.maxPages) return REASONS.LIMIT;
      return null;
    }

    /**
     * Runs the CAPTURE -> MERGE -> CHECK_NEXT -> ADVANCE -> WAIT_STABLE -> (loop)
     * state machine to completion (DONE or ABORTED).
     *
     * hooks (all required except onTransition):
     *   capture(): Promise<Array<object>>  - read current page/viewport items
     *   advance(): Promise<void>           - go to next page / scroll further
     *   waitStable(timeoutMs): Promise<{stable: boolean}> - wait for DOM settle
     *   isCancelled(): boolean             - polled at every checkpoint
     *   onTransition(state, meta): void    - optional, for progress UI/tests
     *
     * config: { maxPages, maxIdleRounds, waitTimeoutMs }
     *
     * Returns { status: "DONE"|"ABORTED", reason, items, transitions }.
     */
    async function runScrapeFSM(hooks, config) {
      var maxPages = config.maxPages;
      var maxIdleRounds = config.maxIdleRounds;
      var waitTimeoutMs = config.waitTimeoutMs;

      var seenHashes = new Set();
      var items = [];
      var transitions = [];
      var pageCount = 0;
      var idleRounds = 0;

      function emit(state, meta) {
        var entry = Object.assign({ state: state }, meta || {});
        transitions.push(entry);
        if (hooks.onTransition) hooks.onTransition(state, meta || {});
      }

      function isCancelled() {
        return Boolean(hooks.isCancelled && hooks.isCancelled());
      }

      function abort(reason) {
        emit(STATES.ABORTED, { reason: reason });
        return {
          status: STATES.ABORTED,
          reason: reason,
          items: items.slice(),
          transitions: transitions
        };
      }

      function done(reason) {
        emit(STATES.DONE, { reason: reason });
        return {
          status: STATES.DONE,
          reason: reason,
          items: items.slice(),
          transitions: transitions
        };
      }

      // Cancellation is checked at every single checkpoint below and always wins
      // over timeout/exhausted/limit, because it is explicit user intent rather
      // than scrape bookkeeping. The check right after capture() (before MERGE
      // runs) is what guarantees a cancelled run never writes a just-captured,
      // not-yet-reconciled batch into the de-dup Set: "cancel" always freezes the
      // result at the last fully merged round, never a partially merged one.
      while (true) {
        if (isCancelled()) return abort(REASONS.CANCELLED);

        pageCount += 1;
        emit(STATES.CAPTURE, { pageCount: pageCount });
        var rawItems = (await hooks.capture()) || [];

        if (isCancelled()) return abort(REASONS.CANCELLED);

        emit(STATES.MERGE, { pageCount: pageCount });
        var added = 0;
        for (var i = 0; i < rawItems.length; i++) {
          var hash = computeItemHash(rawItems[i]);
          if (seenHashes.has(hash)) continue;
          seenHashes.add(hash);
          items.push(rawItems[i]);
          added += 1;
        }
        idleRounds = added === 0 ? idleRounds + 1 : 0;

        emit(STATES.CHECK_NEXT, {
          pageCount: pageCount,
          idleRounds: idleRounds,
          added: added
        });

        if (isCancelled()) return abort(REASONS.CANCELLED);

        var terminal = decideTerminalReason({
          waitTimedOut: false,
          idleRounds: idleRounds,
          maxIdleRounds: maxIdleRounds,
          pageCount: pageCount,
          maxPages: maxPages
        });
        if (terminal) return done(terminal);

        if (isCancelled()) return abort(REASONS.CANCELLED);
        emit(STATES.ADVANCE, { pageCount: pageCount });
        await hooks.advance();

        if (isCancelled()) return abort(REASONS.CANCELLED);
        emit(STATES.WAIT_STABLE, { waitTimeoutMs: waitTimeoutMs });
        var waitResult = await hooks.waitStable(waitTimeoutMs);

        if (isCancelled()) return abort(REASONS.CANCELLED);

        var waitTerminal = decideTerminalReason({
          waitTimedOut: !waitResult || !waitResult.stable,
          idleRounds: idleRounds,
          maxIdleRounds: maxIdleRounds,
          pageCount: pageCount,
          maxPages: maxPages
        });
        if (waitTerminal) return abort(waitTerminal);
        // stable and under every limit: loop back to CAPTURE for the next round
      }
    }

    return {
      STATES: STATES,
      REASONS: REASONS,
      computeItemHash: computeItemHash,
      stableStringify: stableStringify,
      hashString: hashString,
      decideTerminalReason: decideTerminalReason,
      runScrapeFSM: runScrapeFSM
    };
  }
);
