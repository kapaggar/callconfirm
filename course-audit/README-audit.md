# dipi.vridhamma.org Course Audit

Browser bookmarklet that runs the upcoming-course audit (Aadhar checks, age/DOB sanity, emergency contact, cross-course double-booking, sensitive-field summary) directly on the applicants page at `https://dipi.vridhamma.org/search-course/{centreid}/{courseid}`. Hosted as static JS on GitHub Pages.

## How it works

The applicants page server-renders all data inline as a `var dataset = [...]` JSON array inside a `$(document).ready()` closure, then DataTables binds to it. The export-to-Excel button on the page is built by DataTables Buttons from the in-memory dataset — there is no separate API call.

Since `dataset` is scoped inside the ready handler, the bookmarklet cannot read it as a global. Instead it grabs the data from the DataTables instance:

```js
$('#table-applicants').DataTable().rows().data().toArray()
```

That returns the same array of 84-key objects the page started with. The loader maps those keys to the column names that the rule engine in `audit.js` expects (matching the xlsx export schema), runs the audit, and renders a floating overlay.

## Field mapping (dipi JSON → xlsx column)

| xlsx column | dipi JSON key | Notes |
|---|---|---|
| Name | `name` | HTML-stripped, `(Sevak)` suffix preserved |
| Gender | `gender` | |
| Age | `age` | |
| PhoneMobile | `contact_mobile` | |
| PhoneHome | `contact_home` | |
| PhoneOffice | `contact_office` | |
| Email | `contact_email` | |
| Address / City / State / Pin / Country | `address` / `city` / `state` / `pin` / `country` | |
| Accommodation | `acc` | |
| ID Type | derived | first non-null of `aadhar`/`pancard`/`voterid`/`passport` |
| ID No | derived | the value of that field |
| Conf No | `confno` | |
| Physical Health | `physical` | |
| Mental Health | `mental` | |
| Medication | `medication` | |
| Pregnancy Details | `pregnant` | |
| Other Meditation Techniques | `othertechnique` | |
| Emergency Name / Relation / Contact No | `emergency_name` / `emergency_relation` / `emergency_num` | |
| Language | `lang_discourse` | |
| Addiction | `addiction` | |
| Other Info | `extra` (fallback `note`) | |
| DOB | `dob` | |
| Nationality | `nationality` | |
| Status | `app_status` | NOT `status` — that field has confno appended like `"Expected (SM1)"` |

## Deploy


1. Drop `audit.js` and `loader.js` at the root. Commit.
2. Settings → Pages → Source: `main` / root.
3. Edit `bookmarklet.txt`, replace `YOUR-USER` with your GitHub username.
4. Drag the resulting `javascript:` line into your bookmarks bar.

Updates: edit + push. The bookmarklet's `?v=` cache buster picks up the change on next click.

## Usage

1. Open the applicants page for a course: `https://dipi.vridhamma.org/search-course/{centreid}/{courseid}`.
2. Wait for the DataTable to finish rendering.
3. Click the bookmarklet.
4. Overlay panel appears top-right with hard errors, safety flags, soft flags, cross-course duplicates, and sensitive-field counts.
5. Click "For Teachers Review" to copy a curated prompt (only the applicants with non-empty sensitive fields) for teacher-call judgment.

## Cross-course double-booking

Every run caches the course data in `localStorage` under `courseAudit.cache` (last 12 courses kept). When you run on a new course, the cross-course check automatically lists anyone whose Aadhar or mobile matches an active row in another cached course.

Workflow for 4-5 upcoming courses:

1. Open course 1 page → click bookmarklet → close.
2. Open course 2 page → click bookmarklet → cross-course section will list anyone double-registered against course 1. Close.
3. Repeat. Each successive run cross-checks against all previously cached courses.

Clear with the "Clear cache" button in the panel, or in DevTools: `localStorage.removeItem('courseAudit.cache')`.

## Privacy and security

- All processing is local. Nothing leaves the browser unless you explicitly click "For Teachers Review" (which copies to clipboard).
- The cache lives in localStorage of `dipi.vridhamma.org`. If multiple admins share a machine, clear after use.
- The bookmarklet runs with full page privileges (your cookies, your session). Don't run it on untrusted pages.
- The "Send to Claude" prompt is filtered to only attendees with non-empty Physical Health / Mental Health / Medication / Pregnancy / Addiction / Other Info, so PII volume in the clipboard is minimized.

## CSP and Drupal notes

`dipi.vridhamma.org` runs on Drupal 7 / Backdrop with permissive CSP. The bookmarklet loading external `<script src=>` works as of this writing. If VRI ever tightens CSP:

- Fallback A: paste `audit.js` + `loader.js` contents directly into a bookmarklet (large, but works).
- Fallback B: Tampermonkey userscript with `@grant GM_xmlhttpRequest` — bypasses page CSP for its own code. See userscript stub at bottom of this README.

## Tampermonkey userscript stub

```js
// ==UserScript==
// @name         dipi.vridhamma.org Course Audit
// @match        https://dipi.vridhamma.org/search-course/*
// @grant        none
// @updateURL    https://YOUR-USER.github.io/course-audit/userscript.user.js
// @downloadURL  https://YOUR-USER.github.io/course-audit/userscript.user.js
// ==/UserScript==
(function () {
  // Optional: auto-add a button to the page header instead of using a bookmarklet
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Run Audit';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;padding:10px 14px;background:#06c;color:#fff;border:0;border-radius:4px;cursor:pointer';
    btn.onclick = () => {
      const s = document.createElement('script');
      s.src = 'https://YOUR-USER.github.io/course-audit/loader.js?v=' + Date.now();
      document.head.appendChild(s);
    };
    document.body.appendChild(btn);
  });
})();
```

## Verified against your data

The adapter and rule engine were tested against the May 20 / Jun 3 / Jun 17 / Jul 1 xlsx exports. Findings match what we worked through in chat:

- Hard errors: Aadhar masked rows in course, 8-digit phone in course , malformed email in course, missing City incourse, missing Emergency Contact in course
- Safety: 24 emergency-equals-self rows across all four files.
- Cross-course:  identities   active in 1+ courses.

## Roadmap

- [ ] Slack webhook for daily auto-summary
- [ ] PIN code → State validation against India Post DB
- [ ] Sevak-specific checks (e.g. Conf No prefix `SM`/`SF` cross-checked with role)
- [ ] Auto-run on page load (via userscript) instead of manual click
- [ ] Diff mode: show only what changed since last run (so 100-row reaudit doesn't drown the new issue)
- [ ] Unit tests on `audit.js` against fixture data
