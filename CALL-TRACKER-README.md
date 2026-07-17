# DIPI Inline Call Tracker

Scrape applicants from `dipi.vridhamma.org/search-course/...` and run a calling dashboard **inline on the same page** — no navigation, no separate app. (The old PWA tracker is retired; `tracker-inline.js` is the single copy.)

## Files

| File | Role |
|---|---|
| `scraper.js` | Reads applicants from the DataTables instance on the dipi page (statuses Expected/Confirmed plus the WaitList/Review backfill pool). Offers "Open Inline Call Tracker" plus CSV/Copy/AID exports. Reloads the page first if its `?s=` status filter is narrower than the tool's. |
| `tracker-inline.js` | The calling dashboard, rendered as a full-screen overlay on the dipi page. Stores sessions in IndexedDB at the dipi origin. |
| `scraper.user.js` | Tampermonkey shell. Adds the "🔄 Scrape" FAB to `/search-course/` and `/centre/` pages (click-to-run; right-click toggles auto-run) and answers the tracker's letter-fetch bridge via `GM_xmlhttpRequest`. |
| `scraper-bookmarklet.txt` | Bookmarklet alternative to the userscript (no letter bridge — generic WhatsApp fallback only). |

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
2. Open `https://kapaggar.github.io/callconfirm/scraper.user.js`. Tampermonkey will prompt to install (it asks for `GM_xmlhttpRequest` — that powers the personalized-letter fetch, see Privacy below).
3. Visit a `/search-course/` page and click the "🔄 Scrape" FAB (bottom-right). Right-click the FAB to opt into auto-run.
4. After scraping, click "Open Inline Call Tracker" — the dashboard opens on the same page.
5. When a session already exists for the course, the primary button reads "Resume Calling (N marked)" instead.

### Option B — Bookmarklet

Drag the contents of `scraper-bookmarklet.txt` to your bookmarks bar. Click it on a `/search-course/` page.

### Option C — Chrome extension

Load the repo root unpacked (chrome://extensions) — same tools, same FAB, letter bridge via a background service worker. See the root `README.md`.

## Workflow

1. **Scrape** — FAB or bookmarklet loads applicants from the DataTable.
2. **Open inline tracker** — primary blue button after scrape.
3. **Triage by deadline** — the ⏳ header chip counts down to the reconfirmation deadline (click to cycle T-7/14/21); the ⏳ Priority sort pill floats still-to-reach applicants to the top.
4. **Call applicants** — tap a card to expand: phone numbers, status buttons, notes, dipi-status buttons.
5. **WhatsApp** — the 💬 button fetches the personalized DIPI letter (if AID is set) and opens the native WhatsApp app with it pre-filled (`whatsapp://send`); the `💬 App / 💬 Web` header pill switches to a wa.me tab instead. Falls back to a generic Hindi template when the AID or letter is missing.
6. **Status** — Confirmed / Cancelled / No Answer / Callback / Tentative / Left Msg. Tap to mark; attempt counter increments where appropriate.
7. **Backfill** — WaitList/Review applicants sit in the 🪑 pool (out of the main queue and stats). Marking someone Cancelled surfaces same-group pool candidates with jump-to-card.
8. **Export** — Copy WhatsApp summary, download CSV, print PDF, export AID:phone for the bulk-send script, or backup/restore the whole session as JSON (hand-off between volunteers, merges by AID).
9. **Re-scrape** — when new applicants register or statuses change in dipi. Existing call statuses are preserved across re-scrapes when matched by AID.

## Data preservation across re-scrapes

`tracker-inline.js` matches incoming applicants to the existing session by:

1. Same course title + dates → reuse session
2. Within that session, AID match → carry over `status`, `attempts`, `lastAttempt`, `notes`

New applicants (no AID match in old session) start as `pending`. Removed applicants disappear from the new session. The merge is destructive on the apps list (new list wins), but non-destructive on call progress.

If you want a fresh session for the same course, manually delete it from IndexedDB before re-scraping.

## Storage

IndexedDB at `dipi.vridhamma.org` origin, key `vcall_inline`. For backup or moving to another machine/browser, use Export → "💾 Backup session (JSON)" and "📂 Import backup…" — imports merge by AID with newest-progress-wins.

## Privacy

- All data stays in your browser. Nothing is uploaded.
- Phone numbers, AIDs, applicant names persist in IndexedDB until you clear browser data or use DevTools to delete the database. Backup JSON files contain the same applicant data — handle them like the CSV exports.
- The WhatsApp letter fetch calls `applicant.vridhamma.org` using DIPI's own URL encryption scheme — same as opening the letter manually. That host sends no CORS headers, so the fetch runs through a privileged bridge (Tampermonkey `GM_xmlhttpRequest` or the extension's background worker), allow-listed to the letter URL only.
- The bookmarklet runs with page privileges (your dipi session). Don't run it on untrusted pages.

## CSS isolation

The tracker overlay uses scoped CSS (all selectors prefixed with `#dipi-tracker-overlay`) so it doesn't bleed into the dipi page styles. The overlay covers the full viewport so the underlying dipi page is hidden while the tracker is active.

## Roadmap

See `TODO.md` for the prioritized backlog (next up: diff-mode re-scrape). Shipped from the old list here: session export/import, wait-list backfill, reconfirmation countdown.
