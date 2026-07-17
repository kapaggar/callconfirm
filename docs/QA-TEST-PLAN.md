# Manual QA Test Plan — callconfirm (DIPI Tools)

Manual test plan for the Call Tracker, Course Audit, and Photo Review tools that ship
from this repo as three delivery channels: a Chrome MV3 extension (repo root), Tampermonkey
userscripts (`scraper.user.js`, `course-audit/userscript.user.js`,
`photo-review/userscript.user.js`), and an all-in-one bookmarklet (`launcher.js` /
`bookmarklet-all.txt`). All three share the same logic files (`scraper.js`,
`tracker-inline.js`, `course-audit/audit.js` + `loader.js`, `photo-review/review.js` +
`facematch.js`), so most bugs reproduce everywhere — but the *loading/permission* path
differs per channel, which is where channel-specific regressions hide.

## How to use this plan

This is manual — there is no browser automation harness in this repo (only `npm test` /
`node --test` unit tests for the pure logic: `test/audit.test.js`, `test/tracker.test.js`,
`test/facematch.test.js`). Run this plan:

- Before a release (any push to `main` that touches `scraper.js`, `tracker-inline.js`,
  `course-audit/*.js`, `photo-review/*.js`, `extension-fab.js`, `background.js`,
  `manifest.json`, or a `.user.js` shell).
- Before a live course, at minimum the **Regression smoke test** at the end.
- After bumping `@version` in a `.user.js` shell or `"version"` in `manifest.json`.

**Repeat-per-channel discipline:** a case marked with more than one channel in the
Channels column must be run once per marked channel — the shared logic file is identical,
but the injection path, storage bootstrap, and (for WhatsApp letters) the CORS bridge are
not. Where only one channel is marked, the case is channel-specific by design (e.g. the
letter bridge does not exist on the bookmarklet). Log Pass/Fail per channel, not once for
the row.

## Pre-req / test environment

- A logged-in dipi session on **centre 63** (`dipi.vridhamma.org`), desktop Chrome (primary —
  required for the extension, `FaceDetector` fallback, and `whatsapp://` deep links) plus at
  least one manual pass in Safari or Firefox for Photo Review's no-`FaceDetector` path.
- A course's `/search-course/63/{courseid}` page with a **mix of statuses**: some
  `Expected`, some `Confirmed`, and at least a few `WaitList`/`Review` rows in more than one
  group (NM/OM/SM/NF/OF/SF) so backfill candidates exist.
- At least a few applicants **with** an AID (`/app/{aid}` link resolvable) and a few
  **without** (to exercise the generic-fallback and disabled-button paths).
- At least one applicant with a **missing phone**, one with a **malformed/masked ID**, and
  one **duplicate** (same Aadhar/phone/name+DOB) already in the course, to trigger audit
  hard errors without waiting for real bad data.
- A second course page (visited earlier in the same browser) so cross-course dedup
  (audit + photo duplicates) has something to match against. A completely fresh profile is
  also needed once, to test the "nothing cached yet" edge cases.
- To load each channel:
  - **Extension:** `chrome://extensions` → Developer mode → Load unpacked → repo root.
  - **Tampermonkey:** install `scraper.user.js`, `course-audit/userscript.user.js`,
    `photo-review/userscript.user.js` from their GitHub Pages URLs.
  - **Bookmarklet:** `setup.html` → drag the all-in-one bookmarklet to the bookmarks bar.
  - Do **not** run the extension and Tampermonkey shells in the same profile for real
    testing except when the test case explicitly says so (EDGE-01) — auto-run can double-fire.

---

## Delivery / Install (INST)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| INST-01 | Extension load-unpacked | Chrome, repo cloned locally | 1. `chrome://extensions` → enable Developer mode. 2. Load unpacked → select repo root. | Extension installs as "DIPI Tools (Audit / Scrape / Photos)", version matches `manifest.json`, no console errors on the extensions page. | Ext | |
| INST-02 | Extension update = git pull + reload | Extension already loaded | 1. Edit any logic file (or `git pull` a real change). 2. Visit a dipi search-course page — old behavior should still show. 3. Go back to `chrome://extensions`, click Reload on the card. 4. Revisit the page. | Old behavior persists until step 3; new behavior only appears after explicit Reload — confirms `?v=Date.now()` cache-busting is inert on `chrome-extension://` URLs. | Ext | |
| INST-03 | `applicant.vridhamma.org` host permission pre-granted | Fresh extension install | 1. Open the extension's details page in `chrome://extensions`. 2. Check site access / permissions list. 3. On a dipi page, trigger a 💬 WhatsApp send for an applicant with an AID. | `host_permissions` for `https://applicant.vridhamma.org/*` is listed at install time; no runtime permission prompt appears when the letter fetch runs. | Ext | |
| INST-04 | Tampermonkey scraper install prompts for grants | Tampermonkey installed, script not yet added | 1. Open `scraper.user.js`'s raw URL. 2. Tampermonkey's install dialog appears. | Dialog lists `@grant GM_xmlhttpRequest` and `@connect applicant.vridhamma.org`; install succeeds. | TM | |
| INST-05 | Tampermonkey audit/photo installs need no special grants | Tampermonkey installed | 1. Open `course-audit/userscript.user.js` raw URL, install. 2. Repeat for `photo-review/userscript.user.js`. | Both install cleanly with `@grant none` — no elevated-permission dialog. | TM | |
| INST-06 | Bookmarklet install via setup.html | None | 1. Open `setup.html`. 2. Drag the all-in-one bookmarklet to the bookmarks bar. 3. On a dipi `/search-course/` page, click the bookmark. | All three FAB buttons (🔍 Audit, 📥 Scrape, 📷 Photos) appear bottom-right. | Bkm | |
| INST-07 | Bookmarklet on wrong host | Bookmarklet installed | 1. Click the bookmarklet on a non-`vridhamma.org` page. | Alert: "DIPI Tools: not on vridhamma.org. Run this bookmark on a dipi page." Nothing else happens. | Bkm | |
| INST-08 | README "Setup" step count vs list (doc-only) | — | Read `README.md` → "Setup (one-time)". | **Known doc bug (verify/fix separately):** the section is headed "Two options:" but lists three (Bookmarklet, Tampermonkey, Chrome extension). Not a code defect — flag for a docs fix, not a QA fail. | — | |

---

## Shared FAB stack & autorun (FAB)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| FAB-01 | Stack order and position | Any channel loaded on a search-course page | Load the page; observe the FAB stack. | Bottom-right, vertically stacked: ↻ Audit (order 10) above 🔄/📥 Scrape (20) above 📷 Photos (30). | Ext, TM, Bkm | |
| FAB-02 | Click-to-run is the default | Fresh profile / cleared localStorage | Load a search-course page without clicking any FAB. | No tool overlay opens automatically; all three FAB buttons render at reduced opacity (~0.55). | Ext, TM, Bkm | |
| FAB-03 | Right-click toggles autorun | FAB buttons present | 1. Right-click the ↻ Audit button. 2. Reload the page. | After right-click, button goes full-opacity and `localStorage.courseAudit.autorun` = `'true'`. After reload, the audit panel opens automatically once the DataTable is ready. | Ext, TM, Bkm | |
| FAB-04 | Autorun keys are independent per tool | Audit autorun ON from FAB-03 | Reload the page without touching Scrape/Photos autorun. | Only the audit panel auto-opens; Scrape and Photos remain click-to-run. | Ext, TM, Bkm | |
| FAB-05 | Scraper button label by page type | — | 1. Visit a `/search-course/…` page — observe scrape button label. 2. Visit `/centre/63` — observe it again. | `/search-course/`: "🔄 Scrape" (or "📥 Scrape" on the bookmarklet/extension). `/centre/`: "🧘 Pick Course". | Ext, TM, Bkm | |
| FAB-06 | Audit/Photos scoped to search-course pages | — | Visit `/centre/63` (not a search-course page). | ↻ Audit and 📷 Photos buttons are absent; only the Scrape/Pick-Course button shows. | Ext, TM | |

---

## Call Tracker — Scraper (SCR)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| SCR-01 | Course picker from `/centre/` | On `/centre/63` | Click Scrape/Pick Course. | Overlay lists "📅 Upcoming" courses with Exp/Conf/Σ badges, plus a collapsible "📁 All (N)" list; clicking a course navigates with the full status filter. | Ext, TM, Bkm | |
| SCR-02 | Direct scrape on search-course page | On a `/search-course/63/{id}` page with the full status filter already in the URL | Click Scrape. | Progress messages step through Loading → Expanding rows → Reading data → results screen with applicant count. | Ext, TM, Bkm | |
| SCR-03 | Narrow `?s=` filter auto-reload | Load a search-course URL with `?s=Expected,Confirmed` only (no WaitList/Review) | Click Scrape. | Message "Page filter is missing WaitList, Review — reloading…"; page reloads with the full `STATUS_FILTER` and the scrape resumes automatically (no user click needed). | Ext, TM, Bkm | |
| SCR-04 | Reload-loop guard (edge) | As SCR-03, but simulate dipi stripping/ignoring the `s=` param (e.g. via a redirect that drops it) | Trigger the scrape from the narrow-filter page. | After exactly one reload attempt, the retry flag (`_ds_flt_retry`) prevents a second reload; scraper proceeds with "Warning: page filter still missing…" instead of looping. | Ext, TM, Bkm | |
| SCR-05 | Show-All + full row expansion | Course with >1 page of applicants at default page size | Run a scrape. | DataTable page-length is forced to "All" (`-1`), all rows expand before reading; scraped count matches the total row count on the page. | Ext, TM, Bkm | |
| SCR-06 | AID capture, incl. rows missing an AID (edge) | Course with at least one row lacking a resolvable `/app/{id}` link | Scrape the course. | Results screen "AIDs captured: X/Y" where Y = total scraped and X < Y when a row has no AID; the AID-less applicant still appears in the tracker (blank `aid`). | Ext, TM, Bkm | |
| SCR-07 | Result badges accuracy | — | Compare Exp / Conf / 🪑 Pool / NM / OM / SM / NF / OF / SF badge counts against the actual dipi page. | All counts match; 🪑 Pool = WaitList + Review count. | Ext, TM, Bkm | |
| SCR-08 | Resume-vs-Scrape primary button | A session with `withProgress > 0` already exists for this course (`localStorage.dipiTracker.sessionIndex`) | Re-scrape the same course. | Primary button reads "📞 Resume Calling (N marked)" instead of "📞 Open Inline Call Tracker". | Ext, TM, Bkm | |
| SCR-09 | Copy Data / CSV / AID:Phone exports | Post-scrape results screen | Click each of 📋 Copy Data, 📊 Download CSV, 📤 Export AID:Phone in turn. | Clipboard alert shows correct count; CSV downloads with header `S.No,Name,AID,Mobile,Home,Office,Email,Status,Group,Type,Age` and correctly-escaped fields; AID:Phone file only includes rows with both an AID and a mobile, alert states the exported count. | Ext, TM, Bkm | |
| SCR-10 | Course-picker text vs actual filter (doc/UI discrepancy) | On `/centre/63`, open the picker | Read the picker's subtitle under "Select Course". | **Note:** subtitle reads "Expected + Confirmed" only, but the filter it actually navigates with (`STATUS_FILTER`) also includes WaitList and Review — the UI copy is stale relative to the pool feature. Not a functional bug (the scrape still captures the pool correctly), just misleading copy — flag for a text fix. | Ext, TM, Bkm | |

---

## Call Tracker — Dashboard core (TRK)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| TRK-01 | Fresh import creates a session | No existing session for this course | Complete a scrape, click the primary "Open Inline Call Tracker" button. | Tracker overlay opens with all applicants, alphabetically sorted, all `pending`. | Ext, TM, Bkm | |
| TRK-02 | Re-scrape merges by AID | Session already exists; some applicants have call progress | Re-scrape the same course (unchanged title+dates) and re-import. | Applicants matched by AID keep `status`/`attempts`/`lastAttempt`/`notes`; new applicants (no AID match) start `pending`. Toast: "Refreshed N applicants". | Ext, TM, Bkm | |
| TRK-03 | Removed applicant drops from session (edge) | An applicant from the prior scrape no longer appears in dipi's result set (e.g. status changed out of the filter) | Re-scrape and re-import. | That applicant is gone from the tracker entirely — merge is destructive on the roster, non-destructive only on matched call progress. | Ext, TM, Bkm | |
| TRK-04 | Status buttons | Session open, a card expanded | Click each of Confirmed / Cancelled / No Answer / Callback / Tentative / Left Msg in turn. | Card badge/icon/color updates immediately; `attempts` increments only for No Answer and Left Msg (not the others); toast shows "{Name} → {Status}". | Ext, TM, Bkm | |
| TRK-05 | Attempts counter via phone tap | Card expanded, applicant has a mobile | Tap the 📱 phone button. | `attempts` increments, `lastAttempt` updates, even though this only opens a `tel:` link (no actual call verification). | Ext, TM, Bkm | |
| TRK-06 | Notes persist | Card expanded | Type a note, collapse the card, close and reopen the tracker (or reload the page). | Note text is preserved (saved on every `input` event, not just on blur). | Ext, TM, Bkm | |
| TRK-07 | Phone buttons — mobile vs home | Applicant with mobile == home vs mobile != home | Expand both kinds of cards. | Home button only renders when `home` is present **and** different from `mobile`. | Ext, TM, Bkm | |
| TRK-08 | dipi status changer — success | Card expanded, applicant has an AID | Pick a non-Custom status from the dropdown, click Update. | Button shows "..." then re-enables; `dipiStatus` updates in the card meta line with the new Conf No if one was assigned; toast confirms. | Ext, TM, Bkm | |
| TRK-09 | dipi status changer — Custom with empty reason (negative) | Card expanded, AID present | Select "Custom", leave the text field blank, click Update. | Toast "Enter custom reason text"; no request sent. | Ext, TM, Bkm | |
| TRK-10 | dipi status changer — server/network failure (negative) | Simulate via offline mode or an invalid AID | Attempt an Update. | Button re-enables with its original label; toast shows "Failed: …" or "Network error: …"; `dipiStatus` unchanged. | Ext, TM, Bkm | |
| TRK-11 | Reconfirmation countdown chip | Session with parseable course dates | Click the ⏳ chip repeatedly. | Cycles T-7 → T-14 → T-21 → T-7…; `localStorage.dipiTracker.reconfirmDays` updates; chip color/level (ok/soon/urgent/over/past) matches days-to-deadline. | Ext, TM, Bkm | |
| TRK-12 | Priority sort pill | Mixed-status applicants | Toggle the ⏳ Priority / A–Z pill. | ON (default): pending/callback/no-answer/tentative float above confirmed/cancelled, alphabetical within rank. OFF: pure alphabetical. Persists via `localStorage.dipiTracker.prioritySort`. | Ext, TM, Bkm | |
| TRK-13 | Group filter pills | Applicants across multiple groups | Click an NM/OM/SM/NF/OF/SF pill. | List filters to that group only; click again (or "All") to clear. | Ext, TM, Bkm | |
| TRK-14 | Search box | — | Type a partial name while the box has focus. | List filters live; focus and caret position survive the re-render (no need to re-click the box after each keystroke). | Ext, TM, Bkm | |
| TRK-15 | Status filter pills | — | Click a status pill (e.g. ❌ Cancelled count). | List filters to that status; click again to return to "All". | Ext, TM, Bkm | |
| TRK-16 | Re-scrape button | Tracker open | Click 🔄 Re-scrape. | Tracker closes, scraper re-invokes on the same page (`DipiScraper.run()`). | Ext, TM, Bkm | |
| TRK-17 | Empty-state previous sessions | No active session in this tab (fresh open, `DipiTracker.open()`) | Open the tracker with sessions already in IndexedDB from other courses. | "Previous Sessions" list shown with title/count/date; clicking one loads it. | Ext, TM, Bkm | |

---

## Call Tracker — WhatsApp & letter bridge (WA)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| WA-01 | Personalized letter send | Applicant has AID and mobile; bridge available | Click 💬 WhatsApp on the card. | Toast "Fetching letter…" then "Personalized message ready!"; WhatsApp opens (app or web per pill) pre-filled with the real letter text (greeting visible, no leading boilerplate lines). | Ext, TM | |
| WA-02 | No-AID fallback (negative) | Applicant has a mobile but no AID | Click 💬 WhatsApp. | Generic Hindi template sent immediately (no fetch attempt); toast "No AID — sent generic". | Ext, TM, Bkm | |
| WA-03 | Letter fetch failure/timeout (negative) | Applicant has AID; simulate failure (offline, or block the bridge) | Click 💬 WhatsApp. | After the bridge's 25 s timeout (or an immediate error), falls back to the generic template; toast "Letter fetch failed — sent generic". | Ext, TM | |
| WA-04 | 💬 App vs 💬 Web pill | — | Toggle the header pill; send a WhatsApp message in each mode. | App mode: `whatsapp://send?...` (no new browser tab). Web mode: new tab to `wa.me/...`. Persists via `localStorage.dipiTracker.waMode`. | Ext, TM, Bkm | |
| WA-05 | App mode without WhatsApp desktop installed (negative, verify) | 💬 App mode, machine has no WhatsApp app | Click 💬 WhatsApp. | Browser shows its own "no application found to open this link" handling (OS/browser-level, not app-controlled); no JS error in console. (verify — exact browser behavior varies.) | Ext, TM, Bkm | |
| WA-06 | Bare 10-digit number gets 91 prefix | Applicant's stored mobile has no country code (edge — shouldn't normally happen since `fmtPhone` adds `+91`, but test a manually-edited/imported record) | Send WhatsApp. | `openWa` still prefixes bare 10-digit numbers with `91` before opening the link. | Ext, TM, Bkm | |
| WA-07 | No phone at all (negative) | Applicant has neither mobile nor home | Click 💬 WhatsApp. | Toast "No phone number"; no WhatsApp action, no attempt logged. | Ext, TM, Bkm | |
| WA-08 | Extension letter-bridge allow-list | Extension channel | From devtools console on the dipi page, `postMessage({__dipiLetter:'req', id:'x', url:'https://applicant.vridhamma.org/evil'}, location.origin)`. | `background.js` rejects with "URL not allowed" (regex requires `l.php?a=`); no fetch is made to the arbitrary URL. | Ext | |
| WA-09 | Tampermonkey letter-bridge allow-list | TM channel | Same as WA-08. | `scraper.user.js`'s bridge handler answers `{ok:false, error:'URL not allowed'}` without calling `GM_xmlhttpRequest`. | TM | |
| WA-10 | Bookmarklet has no bridge (negative) | Bkm channel, applicant has AID | Click 💬 WhatsApp. | `data-dipi-letter-bridge` is unset, so a direct `fetch()` is attempted and fails fast (CORS) — generic fallback used, no 25 s wait. | Bkm | |
| WA-11 | Course Audit "💬 notify" per-finding button (undocumented in `course-audit/README.md` — see report) | Audit panel open, a finding with a fixable field (e.g. `email_malformed`) on an applicant with a valid 10-digit mobile | Click "💬 notify" next to that finding. | WhatsApp opens to the applicant's own mobile with a Hindi message listing all their fixable issues for that row; the button becomes "✓ sent" and further clicks are no-ops. | Ext, TM, Bkm | |
| WA-12 | "💬 notify" absent for non-fixable findings (edge) | A finding like `conf_no_duplicate` (admin-side, not applicant-fixable) or an applicant with no resolvable mobile | Inspect that finding row. | No "💬 notify" button rendered (`notifyLine()` returns null, or `applicantE164()` returns null). | Ext, TM, Bkm | |

---

## Call Tracker — Wait-list backfill pool (BF)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| BF-01 | Pool kept out of main queue/stats | Course scraped with WaitList/Review rows | Open the tracker. | Main list + stat counts exclude pool members; 🪑 Pool pill shows the pool count separately; clicking it filters to pool view. | Ext, TM, Bkm | |
| BF-02 | Cancelling surfaces same-group candidates | A main (non-pool) applicant with a group code, e.g. NM; pool has NM candidates | Mark that applicant Cancelled. | Expanded card shows "🪑 Seat freed — backfill candidates (group NM)" with up to 3 pending-first NM pool candidates and a jump-to-card button on each. | Ext, TM, Bkm | |
| BF-03 | Cancelled applicant with no group code (edge, verify) | A main applicant whose `group` is blank/undefined | Mark them Cancelled. | Current code (`!cancelled.group \|\| a.group === cancelled.group`) surfaces pool candidates from **every** group when the cancelled row has no group — confirm this is the intended behavior (the inline code comment's wording is ambiguous; verify it isn't actually meant to show zero candidates). | Ext, TM, Bkm | |
| BF-04 | Jump-to-card | Backfill candidates shown per BF-02 | Click a candidate button. | Filter switches to Pool, group/search filters clear, that candidate's card is expanded automatically. | Ext, TM, Bkm | |
| BF-05 | Confirmed/cancelled pool members excluded (edge) | A pool (WaitList/Review) applicant already marked `confirmed` or `cancelled` in the tracker | Cancel a same-group main applicant. | That pool member does NOT appear in the backfill candidate list (already resolved, offering again would double-book or is pointless). | Ext, TM, Bkm | |
| BF-06 | Empty pool for the freed group (edge) | No pool candidates exist in the cancelled applicant's group | Cancel that applicant. | Backfill box shows "No wait-list/review candidates in group {X} — check the 🪑 pool pill" instead of an empty list. | Ext, TM, Bkm | |
| BF-07 | Group pill counts include pool (known limitation) | Pool + main applicants in the same group | Compare a group pill's count to the number of visible rows in the main list for that group. | Pill count includes pool members even though the main view doesn't list them — numbers won't visually add up. This is a known, accepted limitation (`TODO.md` #10), not a bug to file. | Ext, TM, Bkm | |

---

## Call Tracker — Export / Backup (EXP)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| EXP-01 | Copy for WhatsApp | Session with mixed statuses | Export → 📋 Copy for WhatsApp. | Clipboard text grouped by status with emoji headers, per-applicant name+mobile lines, and a totals footer. | Ext, TM, Bkm | |
| EXP-02 | Download CSV | — | Export → 📊 Download CSV. | File downloads named `{course}_results.csv`; header `S.No,Name,AID,Group,Mobile,Home,Status,Attempts,LastAttempt,Notes`; names/notes with commas or quotes are correctly CSV-escaped. | Ext, TM, Bkm | |
| EXP-03 | Print / PDF | — | Export → 🖨️ Print / PDF. | New tab opens with a styled summary table and auto-triggers the print dialog; if popups are blocked, toast "Popup blocked — allow popups to print" instead of a silent failure. | Ext, TM, Bkm | |
| EXP-04 | AID:Phone export | Some applicants lack an AID or phone (edge) | Export → 📤 AID:Phone for script. | Only rows with **both** AID and mobile are included; if none qualify, toast "No AIDs to export" and no file downloads. | Ext, TM, Bkm | |
| EXP-05 | Backup session (JSON) | Active session | Export → 💾 Backup session (JSON). | Downloads `session_{title}_{date}.json` containing `{kind:'dipiTracker.session', v:1, session:{...}}`; toast warns it contains applicant data. | Ext, TM, Bkm | |
| EXP-06 | Import backup — merge into existing session | A backup from an earlier point in the same course's history; local session has since progressed further on some applicants | Export → 📂 Import backup…, pick the file. | Merges by AID (falls back to name+mobile): newest `lastAttempt` wins per applicant, notes are never silently dropped (kept from the losing side if the winner has none), attempts take the max of both. Toast shows updated/added counts. | Ext, TM, Bkm | |
| EXP-07 | Malformed backup import (negative) | A `.json` file that is invalid JSON, or valid JSON missing `kind`/`v`/`session.applicants` | Import that file. | Rejected with a specific reason ("Not a tracker session backup" / "Unsupported backup version: …" / "Backup is missing session data"); no session data is modified. | Ext, TM, Bkm | |
| EXP-08 | Import backup for a brand-new course (edge) | Backup from a course with no matching session in this browser (no id/title+dates/courseKey match) | Import it. | A new session is created (not merged); if the incoming `id` collides with an existing unrelated session, a fresh id is generated instead of overwriting. | Ext, TM, Bkm | |

---

## Course Audit (AUD)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| AUD-01 | Default split-view layout | — | Run the audit (click ↻ Audit or auto-run). | Page content shrinks to 60vw on the left; audit iframe fills the remaining 40vw at full viewport height. | Ext, TM, Bkm | |
| AUD-02 | Float/Split toggle persists | Audit panel open | Click ⇆ Float, close, re-run the audit. | Panel renders as a floating 580px card instead; `localStorage.courseAudit.mode` = `'float'` and the preference survives a fresh run. | Ext, TM, Bkm | |
| AUD-03 | Findings sections and counts | Course with at least one known-bad row (missing field, malformed email, etc.) | Inspect Hard errors / Safety / Cross-course / Soft sections. | Section counts match the actual data; Hard errors expanded by default, Safety expanded only if non-empty, color coding (red/amber/blue/gray) matches. | Ext, TM, Bkm | |
| AUD-04 | PAN presence checkbox | Course with an applicant missing both Aadhar and PAN | 1. Leave "Also scan for PAN card presence" unchecked — observe. 2. Check it — observe. | Unchecked (default): no `pan_missing` hard error, only Aadhar-shaped `id_missing`. Checked: `pan_missing` hard error appears for applicants with no PAN in any of the three source fields; re-check runs immediately (no manual re-run needed) and `localStorage.courseAudit.checkPan` persists. PAN **validity** checks on a PAN that IS present run either way. | Ext, TM, Bkm | |
| AUD-05 | Hard-error checks fire correctly | Seeded bad rows (masked Aadhar, short phone, malformed email, duplicate Conf No, name with a title prefix, etc.) | Review the Hard errors list against each seeded row. | Each check (`missing_field`, `phone_short`, `phone_prefix_invalid`, `email_missing`, `email_malformed`, `aadhar_masked`, `aadhar_length`, `id_missing`, `id_type_concatenated`, `id_type_unknown`, `id_type_mismatch`, `age_dob_mismatch`, `age_under_min`/`age_over_max`, `conf_gender_mismatch`, `conf_no_duplicate`, `within_file_duplicate`, `status_unknown`, `name_title_prefix`) fires on its matching row and nowhere else. | Ext, TM, Bkm | |
| AUD-06 | Safety flags | Applicant whose emergency contact = own mobile; another with only an emergency name OR only a phone (not both) | Review Safety section. | `emergency_eq_self` and `emergency_partial` fire correctly, nowhere else. | Ext, TM, Bkm | |
| AUD-07 | Soft flags | Two applicants sharing a mobile (e.g. family); two sharing an email with different surnames | Review Soft section. | `shared_mobile` and `shared_email_unrelated` fire; a shared mobile/email between people with the *same* surname does not trip `shared_email_unrelated` (surname check). | Ext, TM, Bkm | |
| AUD-08 | Sensitive field counts | Applicants with real Physical/Mental Health/Medication/Pregnancy/Addiction disclosures vs blank/"No"/"NA" | Check the "Sensitive field counts" panel. | Counts include only meaningful values, excluding blank/no/na/none/-. | Ext, TM, Bkm | |
| AUD-09 | Cross-course duplicate detection | Two course pages visited in this browser, sharing an applicant (by Aadhar, PAN, phone, email, or name+DOB) | Visit course 1 (audit runs, caches). Visit course 2, run audit. | Cross-course section on course 2 lists the shared applicant with the courses/match-by tags (aadhar/PAN/phone/email/name+DOB). | Ext, TM, Bkm | |
| AUD-10 | Clear cache | Cross-course cache populated (AUD-09) | Click "Clear cache", confirm. | `localStorage.courseAudit.cache` emptied, panel closes; next run on any course shows an empty Cross-course section until re-visited. | Ext, TM, Bkm | |
| AUD-11 | For Teachers Review noise filter | Applicants with generic-positive disclosures ("good", "happy and satisfied"), geographic noise in Other Info, and genuine disclosures ("depressed", multi-word free text) | Click "For Teachers Review". | Clipboard prompt excludes noise (generic positives, city/state names, "No" pregnancy for anyone, all pregnancy fields for males) and keeps genuine disclosures; alert states the count sent. | Ext, TM, Bkm | |
| AUD-12 | Zero-disclosure edge case | A course with no active applicant having any sensitive disclosure beyond noise | Click "For Teachers Review". | Alert: "No disclosures after noise filter. Nothing to send." — clipboard untouched. | Ext, TM, Bkm | |
| AUD-13 | Send to WhatsApp — recipient validation | Audit panel open | Open "Send to WhatsApp" modal; enter an invalid number (e.g. +91 with 9 digits, or starting with 5). | Inline error: "Invalid number. For India: 10 digits starting 6-9. Otherwise 7-15 digits total." Send blocked. | Ext, TM, Bkm | |
| AUD-14 | Save recipient | WhatsApp modal open | Enter a valid number, check "Save as", type a label, send. | Chip appears under "Saved" on next open; `localStorage.courseAudit.whatsapp.recipients` updated; clicking × removes it. | Ext, TM, Bkm | |
| AUD-15 | Recent numbers | Sent to at least one un-saved number before | Reopen the modal. | That number appears under "Recent" (max 5, excludes saved numbers); clicking sends immediately. | Ext, TM, Bkm | |
| AUD-16 | ✕ Close restores page | Split-view panel open | Click ✕ Close. | Panel/iframe removed; original page DOM children reinserted at full width, no residual `ca-page-wrapper`. | Ext, TM, Bkm | |
| AUD-17 | Face-duplicate flags surfaced from Photo Review | Photo Review's 👥 Duplicates has been run for this course (see DUP-02) | Run the audit on the same course. | Cross-course section count includes "+ N 👥"; expanding it shows the face-match rows (name ↔ otherName, distance, tier) with the "verify ID documents" caveat. | Ext, TM, Bkm | |
| AUD-18 | No face-scan yet (edge) | Photo Review 👥 Duplicates never run for this course | Run the audit. | Cross-course section shows only the normal duplicate matches (or none) — no error, no stray "👥" fragment in the count. | Ext, TM, Bkm | |
| AUD-19 | Empty cross-course cache (edge) | Fresh profile, this is the first course ever audited | Run the audit. | Cross-course section shows 0 with no errors; "Cache" details panel shows "(empty)". | Ext, TM, Bkm | |

---

## Photo Review — manual review (PR)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| PR-01 | Grid loads lazily | Course with 20+ applicant photos | Open 📷 Photos, scroll down slowly. | Only near-viewport cards fetch their photo (IntersectionObserver, 400px margin); off-screen cards show a "loading…" placeholder until scrolled near. | Ext, TM, Bkm | |
| PR-02 | Manual rotate | A card selected | Click ↺, ↻, and 180° in turn. | Canvas updates immediately each time; correction persists to `localStorage.photoReview.corrections`; re-opening the course later re-applies it. | Ext, TM, Bkm | |
| PR-03 | Manual crop | A card selected | Click ✂, drag a box on the canvas, release. | Dashed box tracks the drag; on release (min 6% size) the crop is applied; dragging a second crop composes with the first (crops relative to the currently-cropped view). | Ext, TM, Bkm | |
| PR-04 | Crop cancel/clear | Crop mode active | Press Esc mid-drag; separately, click ✂ again on an already-cropped card. | Esc cancels the in-progress drag with no crop applied. Clicking ✂ on a cropped card clears the crop entirely. | Ext, TM, Bkm | |
| PR-05 | Mark reviewed | Any card | Click ✓. | Card dims (opacity) and gets a green border; toggling again reverses it. | Ext, TM, Bkm | |
| PR-06 | Download corrected JPEG | A card with a rotation/crop applied | Click ⬇. | Downloads `{aid or photoId}_{name}.jpg`. | Ext, TM, Bkm | |
| PR-07 | Keyboard shortcuts | A card selected, focus NOT in a text field | Press →/←, `r`, `d`, `s` in turn; then click into a note-like input elsewhere and repeat. | →/← move selection among currently *visible* (filtered) cards only; `r` rotates 90°; `d` toggles done; `s` downloads. With focus in an input/textarea/select, none of these fire. | Ext, TM, Bkm | |
| PR-08 | Filter pills | Mixed suggested/auto-fixed/fixed/unreviewed cards (run after PRA-01/PRA-04) | Click each pill: All / ⚠ Suggested / ✨ Auto-fixed / ✓ Fixed / ⏳ Unreviewed. | Grid scopes to exactly the matching cards; pill labels show live counts. | Ext, TM, Bkm | |
| PR-09 | Photo load failure (negative) | A photo URL that 404s or times out (simulate via devtools network block) | Open Photo Review, let that card attempt to load. | Card shows "load failed" instead of an infinite "loading…" spinner state. | Ext, TM, Bkm | |
| PR-10 | Row with unparseable photo URL (edge) | A DataTable row whose `photo` field doesn't match `/show-photo/{digits}/` | Open Photo Review. | That row is silently excluded from the grid (no crash, no blank card). | Ext, TM, Bkm | |
| PR-11 | No photos at all (edge) | A course/test page with zero photo rows | Open Photo Review. | "No photos in this course's rows" empty-state message, no console error. | Ext, TM, Bkm | |
| PR-12 | ♻ Reset local | Some corrections + at least one 👥 Duplicates scan done | Click ♻ Reset local, confirm. | Confirm dialog states the exact stored-photo count. After confirming: all rotations/crops/✓/✨/uploaded markers clear across every course (not just the open one), plus `vcall_faces` IndexedDB and `faceDedup.flags` are wiped. Photos already uploaded to dipi are untouched on the server. | Ext, TM, Bkm | |

---

## Photo Review — auto-scan / auto-fix (PRA)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| PRA-01 | ⚡ Auto-scan suggests only | A mix of upright, rotated, and zoomed-out photos | Click ⚡ Auto-scan, wait for completion. | Amber "suggest ↻N° / ✂ zoom" badges appear on photos needing a fix; nothing is applied automatically; toast reports "N photo(s) look wrong". | Ext, TM, Bkm | |
| PRA-02 | ▦ Boxes overlay | After PRA-01 | Click ▦ Boxes. | Each uncropped card overlays the detected face box + area % for its currently displayed rotation; cards with a crop suggestion also show a dashed green 260:280 preview rectangle. | Ext, TM, Bkm | |
| PRA-03 | ✓ good badge | A photo whose face area lands in the 20–45% band with nothing to fix | Run Auto-scan. | Green "✓ good N%" badge appears (positive confirmation, no action needed). | Ext, TM, Bkm | |
| PRA-04 | ✨ Auto-fix applies high-confidence fixes | Same seeded mix as PRA-01, Chrome | Click ✨ Auto-fix. | High-confidence rotation/crop fixes are applied directly (blue border + "✨ auto" badge); everything else stays an amber suggestion or is left for manual review if no face was found. | Ext (Chrome only per README) | |
| PRA-05 | Confirm / revert an auto-fix | A card with the "✨ auto" badge | Click ✓ to keep it; on a different auto-fixed card, click the blue badge itself. | ✓ marks it done (still eligible for later "Accept all"/upload flows). Clicking the badge reverts rotation/crop/auto flag to the untouched original. | Ext | |
| PRA-06 | ✓ Accept all fixes (bulk consent) | Several auto-fixed and/or manually-corrected, not-yet-done photos | Click "✓ Accept all fixes", confirm. | Confirm dialog states total count and how many are unreviewed auto-fixes; confirming marks every one of them `done` in one click; nothing is uploaded to dipi by this action. | Ext, TM, Bkm | |
| PRA-07 | No detection backend available (negative) | Safari or Firefox (no `FaceDetector`), or MediaPipe vendor assets unreachable | Click ⚡ Auto-scan or ✨ Auto-fix. | Toast: "No face detection available — model CDN unreachable and no native FaceDetector. Manual review only." Manual rotate/crop/done/download continue to work normally. | Any (test in Safari/Firefox) | |
| PRA-08 | No face found (edge) | A photo with no detectable face (e.g. a blank/corrupted upload) | Run Auto-scan. | Gray "no face found" badge, not counted toward "suggested"; left for manual review. | Ext, TM, Bkm | |
| PRA-09 | Small face rescans at higher resolution (edge) | A large full-body/whole-page photo where the face is small enough to miss the first-pass 640px scan | Run Auto-scan. | If the first pass finds nothing at any rotation and the source resolution allows it, a sharper 1024px rescan runs automatically; a genuine tiny face is still found and suggested. | Ext, TM, Bkm | |
| PRA-10 | 180° flip never auto-applies without landmarks | A photo needing a 180° flip on a platform/detector returning no landmarks (area-dominance path) | Run Auto-fix. | 180° stays an amber suggestion even at high area-dominance confidence; only 90°/270° auto-apply in the no-landmarks path. With landmarks available (MediaPipe), 180° can auto-apply. | Ext (both MediaPipe and native-fallback paths if testable) | |
| PRA-11 | Off-center face crop stays a suggestion (edge) | A high-confidence tiny-face detection where the face is near the frame edge | Run Auto-fix. | Rotation may auto-apply, but the crop stays a suggestion (not auto-applied) because `cropIsSafe`'s centering margin fails. | Ext | |

---

## Photo Review — cross-course duplicates (DUP)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| DUP-01 | First-ever scan, nothing to compare against (edge) | Fresh profile, `vcall_faces` empty | Click 👥 Duplicates. | Indexes the current course's faces; toast "No matching faces — indexed N face(s)…, compared across 0 stored course(s)" (or similar); no errors. | Ext, TM, Bkm | |
| DUP-02 | Genuine cross-course repeat | An applicant present (same face) in two different courses previously scanned via Photo Review | Run 👥 Duplicates on the second course. | Matching card gets a maroon dup badge (solid = strong ≤0.45, translucent = possible ≤0.55); a summary modal lists the match with distance/tier and the "lead, not proof" caveat. | Ext, TM, Bkm | |
| DUP-03 | Within-course duplicate | Two rows in the SAME course that are actually the same person (different AIDs) | Run 👥 Duplicates. | Both cards get a dup badge referencing each other, labeled "dup in course:". | Ext, TM, Bkm | |
| DUP-04 | Flags surface in the audit panel | 👥 Duplicates run on this course (DUP-02/03) | Run the Course Audit on the same course. | Cross-course section shows the face matches (see AUD-17). | Ext, TM, Bkm | |
| DUP-05 | No-face / no-AID rows excluded (edge) | A row with no detectable face, or no AID | Run 👥 Duplicates. | That row is skipped from indexing (counted under "noFace" in the toast), never appears in match results. | Ext, TM, Bkm | |
| DUP-06 | 12-course retention cap (edge, verify) | 13+ distinct courses indexed over time in one browser | Index a 13th course. | Oldest course's descriptors are evicted from `vcall_faces` (verify via DevTools → Application → IndexedDB, since there's no UI surface for this). | Ext, TM, Bkm | |
| DUP-07 | Reset local wipes face data | Face data indexed | Run ♻ Reset local (PR-12). | `vcall_faces` DB and `faceDedup.flags` are gone; a subsequent 👥 Duplicates run starts from zero. | Ext, TM, Bkm | |

---

## Photo Review — write-back to dipi (UP)

**Caution:** these cases POST to dipi and modify a live applicant record. Use a disposable/test
applicant or get sign-off before running against real course data — see the README's own
"First-use checklist" (UP-10).

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| UP-01 | Dry-run preview | A corrected (rotated/cropped), AID-bearing photo | Click ⬆dipi. | Modal lists every field being resubmitted with sensitive values masked (phone/email/document_id show as `XXXX…1234` / `u…@domain`), the photo swap highlighted; Cancel sends nothing. | Ext, TM, Bkm | |
| UP-02 | Commit — clean success | UP-01 preview open | Click "Commit upload to dipi". | POST succeeds; re-fetch confirms no other field drifted; toast "✓ Uploaded — all other fields preserved"; stored geometry zeroes, `uploaded` marker persists, button becomes disabled "✓dipi". | Ext, TM, Bkm | |
| UP-03 | Staleness recheck aborts a stale upload (negative) | Dry-run modal open; from a second tab/session, edit the same applicant's record on dipi before clicking Commit | Click Commit. | Upload aborts, naming the changed field(s); nothing is sent; user is told to re-run ⬆dipi to preview current values. | Ext, TM, Bkm | |
| UP-04 | Form validation rejection (negative) | A record where a required field is momentarily invalid, or simulate a validation trip | Commit an upload. | Reported as "form rejected (validation error) — nothing saved" (detected because Drupal re-renders back to the `/edit` URL). | Ext, TM, Bkm | |
| UP-05 | Post-upload drift warning (negative, hard to force — verify) | A field changes on dipi in the brief window between POST and the verify re-fetch | Commit an upload during that window if reproducible. | Warning alert lists the drifted field name(s); user told to check the record; the item is still marked uploaded (its geometry is zeroed regardless, so it's never re-applied). | Ext, TM, Bkm | |
| UP-06 | Batch upload stops at first failure | Several done+corrected+AID-bearing, not-yet-uploaded photos; one seeded to fail (e.g. stale AID) | Click "⬆ Upload fixed to dipi", confirm. | Processes in order; on the first failure/drift it alerts with the count uploaded so far and stops (does not continue past the bad one). | Ext, TM, Bkm | |
| UP-07 | Batch skips already-uploaded (edge) | Some photos already uploaded in a prior batch run; page reloaded | Run the batch again. | Already-uploaded photos (persisted `uploaded` marker) are excluded from the batch, not re-sent. | Ext, TM, Bkm | |
| UP-08 | No-AID upload attempt (negative) | A corrected photo with no AID | Inspect the ⬆dipi button. | Disabled, tooltip "No application id — cannot upload". | Ext, TM, Bkm | |
| UP-09 | No-correction upload attempt (edge) | An untouched photo (rot=0, no crop) | Inspect the ⬆dipi button. | Disabled, tooltip "Rotate or crop first". | Ext, TM, Bkm | |
| UP-10 | First-use checklist (run once before trusting batch upload, per `photo-review/README.md`) | A known test applicant | 1. Correct one photo, mark ✓, click ⬆dipi, commit. 2. Open that applicant's `/app/{aid}/edit` on dipi directly. | Name, Aadhar/document id, phone, emergency contact, and health disclosures are all intact; only the photo changed and is now upright. Only after this passes should the batch button be trusted on real data. | Ext, TM, Bkm | |

---

## Privacy invariants (PRIV)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| PRIV-01 | No unexpected network egress | DevTools Network tab open, filter cleared | Do a full session: scrape → mark statuses → send one WhatsApp → export CSV. | Only same-origin `dipi.vridhamma.org` requests plus the one explicit `applicant.vridhamma.org/l.php` letter fetch appear. No third-party analytics/telemetry calls. | Ext, TM, Bkm | |
| PRIV-02 | Face descriptors never leave `vcall_faces` | 👥 Duplicates run at least once | Inspect DevTools → Application → IndexedDB (`vcall_faces`) and → Local Storage (`faceDedup.flags`) and the Network tab during a scan. | Descriptors (128-d Float32Arrays) exist only in `vcall_faces`; `faceDedup.flags` in localStorage contains only names/distances/tier, no numeric descriptor arrays; no network request carries descriptor data. | Ext, TM, Bkm | |
| PRIV-03 | Letter bridge URL allow-list | See WA-08/WA-09 | (cross-ref) | Confirmed by WA-08/WA-09. | Ext, TM | |
| PRIV-04 | WhatsApp course summary contains no raw PII | Audit panel, "Send to WhatsApp" preview | Inspect the preview text. | Contains only row indices, applicant names, short check labels, sensitive-field **counts** (not values), and the course URL — no Aadhar/DOB/mobile/free-text disclosures. | Ext, TM, Bkm | |
| PRIV-05 | Exported files carry PII responsibly (doc check) | — | Re-read the export toasts/README wording for CSV/backup/AID:phone exports. | Each carries or is documented with a "handle like applicant data" warning; none is auto-uploaded anywhere by the tool itself. | — | |
| PRIV-06 | Photo pixels stay local except explicit actions | Auto-scan/Auto-fix/Duplicates run | Watch the Network tab during each. | Only same-origin `show-photo/{id}` GETs (and, for write-back, the explicit `/app/{aid}/edit` POST) appear — no background upload during scanning/matching. | Ext, TM, Bkm | |

---

## Cross-channel & misc edge cases (EDGE)

| ID | Feature | Preconditions | Steps | Expected result | Channels | Pass/Fail |
|---|---|---|---|---|---|---|
| EDGE-01 | Extension + Tampermonkey both active (verify) | Both installed in one profile, deliberately (against the documented advice) | Load a search-course page with autorun on for at least one tool. | Buttons dedupe by DOM id (no visual duplicate), but confirm whether the tool's overlay opens twice / auto-runs twice — expect a cosmetic double-invoke at worst since each tool tears down its own previous overlay on injection; document actual behavior. | Ext+TM together | |
| EDGE-02 | Bookmarklet always uses the generic WhatsApp fallback | Bkm channel, applicant has an AID | Send WhatsApp. | Always the generic Hindi template, never the personalized letter (no bridge exists on this channel) — this is expected, not a bug. | Bkm | |
| EDGE-03 | Stale narrow-filter bookmark re-scrape | An old saved URL/bookmark with `?s=Expected,Confirmed` only | Trigger a scrape from it. | See SCR-03 — auto-reloads with the full filter rather than silently dropping the WaitList/Review pool. | Ext, TM, Bkm | |
| EDGE-04 | Applicant with no phone at all | A scraped row with both mobile and home blank | Expand that card. | No phone buttons, no WhatsApp button render; status can still be set manually; notes still work. | Ext, TM, Bkm | |
| EDGE-05 | Applicant with no AID | A scraped row with no AID | Expand that card. | No dipi-status-changer block renders (requires an AID); WhatsApp always uses the generic fallback (WA-02); group-based backfill matching still works if a group is present. | Ext, TM, Bkm | |
| EDGE-06 | Malformed backup import | — | (cross-ref EXP-07) | Confirmed by EXP-07. | Ext, TM, Bkm | |
| EDGE-07 | Cross-course dedup with nothing cached yet | — | (cross-ref AUD-19, DUP-01) | Confirmed by AUD-19/DUP-01. | Ext, TM, Bkm | |
| EDGE-08 | Empty pool when a seat frees | — | (cross-ref BF-06) | Confirmed by BF-06. | Ext, TM, Bkm | |
| EDGE-09 | 💬 App with no WhatsApp app installed | — | (cross-ref WA-05) | Confirmed by WA-05. | Ext, TM, Bkm | |
| EDGE-10 | "Pick Different Course" from an already-scraped page | On a `/search-course/` page, scraper overlay open at its initial choice screen | Click "📋 Pick Different Course" instead of "🔄 Scrape This Page". | Course picker opens (same as SCR-01) instead of scraping the current page. | Ext, TM, Bkm | |

---

## Regression smoke test

Run this short-list after any change, and always before a live course. Kept
non-destructive (no dipi writes) so it can run often without risk — full write-back
testing (UP-*) is a separate, deliberate pass per the README's first-use checklist.

1. **INST** — Load/refresh each channel you're about to use; confirm no console errors on a search-course page load.
2. **SCR-02 / SCR-07** — Scrape a real course; badge counts (Exp/Conf/Pool/groups) match the dipi page.
3. **TRK-01 / TRK-04** — Open the tracker, mark one applicant Confirmed, reload the page, confirm it stuck.
4. **WA-01 / WA-02** — WhatsApp send with an AID gets the personalized letter; without an AID gets the generic fallback.
5. **TRK-11 / TRK-12** — Reconfirmation chip cycles T-7/14/21; priority sort pill toggles order.
6. **BF-02** — Cancel a confirmed applicant with pool candidates in their group; backfill list appears correctly.
7. **EXP-05 / EXP-06** — Export a backup, re-import it, confirm a clean non-destructive merge.
8. **AUD-03 / AUD-04** — Run the audit; hard-error/safety counts are non-zero on a known-bad row; PAN checkbox toggles `pan_missing` correctly.
9. **PRA-01 / PR-02 / PR-06** — Auto-scan a course; manually rotate/crop one photo and download it.
10. **PR-12** — ♻ Reset local cleanly wipes photo/face data with no console errors, dipi untouched.
