# CLAUDE.md

Personal browser tooling for Dhamma Sudha Vipassana centre (centre 63 on dipi.vridhamma.org):
a call-confirmation tracker plus a pre-course data-quality audit. Vanilla JS, no build step,
no runtime dependencies except one: photo-review uses MediaPipe tasks-vision (pinned,
on-device WASM) for face detection — self-hosted under `vendor/mediapipe/` only, no CDN
(MV3/Web Store forbids remote code; never add remote script/wasm URLs to files shipped in
the extension zip). Deployed by pushing to `main` — GitHub Pages serves the repo at
`https://kapaggar.github.io/callconfirm/`.

The `course-audit` rule engine (`course-audit/audit.js`) is pure and framework-agnostic,
so it has unit tests: run `npm test` (or `node --test`) — zero-dependency `node:test`, also
run in CI on push/PR (`.github/workflows/test.yml`). When you change an audit rule, add or
update a case in `test/audit.test.js`. The DOM-bound tools (scraper/tracker/loader/review)
have no automated tests.

**Read `CALL-TRACKER-MEMORY.md` first** — it is the full hand-off document (architecture,
DIPI endpoint captures, data model, decisions, roadmap). `course-audit/README.md` covers the
audit side. `TODO.md` is the prioritized feature backlog. This file is only the quick
orientation.

## Layout

| File | Role |
|---|---|
| `scraper.js` | Scrapes applicants from the DataTable on dipi `/search-course/` pages |
| `tracker-inline.js` | Calling dashboard rendered as overlay on the dipi page; IndexedDB `vcall_inline` |
| `scraper.user.js` | Tampermonkey shell (FAB buttons, auto-run); bump `@version` when editing it |
| `launcher.js` | All-in-one bookmarklet target (`bookmarklet-all.txt`); adds all 3 FAB buttons, tools load on demand |
| `manifest.json` | Chrome extension (MV3) manifest — the repo root IS the extension (load unpacked) |
| `extension-fab.js` | Extension content script (isolated world); injects the bundled tools into the page's MAIN world |
| `vendor/mediapipe/` | Self-hosted face-detection lib + model, pinned; hashes in its README |
| `vendor/faceapi/` | Self-hosted face-recognition lib + weights (face-api.js, pinned) for 👥 Duplicates; hashes in its README |
| `index.html` | Static landing page at github.io — signposts to the on-page inline tracker (no app/tracker code; retired the duplicate PWA tracker) |
| `sw.js`, `manifest.webmanifest`, `setup.html` | PWA plumbing for the landing page (`manifest.json` now belongs to the extension) |
| `course-audit/` | Separate rule-engine + panel (audit.js / loader.js / userscript.user.js) |
| `photo-review/` | Applicant photo rotate/crop overlay, local-only (review.js / facematch.js / userscript.user.js) |

## Conventions and gotchas

- `scraper.js`, `tracker-inline.js`, `course-audit/audit.js`, `course-audit/loader.js`,
  `photo-review/review.js` are fetched with `?v=Date.now()` cache-busting — changes go
  live on next run after push. The `.user.js` shells only update via Tampermonkey daily
  check.
- **On EVERY change to a tool, bump `@version` in its `.user.js` shell** (even when only
  the cache-busted logic file changed) so Tampermonkey users see the update. Mapping:
  scraper/tracker (`scraper.js`, `tracker-inline.js`) → `scraper.user.js`;
  audit → `course-audit/userscript.user.js`; photos → `photo-review/userscript.user.js`.
- `tracker-inline.js` is the single copy of the call tracker. `index.html` is now
  just a static signpost — do NOT re-add tracker logic to it. (`setup.html` still
  carries a legacy standalone bookmarklet that references the retired PWA route.)
- All userscripts share the `#dipi-fab-stack` FAB convention (`data-order`: audit 10, scrape 20, photos 30).
- The Chrome extension shares the same tool files (single source of truth) and dedupes FAB
  buttons by DOM id, but don't run the Tampermonkey shells and the extension in one profile —
  auto-run can fire twice. Extension updates = `git pull` + reload (cache-busting is inert there).
- Tracker call-status is deliberately decoupled from dipi status; never auto-sync them.
- `localStorage.dipiTracker.sessionIndex` (keyed `centreid/courseid`) is how the scraper detects
  an in-progress session; the tracker writes it on import and every save.
- Escape user/scraped strings with the local `escHtml()` before interpolating into innerHTML.
- Centre ID `63` and status filter `Expected,Confirmed` are hardcoded in `scraper.js`.
- Applicant data is sensitive (names, phones, health disclosures). Keep everything client-side;
  nothing may leave the browser except explicit user actions (wa.me, exports).
- 👥 Duplicates (photo-review/facematch.js) stores **face descriptors** — biometric-adjacent —
  in IndexedDB `vcall_faces` (dipi origin, last 12 courses). They must NEVER leave the browser;
  only the name+distance summary goes to `localStorage.faceDedup.flags` (read by the audit
  panel's Cross-course section). ♻ Reset local wipes both. Matches are leads, not proof.

## Working style (Kapil)

- Answer first, then reasoning. Surface tradeoffs and uncertainty explicitly.
- En-dashes/hyphens, no em-dashes. Suggest commit messages when shipping changes.
- Test against real course data before declaring done; audit rules were calibrated against
  four 2026 course exports and should not regress.
- Ask before adding audit rules (hard error vs soft flag) or tracker features that write to dipi.
