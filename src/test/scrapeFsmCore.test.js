"use strict";

// Pure Node unit tests, no browser/chrome APIs involved. Run with:
//   node --test src/test
// (Node's built-in test runner, available since Node 18 - no extra deps.)

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STATES,
  REASONS,
  computeItemHash,
  decideTerminalReason,
  runScrapeFSM
} = require("../scrapeFsmCore.js");

function makeHooks(pages, overrides) {
  let cursor = 0; // index of the page/view currently on screen
  const advanceCalls = [];
  const waitCalls = [];

  const hooks = {
    capture: async () => pages[cursor] || [],
    advance: async () => {
      cursor += 1;
      advanceCalls.push(cursor);
    },
    waitStable: async (timeoutMs) => {
      waitCalls.push(timeoutMs);
      return { stable: true };
    },
    isCancelled: () => false,
    onTransition: () => {}
  };

  Object.assign(hooks, overrides);
  hooks.__advanceCalls = advanceCalls;
  hooks.__waitCalls = waitCalls;
  return hooks;
}

test("computeItemHash is stable regardless of key order and whitespace noise", () => {
  const a = { title: "Alpha", url: "/a" };
  const b = { url: "/a", title: "Alpha" };
  assert.equal(computeItemHash(a), computeItemHash(b));

  const reflowed = { title: "  Alpha  ", url: "/a" };
  assert.equal(computeItemHash(a), computeItemHash(reflowed));
});

test("computeItemHash differs for genuinely different content", () => {
  const a = { title: "Alpha", url: "/a" };
  const c = { title: "Beta", url: "/b" };
  assert.notEqual(computeItemHash(a), computeItemHash(c));
});

test("decideTerminalReason: timeout beats exhausted and limit when all are true", () => {
  const reason = decideTerminalReason({
    waitTimedOut: true,
    idleRounds: 5,
    maxIdleRounds: 2,
    pageCount: 10,
    maxPages: 10
  });
  assert.equal(reason, REASONS.TIMEOUT);
});

test("decideTerminalReason: exhausted beats limit when both true but no timeout", () => {
  const reason = decideTerminalReason({
    waitTimedOut: false,
    idleRounds: 2,
    maxIdleRounds: 2,
    pageCount: 10,
    maxPages: 10
  });
  assert.equal(reason, REASONS.EXHAUSTED);
});

test("decideTerminalReason: limit only when neither timeout nor exhausted apply", () => {
  const reason = decideTerminalReason({
    waitTimedOut: false,
    idleRounds: 0,
    maxIdleRounds: 2,
    pageCount: 10,
    maxPages: 10
  });
  assert.equal(reason, REASONS.LIMIT);
});

test("decideTerminalReason: null when nothing triggers (keep going)", () => {
  const reason = decideTerminalReason({
    waitTimedOut: false,
    idleRounds: 0,
    maxIdleRounds: 2,
    pageCount: 1,
    maxPages: 10
  });
  assert.equal(reason, null);
});

test("transition order follows CAPTURE -> MERGE -> CHECK_NEXT -> ADVANCE -> WAIT_STABLE per round", async () => {
  const pages = [
    [{ id: 1 }, { id: 2 }],
    [{ id: 3 }],
    [{ id: 3 }] // repeats page 2's item -> 0 new -> idle round
  ];
  const hooks = makeHooks(pages);

  const result = await runScrapeFSM(hooks, {
    maxPages: 10,
    maxIdleRounds: 1,
    waitTimeoutMs: 5000
  });

  const states = result.transitions.map((t) => t.state);
  assert.deepEqual(states, [
    STATES.CAPTURE,
    STATES.MERGE,
    STATES.CHECK_NEXT,
    STATES.ADVANCE,
    STATES.WAIT_STABLE,
    STATES.CAPTURE,
    STATES.MERGE,
    STATES.CHECK_NEXT,
    STATES.ADVANCE,
    STATES.WAIT_STABLE,
    STATES.CAPTURE,
    STATES.MERGE,
    STATES.CHECK_NEXT,
    STATES.DONE
  ]);
  assert.equal(result.status, STATES.DONE);
  assert.equal(result.reason, REASONS.EXHAUSTED);
});

test("dedup by field-hash survives DOM-reflow-style reordering across rounds", async () => {
  // Round 2 re-presents round 1's items in a different order (simulating a
  // reflow) plus exactly one genuinely new item. If dedup used array index
  // instead of content hash, this would either double count or drop items.
  const pages = [
    [{ id: 1, text: "first" }, { id: 2, text: "second" }],
    [{ id: 2, text: "second" }, { id: 1, text: "first" }, { id: 3, text: "third" }],
    [{ id: 3, text: "third" }, { id: 2, text: "second" }, { id: 1, text: "first" }]
  ];
  const hooks = makeHooks(pages);

  const result = await runScrapeFSM(hooks, {
    maxPages: 10,
    maxIdleRounds: 1,
    waitTimeoutMs: 5000
  });

  assert.equal(result.items.length, 3);
  const ids = result.items.map((i) => i.id).sort();
  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(result.status, STATES.DONE);
  assert.equal(result.reason, REASONS.EXHAUSTED);
});

test("limit reason: stops exactly at maxPages when items keep growing", async () => {
  const pages = [[{ id: 1 }], [{ id: 2 }], [{ id: 3 }], [{ id: 4 }], [{ id: 5 }]];
  const hooks = makeHooks(pages);

  const result = await runScrapeFSM(hooks, {
    maxPages: 3,
    maxIdleRounds: 10,
    waitTimeoutMs: 5000
  });

  assert.equal(result.status, STATES.DONE);
  assert.equal(result.reason, REASONS.LIMIT);
  assert.equal(result.items.length, 3);
  assert.equal(hooks.__advanceCalls.length, 2); // advanced twice: page1->2, page2->3
});

test("exhausted reason: stops after maxIdleRounds consecutive zero-growth rounds", async () => {
  const pages = [
    [{ id: 1 }, { id: 2 }],
    [{ id: 2 }], // 0 new (1st idle round)
    [{ id: 2 }] // 0 new (2nd idle round) -> exhausted
  ];
  const hooks = makeHooks(pages);

  const result = await runScrapeFSM(hooks, {
    maxPages: 100,
    maxIdleRounds: 2,
    waitTimeoutMs: 5000
  });

  assert.equal(result.status, STATES.DONE);
  assert.equal(result.reason, REASONS.EXHAUSTED);
  assert.equal(result.items.length, 2);
});

test("timeout reason: aborts and preserves only items merged before the stall", async () => {
  const pages = [[{ id: 1 }], [{ id: 2 }], [{ id: 3 }]];
  let waitCount = 0;
  const hooks = makeHooks(pages, {
    waitStable: async () => {
      waitCount += 1;
      // First wait settles fine, second one stalls (DOM never confirmed stable).
      return { stable: waitCount < 2 };
    }
  });

  const result = await runScrapeFSM(hooks, {
    maxPages: 100,
    maxIdleRounds: 100,
    waitTimeoutMs: 1000
  });

  assert.equal(result.status, STATES.ABORTED);
  assert.equal(result.reason, REASONS.TIMEOUT);
  // Page 1 and page 2 were captured/merged before the stall on the way to page 3.
  assert.equal(result.items.length, 2);
});

test("cancel mid-run: aborts, keeps prior merged items, performs no further advance/wait", async () => {
  const pages = [[{ id: 1 }], [{ id: 2 }], [{ id: 3 }], [{ id: 4 }]];
  let roundsCaptured = 0;
  let cancelled = false;
  let cursor = 0;
  const hooks = makeHooks(pages, {
    capture: async () => {
      const page = pages[cursor];
      roundsCaptured += 1;
      if (roundsCaptured === 3) cancelled = true; // user clicks Cancel mid-round 3
      return page;
    },
    advance: async () => {
      cursor += 1;
      hooks.__advanceCalls.push(cursor);
    },
    isCancelled: () => cancelled
  });

  const result = await runScrapeFSM(hooks, {
    maxPages: 100,
    maxIdleRounds: 100,
    waitTimeoutMs: 5000
  });

  assert.equal(result.status, STATES.ABORTED);
  assert.equal(result.reason, REASONS.CANCELLED);
  // Rounds 1 and 2 fully merged (ids 1, 2). Round 3's capture is what flips the
  // cancel flag, so its batch must NOT be merged into the result or the Set.
  assert.deepEqual(result.items.map((i) => i.id), [1, 2]);
  // No ADVANCE/WAIT_STABLE should fire for round 4 after cancellation.
  const states = result.transitions.map((t) => t.state);
  const lastFour = states.slice(-1);
  assert.deepEqual(lastFour, [STATES.ABORTED]);
  assert.equal(states.filter((s) => s === STATES.ADVANCE).length, 2);
});

test("mutual exclusion end-to-end: exhausted wins over limit when the final round hits both", async () => {
  // maxPages=2 and maxIdleRounds=1: round 2 captures zero new items exactly as
  // pageCount also reaches maxPages. decideTerminalReason must report the more
  // specific "exhausted", not "limit", per the documented priority.
  const pages = [[{ id: 1 }], []];
  const hooks = makeHooks(pages);

  const result = await runScrapeFSM(hooks, {
    maxPages: 2,
    maxIdleRounds: 1,
    waitTimeoutMs: 5000
  });

  assert.equal(result.status, STATES.DONE);
  assert.equal(result.reason, REASONS.EXHAUSTED);
});

test("mutual exclusion end-to-end: timeout wins over exhausted/limit on the final round", async () => {
  // Round 2 would already satisfy both exhausted (0 new) and limit (pageCount
  // reaches maxPages) at CHECK_NEXT, but CHECK_NEXT only sees waitTimedOut=false
  // there, so it correctly reports "exhausted" first. The real conflict this
  // test targets is at WAIT_STABLE after advancing to that same final page: if
  // the render stalls there, timeout must still win even though the idle/limit
  // counters already sitting in scope would otherwise resolve to exhausted.
  const pages = [[{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }]];
  const hooks = makeHooks(pages, {
    waitStable: async () => ({ stable: false })
  });

  const result = await runScrapeFSM(hooks, {
    maxPages: 2,
    maxIdleRounds: 1,
    waitTimeoutMs: 1000
  });

  assert.equal(result.status, STATES.ABORTED);
  assert.equal(result.reason, REASONS.TIMEOUT);
  assert.equal(result.items.length, 2); // only round 1's items made it into the Set
});
