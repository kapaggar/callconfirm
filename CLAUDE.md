# CLAUDE.md

Personal browser tooling for Dhamma Sudha Vipassana centre (centre 63 on dipi.vridhamma.org):
a call-confirmation tracker plus a pre-course data-quality audit. Vanilla JS, no build step,
no dependencies, no tests. Deployed by pushing to `main` — GitHub Pages serves the repo at
`https://kapaggar.github.io/callconfirm/`.

**Read `CALL-TRACKER-MEMORY.md` first** — it is the full hand-off document (architecture,
DIPI endpoint captures, data model, decisions, roadmap). `course-audit/README.md` covers the
audit side. This file is only the quick orientation.

## Layout

| File | Role |
|---|---|
| `scraper.js` | Scrapes applicants from the DataTable on dipi `/search-course/` pages |
| `tracker-inline.js` | Calling dashboard rendered as overlay on the dipi page; IndexedDB `vcall_inline` |
| `scraper.user.js` | Tampermonkey shell (FAB buttons, auto-run); bump `@version` when editing it |
| `index.html` | Legacy PWA fallback at github.io; duplicates the tracker UI code |
| `sw.js`, `manifest.json`, `setup.html` | PWA plumbing for the fallback |
| `course-audit/` | Separate rule-engine + panel (audit.js / loader.js / userscript.user.js) |
| `photo-review/` | Applicant photo rotate/crop overlay, local-only (review.js / userscript.user.js) |

## Conventions and gotchas

- `scraper.js`, `tracker-inline.js`, `course-audit/audit.js`, `course-audit/loader.js`,
  `photo-review/review.js` are fetched with `?v=Date.now()` cache-busting — changes go
  live on next run after push. The `.user.js` shells only update via Tampermonkey daily
  check.
- **On EVERY change to a tool, bump `@version` in its `.user.js` shell** (even when only
  the cache-busted logic file changed) so Tampermonkey users see the update. Mapping:
  scraper/tracker (`scraper.js`, `tracker-inline.js`) → `scraper.user.js`;
  audit → `course-audit/userscript.user.js`; photos → `photo-review/userscript.user.js`.
- Changes to tracker UI logic usually need mirroring in `index.html` (same code, PWA copy).
- All userscripts share the `#dipi-fab-stack` FAB convention (`data-order`: audit 10, scrape 20, photos 30).
- Tracker call-status is deliberately decoupled from dipi status; never auto-sync them.
- `localStorage.dipiTracker.sessionIndex` (keyed `centreid/courseid`) is how the scraper detects
  an in-progress session; the tracker writes it on import and every save.
- Escape user/scraped strings with the local `escHtml()` before interpolating into innerHTML.
- Centre ID `63` and status filter `Expected,Confirmed` are hardcoded in `scraper.js`.
- Applicant data is sensitive (names, phones, health disclosures). Keep everything client-side;
  nothing may leave the browser except explicit user actions (wa.me, exports).

## Working style (Kapil)

- Answer first, then reasoning. Surface tradeoffs and uncertainty explicitly.
- En-dashes/hyphens, no em-dashes. Suggest commit messages when shipping changes.
- Test against real course data before declaring done; audit rules were calibrated against
  four 2026 course exports and should not regress.
- Ask before adding audit rules (hard error vs soft flag) or tracker features that write to dipi.
