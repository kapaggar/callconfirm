# dipi.vridhamma.org Course Audit

Browser bookmarklet that audits the applicants page at `https://dipi.vridhamma.org/search-course/{centreid}/{courseid}` for data-quality issues, safety flags, and cross-course double-bookings. Hosted as static JS on GitHub Pages.

Live at: `https://kapaggar.github.io/callconfirm/course-audit/`

## Files

| File | Role |
|---|---|
| `audit.js` | Pure rule engine. Framework-agnostic. Takes an array of attendee objects, returns findings. |
| `loader.js` | GH Pages entry point. Adapter for `dipi.vridhamma.org`, UI (split/float), noise filter for Send to Claude. |
| `bookmarklet.txt` | The `javascript:` one-liner you drag to bookmarks bar. |

## Install

1. Open `bookmarklet.txt`, copy the whole `javascript:...` line, drag it to your browser bookmarks bar (or right-click bookmarks → Add → paste as URL).
2. Visit `https://dipi.vridhamma.org/search-course/{centreid}/{courseid}`.
3. Wait for the applicants table to load.
4. Click the bookmarklet.

## UI: split-view by default

The page shrinks to **60vw on the left**, an audit iframe occupies **40vw on the right** spanning full viewport height. Toggle to floating-overlay mode via the **⇆ Float** button. Preference is saved in `localStorage` and applied on the next run.

Section headers (Hard errors / Safety / Cross-course / Soft) render at 16px bold; row content is 12px. Color coding: red = hard errors, amber = safety, blue = cross-course, gray = advisory.

## Send to Claude noise filter

The button copies a curated prompt to clipboard with rows that *actually disclose something*. Filters applied:

**Skipped entirely:**
- Pregnancy Details for any male applicant
- Pregnancy Details starting with "No" (all genders)
- Sensitive fields equal to any of: blank, `no`, `na`, `none`, `nil`, `-`, `.`
- Sensitive fields equal to generic-positive single words: `normal`, `fine`, `healthy`, `good`, `happy`, `cheerful`, `stable`, `best`, `nice`, `cordial`, `ok`, `cool`, `well`, `great`, `satisfied`, `peaceful`, `positive`, `sympathy`
- Generic-positive multi-word phrases: `very good`, `all good`, `happy and good`, `happy and cheerful`, `HAPPY AND SATISFIED`, `happy ,cheerful`, etc.
- Single negative-state words alone: `stressed`, `confused`, `anxious`, `sad`, `netural` (these are not actionable on their own — multi-word disclosures pass through)
- Geographic noise: 40+ Indian city/state names typed into Other Info (Delhi, Uttar Pradesh, Mumbai, etc.)
- Rows where every sensitive field was filtered out

**Kept (reaches Claude):**
- `depressed` (clinical word, even alone)
- Multi-word free-text that isn't on the exact-noise list (e.g. "Not normal with husband", "Live bat karke", "Confused, procastrinated, no drive for success or alignment")
- All Physical Health, Medication, Addiction disclosures other than blank/"no"
- Pregnancy with details ("Yes (6 months)")

The prompt template asks Claude for a one-line verdict: `PROCEED` / `TEACHER-CALL` / `DEFER` / `DECLINE`, with conservatism rules for active mental health crises, surgery within 3 months, third-trimester pregnancy, severe addictions, and sevak-role applicants.

Result: a 200-row course typically yields a 15-25 row prompt instead of 100+.

## Cross-course double-booking

Each run caches the course's mapped rows in `localStorage` under `courseAudit.cache` (last 12 courses retained). The cross-course check matches on Aadhar or PhoneMobile across other cached courses. Workflow:

1. Open course 1 page → click bookmarklet → close.
2. Open course 2 page → click bookmarklet → cross-course section lists anyone double-registered against course 1.
3. Repeat for as many upcoming courses as you need.

Clear via the "Clear" button or `localStorage.removeItem('courseAudit.cache')` in DevTools.

## Data model

The dipi page server-renders all rows inline as `var dataset = [...]` inside `$(document).ready()`, then DataTables binds. Since the variable is scoped, the adapter reads via:

```js
$('#table-applicants').DataTable().rows().data().toArray()
```

The 84 internal keys (`contact_mobile`, `app_status`, `confno`, `aadhar`, ...) are mapped to the xlsx export column names (`PhoneMobile`, `Status`, `Conf No`, `ID No`, ...) that the rule engine expects.

Critical detail: the dipi JSON has two status fields — `status` is `"Expected (SM1)"` (combined with Conf No) and `app_status` is the clean `"Expected"` / `"Confirmed"` / `"Cancelled"` / `"Duplicate"` etc. The adapter uses `app_status`.

## Privacy / security

- All processing is local. Nothing leaves the browser unless you explicitly click **Send to Claude** (clipboard) or **Export JSON** (file).
- The `courseAudit.cache` localStorage entry persists across sessions on `dipi.vridhamma.org`. Clear after use if multiple admins share the machine.
- The bookmarklet runs with full page privileges (cookies, session). Don't run it on untrusted sites.
- The "Send to Claude" prompt is restricted to applicants with non-empty sensitive disclosures after noise filtering, so clipboard PII volume is minimized.

## Update flow

1. Edit `audit.js` or `loader.js` locally.
2. Commit and push to `main`.
3. GH Pages serves the new version within a minute.
4. Bookmarklet's `?v=Date.now()` cache buster picks up the new version on next click — no reinstall needed.

## Verified against your data

The adapter and rule engine were tested against four 2026 course exports (May 20, Jun 3, Jun 17, Jul 1). Sample findings reproduced:

- Aadhar masked:   (`XXXXXXXX####`)
- Phone with 8-9 digits: eg (`45077741`)
- Malformed email:  
- Missing City:  
- Missing Emergency Contact No:
- Emergency = self:  active rows across the  courses
- Cross-course active duplicates: 

## Roadmap

- Auto-run on page load via userscript (Tampermonkey)
- Diff mode: highlight only findings new since last run
- Slack webhook for daily summary
- PIN code → State validator (catch postal data errors)
- Sevak-specific checks (Conf No prefix `SM`/`SF` vs role)
- Unit tests on `audit.js` against fixture data (Node-runnable)
