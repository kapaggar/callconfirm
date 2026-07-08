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

## Files

```
launcher.js            ← All-in-one bookmarklet target: adds 🔍 📥 📷 buttons
bookmarklet-all.txt    ← The all-in-one bookmarklet (drag to bookmarks bar)
scraper.js             ← DIPI scraper (course picker + applicant scrape)
tracker-inline.js      ← Calling dashboard overlay
scraper.user.js        ← Tampermonkey shell (scraper/tracker)
course-audit/          ← Audit rule engine + panel + shell
photo-review/          ← Photo review overlay + shell
index.html             ← Legacy PWA fallback (github.io)
setup.html             ← One-time bookmarklet installer
manifest.json, sw.js   ← PWA config + offline support
```

## Deploy

Push to `main` — GitHub Pages serves the repo at
`https://kapaggar.github.io/callconfirm/`. Logic files are cache-busted
(`?v=Date.now()`), so changes go live on the next run.

## Setup (one-time)

Two options:

- **Bookmarklet (works everywhere, incl. iPhone Safari):** open
  `https://kapaggar.github.io/callconfirm/setup.html` and copy the
  **all-in-one bookmarklet** — one bookmark that adds all three tool buttons
  (🔍 Audit · 📥 Scrape · 📷 Photos) to any DIPI page. Each tool loads only
  when you tap its button. (Or copy `bookmarklet-all.txt` manually.)
- **Tampermonkey (desktop):** install the three userscripts —
  `scraper.user.js`, `course-audit/userscript.user.js`,
  `photo-review/userscript.user.js` — for the same buttons, auto-added on
  every `/search-course/` page.

## Usage

1. Log into DIPI, open a course's `/search-course/` page (or any DIPI page and
   use 📥 Scrape's course picker).
2. Tap the bookmark → three buttons appear bottom-right.
3. **🔍 Audit** before the course, **📥 Scrape → Open Tracker** to start
   calling, **📷 Photos** to fix rotated/zoomed-out applicant photos.

All applicant data stays in your browser; nothing leaves it except explicit
actions (WhatsApp links, exports, photo upload to dipi).
