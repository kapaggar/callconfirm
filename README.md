# 🧘 Vipassana DIPI Tools — Call Tracker · Course Audit · Photo Review

Personal browser tooling for Dhamma Sudha course admin on dipi.vridhamma.org:
confirmation-call tracking, pre-course data-quality audit, and applicant photo
rotate/crop review. Everything runs client-side in your browser.

## Tools

| Tool | What it does | Docs |
|---|---|---|
| 📥 Scrape + Call Tracker | Scrapes applicants from a course page, opens the calling dashboard | `CALL-TRACKER-README.md` |
| 🔍 Course Audit | Rule-engine data-quality check before a course | `course-audit/README.md` |
| 📷 Photo Review | Rotate/crop applicant photos, optional write-back to dipi | `photo-review/README.md` |

Architecture and hand-off notes: `CALL-TRACKER-MEMORY.md` (read this first when developing).
Manual QA: `docs/QA-TEST-PLAN.md`. Agent scan / debug / feature contract:
`docs/FEATURE-DEBUG-PROMPT.md`.

## Files

```
launcher.js            ← All-in-one bookmarklet target: adds 🔍 📥 📷 buttons
bookmarklet-all.txt    ← The all-in-one bookmarklet (drag to bookmarks bar)
manifest.json          ← Chrome extension (MV3) manifest — repo root IS the extension
extension-fab.js       ← Extension content script (same FAB buttons + letter bridge relay)
background.js          ← Extension service worker: fetches personalized letters (host lacks CORS headers)
vendor/mediapipe/      ← Self-hosted face-detection lib + model (pinned, ~18 MB)
vendor/faceapi/        ← Self-hosted face-recognition lib + weights (👥 cross-course duplicates)
scraper.js             ← DIPI scraper (course picker + applicant scrape)
tracker-inline.js      ← Calling dashboard overlay
scraper.user.js        ← Tampermonkey shell (scraper/tracker)
course-audit/          ← Audit rule engine + panel + shell
photo-review/          ← Photo review overlay + shell
index.html             ← Static landing page (github.io) → points to the on-page tracker
setup.html             ← One-time bookmarklet installer
manifest.webmanifest   ← PWA config (renamed; manifest.json is the extension's)
sw.js                  ← Landing-page offline support (network-first)
test/                  ← Unit tests: audit rules, tracker helpers, face-match math (node --test)
TODO.md                ← Prioritized feature backlog
docs/QA-TEST-PLAN.md   ← Manual QA cases (extension / Tampermonkey / bookmarklet)
docs/FEATURE-DEBUG-PROMPT.md  ← Agent prompt: scan, debug, or add a feature
```

## Tests

The pure-JS parts — the `course-audit` rule engine, the tracker's helpers
(dates, merge, backfill), and the face-match math — have unit tests
(zero-dependency `node:test`):

```bash
npm test          # or: node --test
```

They also run in CI on every push and PR (`.github/workflows/test.yml`). When you
change an audit rule, add or update a case in `test/audit.test.js`; tracker
helpers are covered in `test/tracker.test.js`.

## Deploy

Push to `main` — GitHub Pages serves the repo at
`https://kapaggar.github.io/callconfirm/`. Logic files are cache-busted
(`?v=Date.now()`), so changes go live on the next run.

## Setup (one-time)

Three options:

- **Bookmarklet (works everywhere, incl. iPhone Safari):** open
  `https://kapaggar.github.io/callconfirm/setup.html` and copy the
  **all-in-one bookmarklet** — one bookmark that adds all three tool buttons
  (🔍 Audit · 📥 Scrape · 📷 Photos) to any DIPI page. Each tool loads only
  when you tap its button. (Or copy `bookmarklet-all.txt` manually.)
- **Tampermonkey (desktop):** install the three userscripts —
  `scraper.user.js`, `course-audit/userscript.user.js`,
  `photo-review/userscript.user.js` — for the same buttons, auto-added on
  every `/search-course/` page.
- **Chrome extension (desktop, no Tampermonkey needed):** `git clone` this
  repo, open `chrome://extensions` → enable Developer mode → **Load unpacked**
  → pick the repo root. Same buttons, everything bundled (face detection works
  offline). Update = `git pull` + the extension's reload button. Don't run the
  Tampermonkey userscripts in the same profile (buttons dedupe, but auto-run
  can fire twice).

## Usage

1. Log into DIPI, open a course's `/search-course/` page (or any DIPI page and
   use 📥 Scrape's course picker).
2. Tap the bookmark → three buttons appear bottom-right.
3. **🔍 Audit** before the course, **📥 Scrape → Open Tracker** to start
   calling, **📷 Photos** to fix rotated/zoomed-out applicant photos.

All applicant data stays in your browser; nothing leaves it except explicit
actions (WhatsApp links, exports, photo upload to dipi).

## Developing / debugging

Vanilla JS, no build step. The three tools share one copy of each logic file
across bookmarklet, Tampermonkey, and the Chrome extension.

| If you are… | Read |
|---|---|
| Adding a feature or fixing a bug | `docs/FEATURE-DEBUG-PROMPT.md` (modes: scan / debug / feature) |
| Picking the repo up cold | `CALL-TRACKER-MEMORY.md`, then the prompt above |
| Running a release or live-course check | `docs/QA-TEST-PLAN.md` (smoke list at the bottom) |
| Looking at the backlog | `TODO.md` (next: diff-mode re-scrape) |

Paste into an agent session, or work it yourself:

```text
Read docs/FEATURE-DEBUG-PROMPT.md. MODE=scan. Produce the scan output template. Do not edit files.

Read docs/FEATURE-DEBUG-PROMPT.md. MODE=debug. Channel=extension. Symptom: …

Read docs/FEATURE-DEBUG-PROMPT.md. MODE=feature. Implement TODO.md #2 diff-mode re-scrape.
```

`npm test` covers the pure helpers (audit rules, tracker dates/merge/backfill,
face-match math). Overlay / DataTable / letter-bridge paths have no automated
browser tests — verify on a real `/search-course/` page. Bump `@version` in the
matching `.user.js` shell on every tool change; extension updates need
`git pull` plus Reload (`?v=Date.now()` is inert on `chrome-extension://`).
Do not commit applicant exports, HAR files, or `store-assets/`.
