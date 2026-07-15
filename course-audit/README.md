# dipi.vridhamma.org Course Audit

Browser tool that audits the applicants page at `https://dipi.vridhamma.org/search-course/{centreid}/{courseid}` for data-quality issues, safety flags, and cross-course double-bookings. Hosted as static JS on GitHub Pages at `https://kapaggar.github.io/callconfirm/course-audit/`.

## Files

| File | Role |
|---|---|
| `audit.js` | Pure rule engine. Framework-agnostic. Takes an array of attendee objects, returns findings. |
| `loader.js` | Adapter for dipi.vridhamma.org. Renders the audit panel, handles Send to Claude / Send to WhatsApp / Export JSON. |
| `userscript.user.js` | Tampermonkey shell. Auto-injects `loader.js` on every dipi `/search-course/` page load. |
| `bookmarklet.txt` | Manual one-click alternative to the userscript. |

## Install — pick one

### A. Tampermonkey userscript (recommended)

One-time install, auto-runs on every applicants page, auto-updates when you push changes.

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome / Firefox / Edge / Safari).
2. Open `https://kapaggar.github.io/callconfirm/course-audit/userscript.user.js` in your browser. Tampermonkey will prompt to install.
3. Visit any `https://dipi.vridhamma.org/search-course/...` page. The audit panel auto-appears once the DataTable finishes loading (usually <2 seconds).
4. A floating `↻ Audit` button bottom-right re-runs the audit any time (useful after editing rows). Right-click the button to toggle auto-run on/off.

Tampermonkey checks for script updates daily. `loader.js` and `audit.js` update every click via cache-buster, so audit logic changes propagate instantly — no userscript reinstall needed.

### B. Bookmarklet (no extension)

For machines where Tampermonkey isn't available.

1. Open `bookmarklet.txt`, copy the `javascript:...` line.
2. Drag into your bookmarks bar (or right-click bookmarks → Add → paste as URL).
3. On a dipi `/search-course/` page, click the bookmark.

## UI

Default layout: split-view. Page shrinks to 60vw on the left, audit iframe occupies 40vw on the right at full viewport height. Toggle to floating overlay via the `⇆ Float` button. Preference saved in `localStorage.courseAudit.mode`.

Section headers (Hard errors / Safety / Cross-course / Soft) render at 16px bold with color coding (red/amber/blue/gray). Rows are 12px.

A checkbox above the findings — "Also scan for PAN card presence" — controls the `pan_missing` hard error. Unchecked (default), ID-presence scanning covers Aadhar only; check it to also flag applicants without a PAN (needed for donation receipts). PANs that ARE present are always validated (format, Aadhar-in-PAN-slot mismatch) regardless of the checkbox. Preference saved in `localStorage.courseAudit.checkPan`.

## Action buttons in the panel

| Button | Behavior |
|---|---|
| **Send to Claude** | Builds a noise-filtered prompt (~15–25 rows from a 200-row course), copies to clipboard. Paste into Claude.ai or Claude in Chrome. |
| **Send to WhatsApp** | Opens a recipient modal. Pick a saved recipient, a recent number, or type a new one. Opens WhatsApp Web/desktop pre-filled with a short summary. |
| **Export JSON** | Downloads `audit_{courseId}.json` for offline review or sharing. |
| **⇆ Float / Split** | Toggle layout. |
| **Clear** | Wipes the cross-course cache in localStorage. |
| **×** | Closes the panel. |

## Send to Claude — noise filter

Drops from the prompt before sending:

- Pregnancy Details for any male applicant
- Pregnancy Details starting with "No"
- Generic-positive values: `happy`, `good`, `fine`, `normal`, `healthy`, `nice`, `best`, `cordial`, `stable`, `cheerful`, `satisfied`, `peaceful`, etc.
- Generic-positive multi-word: `very good`, `all good`, `happy and good`, `HAPPY AND SATISFIED`, etc.
- Single negative-state words alone: `stressed`, `confused`, `anxious`, `sad`, `netural` (these are why people come; multi-word disclosures pass through)
- Geographic noise typed into Other Info: 40+ Indian cities + 28 states
- Rows where every sensitive field is filtered out

Kept (reaches Claude):

- `depressed` (clinical word, even alone)
- Multi-word free text (e.g. "Not normal with husband", "Live bat karke", "Confused, procastrinated, no drive for success or alignment")
- All Physical Health, Medication, Addiction disclosures other than blank/"no"
- Pregnancy with details (e.g. "Yes (6 months)")

## Send to WhatsApp

Format: short, scannable summary (~500–800 chars typically; well within wa.me URL limits).

```
Audit: 10 Day / 2026 / 17th-Jun to 28th-Jun
63/66879 — 96 rows, 88 active

🔴 4 hard / 🟡 8 safety / 🔵 1 cross-course

Top hard errors:
• r93 Neelam Singh — missing Emergency Contact No
• r35 Satyavir Singh — phone dup rows 35,36
• r45 Sureshvati Singh — phone dup rows 45,46
  …+1 more

Cross-course:
• r12 Vikas Kumar — also in 2026-05-20, 2026-06-03 (by aadhar)

Safety: 8 flag(s) — see audit panel

Sensitive: Physical Health: 5, Mental Health: 8, Medication: 12

View: https://dipi.vridhamma.org/search-course/63/66879
```

### Recipient management

- **Saved recipients** — named numbers (e.g. "Tyler", "Praveen"). Click chip to send, click × on chip to delete. Add by checking "Save as" with a label when sending to a new number.
- **Recent** — last 5 numbers used (excluding saved). Click to send.
- **New number** — country code dropdown (default +91, plus US/UK/AU/SG/AE/DE/FR/JP/NP) + 10-digit input.

Validation: for `+91`, must be 10 digits starting `6–9`. Otherwise 7–15 total digits.

Recipients stored in `localStorage` keys:
- `courseAudit.whatsapp.recipients` → `[{label, e164}]`
- `courseAudit.whatsapp.recent` → `[e164, ...]` (last 5)

Both stay on your machine. Nothing is sent over the network until you click "Open WhatsApp", at which point a new tab opens to `wa.me` pre-filled and YOU click Send inside WhatsApp.

### Privacy guard

The WhatsApp summary intentionally contains only:
- Row indices
- Names (already public to anyone with portal access)
- Check names + small extras (e.g. "phone dup rows 35,36")
- Sensitive field counts (numbers only)
- A link back to the course page

It does NOT contain Aadhar, DOB, mobile, email, or any free-text disclosures. For full detail, use Export JSON or Send to Claude.

## Cross-course double-booking

Each run caches mapped rows in `localStorage.courseAudit.cache` (last 12 courses). The cross-course check matches by Aadhar or PhoneMobile across other cached courses. Workflow:

1. Open course 1 page → audit runs → close.
2. Open course 2 page → audit runs → cross-course section lists anyone double-registered against course 1.
3. Repeat. Each successive run cross-checks all previously cached courses.

## Data model

dipi server-renders all rows inline as `var dataset = [...]` inside `$(document).ready()`. Adapter reads via:

```js
$('#table-applicants').DataTable().rows().data().toArray()
```

84 internal keys mapped to xlsx export column names. Use `app_status` not `status` (the latter has Conf No appended like `"Expected (SM1)"`).

## Update flow

1. Edit `audit.js` / `loader.js` / `userscript.user.js`.
2. Commit, push to `main`.
3. GH Pages serves new version within a minute.
4. `audit.js` and `loader.js` cache-busted via `?v=Date.now()` — picked up on next run.
5. `userscript.user.js` checked daily by Tampermonkey or on-demand via Tampermonkey dashboard.

## Auto-run (opt-in)

Auto-run is off by default — the audit only runs when you click the `↻ Audit` floating button. To make it run automatically on page load, right-click the button (`localStorage.courseAudit.autorun` is set to `'true'` and the button turns fully opaque). Right-click again to turn it back off.

## Verified against your data

Adapter and rules tested against four 2026 course exports (May 20, Jun 3, Jun 17, Jul 1). Sample findings reproduce:

- Aadhar masked: Jul 1 r30 Nandi Sharma, r31 Vishal Kumar
- 8-digit phone: Jun 3 r131 Aditya Jagadale
- Malformed email: May 20 r161 Geeta Rani
- Missing City: Jun 3 r132 Vikas Chaudhary
- Missing Emergency Contact No: Jun 17 r93 Neelam Singh
- Emergency = own mobile: 24 active rows across all four courses
- Cross-course actives: Vikas Kumar, Bhavana, Suruchi, Dinesh Kumar, Lalit Kumar, Monika Rani

## Roadmap

- Unit tests on `audit.js` against fixture data (Node-runnable)
- Diff mode: highlight only findings new since last run
- Cloud-API WhatsApp path (Meta Business / Twilio) for scheduled / automated sends
- PIN code → State validator
- Sevak-specific checks (Conf No prefix `SM`/`SF` vs role)
