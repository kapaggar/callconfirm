# DIPI Inline Call Tracker

Scrape applicants from `dipi.vridhamma.org/search-course/...` and run a calling dashboard **inline on the same page** — no navigation, no separate PWA window. The PWA at `kapaggar.github.io/callconfirm/` remains available as a fallback.

## Files

| File | Role |
|---|---|
| `scraper.js` | Reads applicants from the DataTables instance on the dipi page. Offers "Open Inline Call Tracker" (primary) and "Open in PWA" (fallback) plus CSV/Copy/AID exports. |
| `tracker-inline.js` | The calling dashboard. Same UI as `index.html` but renders as a full-screen overlay on the dipi page. Stores sessions in IndexedDB at the dipi origin. |
| `scraper.user.js` | Tampermonkey shell. Adds a floating "🔄 Scrape" button to `/search-course/` pages and "📞 Open Tracker" to resume the last session without re-scraping. Optional auto-run. |
| `scraper-bookmarklet.txt` | Bookmarklet alternative to the userscript. |

## How it works

```
                  dipi.vridhamma.org/search-course/63/...
                                │
            ┌───────────────────┴────────────────────┐
            │                                        │
        ┌───▼────────┐                         ┌─────▼──────┐
        │ scraper.js │  ── reads DataTable ──→ │  apps[]    │
        │ overlay    │     via jQuery API      │ (in-memory)│
        └───┬────────┘                         └─────┬──────┘
            │ "Open Inline Call Tracker"               │
            │                                          ▼
            │                               ┌───────────────────┐
            └──────────────────────────────▶  tracker-inline.js │
                                            │ overlay #2        │
                                            │ IndexedDB on dipi │
                                            │ origin            │
                                            └───────────────────┘
```

The two overlays are mutually exclusive: the scraper closes itself when you click "Open Inline Call Tracker". The tracker has a "🔄 Re-scrape" button that closes itself and re-invokes the scraper.

## Install

### Option A — Tampermonkey (recommended)

1. Install Tampermonkey if not already.
2. Open `https://kapaggar.github.io/callconfirm/scraper.user.js`. Tampermonkey will prompt to install.
3. Visit a `/search-course/` page. The scraper auto-runs once the DataTable is ready.
4. After scraping, click "Open Inline Call Tracker" — the dashboard opens on the same page.
5. The floating "📞 Open Tracker" button (bottom-right) reopens the last session anytime without re-scraping.

Auto-run can be toggled by right-clicking the "🔄 Scrape" floating button.

### Option B — Bookmarklet

Drag the contents of `scraper-bookmarklet.txt` to your bookmarks bar. Click it on a `/search-course/` page.

## Workflow

1. **Scrape** — bookmarklet or auto-run loads applicants from the DataTable.
2. **Open inline tracker** — primary blue button after scrape.
3. **Call applicants** — tap a card to expand, see phone numbers, status buttons, notes textarea.
4. **WhatsApp** — green WhatsApp button fetches the personalized DIPI letter (if AID is set) and pre-fills wa.me. Falls back to a generic Hindi template.
5. **Status** — Confirmed / Cancelled / No Answer / Callback / Tentative / Left Msg. Tap to mark; attempt counter increments where appropriate.
6. **Export** — Copy WhatsApp summary, download CSV, print PDF, or export AID:phone for the bash script.
7. **Re-scrape** — when new applicants register or statuses change in dipi. Existing call statuses are preserved across re-scrapes when matched by AID.

## Data preservation across re-scrapes

`tracker-inline.js` matches incoming applicants to the existing session by:

1. Same course title + dates → reuse session
2. Within that session, AID match → carry over `status`, `attempts`, `lastAttempt`, `notes`

New applicants (no AID match in old session) start as `pending`. Removed applicants disappear from the new session. The merge is destructive on the apps list (new list wins), but non-destructive on call progress.

If you want a fresh session for the same course, manually delete it from IndexedDB before re-scraping.

## Storage

IndexedDB at `dipi.vridhamma.org` origin, key `vcall_inline`. Separate from the PWA's storage at `kapaggar.github.io`. To copy a session from one to the other, use the PWA's "Paste from DIPI" feature.

## Privacy

- All data stays in your browser. Nothing is uploaded.
- Phone numbers, AIDs, applicant names persist in IndexedDB until you clear browser data or use DevTools to delete the database.
- The WhatsApp letter fetch is a same-origin call to `applicant.vridhamma.org` using DIPI's own URL encryption scheme — same as opening the letter manually from dipi.
- The bookmarklet runs with page privileges (your dipi session). Don't run it on untrusted pages.

## CSS isolation

The tracker overlay uses scoped CSS (all selectors prefixed with `#dipi-tracker-overlay`) so it doesn't bleed into the dipi page styles. The overlay covers the full viewport so the underlying dipi page is hidden while the tracker is active.

## Roadmap

- Merge tracker + audit overlays: one toolbar with "Audit" and "Calling" tabs
- Sync sessions between dipi origin and github.io PWA via export/import
- Background letter pre-fetch for all pending applicants
- Bulk SMS via `sms:` URL handler (Android)
