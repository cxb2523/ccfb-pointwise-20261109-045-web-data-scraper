# Web Data Scraper - Extract & Export to CSV/Excel/JSON

[![Alt text](https://developer.chrome.com/static/docs/webstore/branding/image/HRs9MPufa1J1h5glNhut.png)](https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb?utm_source=github&utm_medium=github&utm_campaign=github)

Download: [https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb](https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb?utm_source=github&utm_medium=github&utm_campaign=github)

# Description
[Web Data Scraper](https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb?utm_source=github&utm_medium=github&utm_campaign=github) - no-code internet scraping. Extract and export to CSV, Excel, JSON, Google Sheets, and Webhook.

Turn any website into structured, export-ready data in minutes.

Web Data Scraper is a premium no-code Chrome extension built for professionals who need reliable web data extraction without complex setup. Detect repeating data blocks, run high-quality extraction, and deliver results instantly to CSV, Excel, JSON, Google Sheets, or Webhook.

Whether you are building lead lists, tracking competitors, monitoring catalogs, or collecting research data, Web Data Scraper gives you a clean workflow from page to dataset.

# Features
[![Alt text](https://lh3.googleusercontent.com/LKAxBtGyRnAiSls7QYRGLwbepHWZ4TdVmOHs4_3gihDK7Xfc9JBQcbUBBtJOaemEEXlnVsuy294LK4ACVq5l3SsR=s1600-w1600-h1000)](https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb?utm_source=github&utm_medium=github&utm_campaign=github)

[![Alt text](https://lh3.googleusercontent.com/4fCNyAgJTUZrRGW5FkigF0HPE19_poMW70cadCTlZNf6K1moI556OqMrUsH5C7GckLcHjBJ3T2bnCbwECTkHxbYA=s1600-w1600-h1000)](https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb?utm_source=github&utm_medium=github&utm_campaign=github)

[![Alt text](https://lh3.googleusercontent.com/5pSheqN9UGf_klPeHNcfLPoCy0NUZfgZXStHg7rfUAEOXK8flvdp0hD76Rgf2qKbpk4evY4yAuhl30A1RhUvkCrcFg=s1600-w1600-h1000)](https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb?utm_source=github&utm_medium=github&utm_campaign=github)

[![Alt text](https://lh3.googleusercontent.com/h26Ej3KSzCpqOX6JGwucukUqTVvIs_zU8sY6yFXq-SXcuK96Pe84lWteZkWjJMrJCtNHcABRe86LPeK3WPupGjmuHg=s1600-w1600-h1000)](https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb?utm_source=github&utm_medium=github&utm_campaign=github)

[![Alt text](https://lh3.googleusercontent.com/-9VGAPWqNemyOecHYD5fe3IDMhm9r6QuSXTi-5fvtf8nGIgeGlnHCaR0a6dbOJb-SIFZP9oE1dtZct6uyUq6D0mqZg=s1600-w1600-h1000)](https://chromewebstore.google.com/detail/web-data-scraper-extract/naiajkdlnhbafibhgmndoklmkeocbljb?utm_source=github&utm_medium=github&utm_campaign=github)

What makes it premium
- Fast setup: start scraping in a few clicks, no coding required.
- Production-ready outputs: clean rows, usable columns, export-friendly formats.
- Flexible delivery: one-click export or auto-delivery after run completion.
- Reusable workflows: save templates and run repeat tasks consistently.
- Designed for scale: pagination support and multi-page workflows out of the box.

Extraction modes
- List Extractor: extract cards, listings, and table-like blocks into structured rows.
- Page Detail Extractor: open each URL and capture selected fields from detail pages.
- Email Extractor: collect and normalize email addresses.
- Phone Number Extractor: collect phone numbers with country context.
- Page Text Extractor: capture useful on-page text for research and content workflows.
- Image Downloader: collect and export image assets from pages.

Built for real-world operations
- Pagination options: Next button, Load More button, URL pattern.
- Google Sheets delivery with append or upsert-by-key logic.
- Optional row update controls for safer sync workflows.
- Webhook delivery for automation pipelines.
- History and templates for repeatable team processes.

Typical use cases
- Sales and lead generation
- E-commerce and price/catalog monitoring
- Marketplace and directory scraping
- SEO and SERP research
- Content intelligence and market analysis
- Operations reporting and data enrichment

Why teams choose Web Data Scraper
- No-code, but not toy-level.
- Simple for first-time users, powerful enough for recurring workflows.
- Built to reduce manual copy-paste and speed up data operations.
- Works directly where data lives: inside your browser.

How it works
1. Open a target page in Chrome.
2. Choose a scraping mode.
3. Preview and verify columns.
4. Start scraping.
5. Export instantly or auto-send to your destination.

If your workflow depends on getting structured web data quickly and reliably, Web Data Scraper is the practical, professional solution.

# Paginated / Scroll Scrape State Machine

`src/panel.js` sends a `START_SCRAPE` control message (and `CANCEL_SCRAPE` to
stop one in progress); `src/background.js` runs the actual state machine via
`runScrapeFSM`, defined in the browser-free core module `src/scrapeFsmCore.js`.

## Message shape

```
{ type: "START_SCRAPE", payload: { tabId, maxPages, maxIdleRounds, waitTimeoutMs } }
{ type: "CANCEL_SCRAPE", tabId }
```

- `maxPages` - stop after this many captured pages/scroll rounds.
- `maxIdleRounds` - stop once this many *consecutive* rounds add zero new items.
- `waitTimeoutMs` - how long `WAIT_STABLE` will wait for the DOM to settle after
  each advance before giving up.

## States

`CAPTURE -> MERGE -> CHECK_NEXT -> ADVANCE -> WAIT_STABLE -> (loop back to CAPTURE)`,
ending in `DONE` or `ABORTED`:

- **CAPTURE** - read the items currently visible on the page/viewport.
- **MERGE** - hash each captured item and merge only the ones not already seen
  into the result set (see "De-duplication" below).
- **CHECK_NEXT** - decide whether to stop (`exhausted` / `limit`) or continue.
- **ADVANCE** - click to the next page or scroll further to trigger lazy load.
- **WAIT_STABLE** - wait for the DOM to stop mutating before the next capture,
  or time out.
- **DONE** - finished normally, `reason` is `limit` or `exhausted`.
- **ABORTED** - stopped early, `reason` is `timeout` or `cancelled`.

## Termination priority: timeout > exhausted > limit

All three automatic stop conditions are evaluated by one function,
`decideTerminalReason`, so there is a single place that encodes the priority
instead of three independent checks that could disagree:

1. **timeout** wins first. If `WAIT_STABLE` couldn't confirm the DOM had
   settled, nothing read after that point can be trusted - reporting it as a
   tidy `limit`/`exhausted` finish would wrongly imply the collected data is
   complete.
2. **exhausted** wins next. Hitting `maxIdleRounds` means several consecutive,
   confirmed-stable rounds produced zero new items - a confident, content-driven
   signal that the real end of the list was reached. That's more informative
   than an arbitrary page-count ceiling.
3. **limit** is reported only when neither of the above applies. `maxPages` is
   just a safety cap chosen by the caller, not a statement about the data.

Cancellation (user-driven, via `CANCEL_SCRAPE`) is checked ahead of all three at
every checkpoint, including right after `CAPTURE` returns but before `MERGE`
runs. That ordering is what guarantees a cancelled run never writes a
just-captured, not-yet-reconciled batch into the de-dup set: cancelling always
freezes the result at the last fully merged round, never a partially merged
one, and it never triggers another `ADVANCE`/`WAIT_STABLE` round.

## De-duplication by content hash, not array index

Each item is hashed from its own sorted `field=value` pairs (see
`computeItemHash` in `scrapeFsmCore.js`), and only the hash goes into the `Set`
used for de-duplication. Scroll-based capture re-reads the live DOM every
round, and virtualized/infinite-scroll pages routinely reorder or recycle DOM
nodes for items that were already seen. Deduplicating by array position would
either recount an item that moved, or silently drop a new item that landed at
an index a previously-seen item used to occupy. Hashing the item's own content
makes de-duplication immune to where the item currently sits in the DOM or in
the capture array.

## Why `WAIT_STABLE` uses MutationObserver + polling, not a fixed sleep

A fixed `sleep(ms)` between "scroll/click next" and "capture again" has to
guess a single delay that works for every page, every network connection, and
every device. Lazy-loaded content doesn't load on a fixed schedule: a fast
connection and a fast device might render in under 100ms, while a slow mobile
connection or a loaded CPU can take several seconds for the same page. Any
fixed delay short enough to keep a fast page snappy will under-wait on a slow
one (capturing before new items exist, producing a false `exhausted`); any
delay long enough to be safe on a slow connection wastes real time on every
fast page. Because that rendering latency drifts with factors outside the
extension's control, `WAIT_STABLE` instead watches the actual DOM for change:
a `MutationObserver` on `document.body` resets a short "quiet window" timer on
every mutation, and only resolves `stable: true` once that quiet window
elapses with no further mutations - whatever that takes on this particular
page, right now. A separate polling loop only enforces the outer
`waitTimeoutMs` ceiling to `abort` with `reason: "timeout"` if the page never
settles; it never itself declares success, so it can't be mistaken for a
disguised fixed sleep.

## Manual verification (Chrome)

1. Open `chrome://extensions`, enable Developer Mode, choose **Load unpacked**,
   and select the `src/` directory of this repository.
2. Open a page with an infinite-scroll or "load more" feed, click the
   extension icon to open the side panel, then click **Start Scrape**.
3. Scroll/let it run; watch the status line move through the FSM states, and
   confirm **Cancel** stops the run immediately while keeping whatever items
   were merged so far in the results box.

## Running the unit tests (no browser required)

```
node --test src/test
```

This exercises `src/scrapeFsmCore.js` directly with simulated page-data arrays
and stubbed hooks - no `chrome.*` APIs or DOM involved - covering transition
order, hash-based de-duplication under simulated reflow/reordering, and the
mutual-exclusion priority between `timeout`, `exhausted`, and `limit`.
