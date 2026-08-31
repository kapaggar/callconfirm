# Agent prompt — scan, analyse, feature-develop, and debug `callconfirm`

Paste this whole file (or: "Read `docs/FEATURE-DEBUG-PROMPT.md` and execute it") into a coding-agent session that must **understand this repo cold**, then either:

1. **Scan / analyse** — produce a structured report of architecture, risks, gaps, and the next safe change.
2. **Debug** — reproduce, isolate, and fix a reported failure without regressing the live calling workflow.
3. **Feature-develop** — implement one backlog or requested item with the same discipline as shipped work.

Do not skip the orientation reads. Do not invent a backend, a framework, or a second copy of the tracker.

---

## 0. How to use this prompt

Start every session by stating which mode you are in:

- `MODE=scan` — read-only analysis (default if the user only asked to "look at" / "understand" / "review").
- `MODE=debug` — a specific bug, unexpected UI, merge failure, write-back failure, or channel-specific regression.
- `MODE=feature` — a named item from `TODO.md` or an explicit user request.

Then:

1. Read this file.
2. Read `CLAUDE.md` and `AGENTS.md` (commit-message rules, layout, gotchas).
3. Read `CALL-TRACKER-MEMORY.md` (architecture, DIPI endpoints, decisions).
4. Read the tool-specific README that matches the work:
   - tracker/scraper → `CALL-TRACKER-README.md`
   - audit → `course-audit/README.md`
   - photos → `photo-review/README.md`
5. Read `TODO.md` (prioritized backlog) and, for release/debug, `docs/QA-TEST-PLAN.md`.
6. Open the actual source files listed in §4 **before** proposing a change.
7. Follow the protocol for your mode (§8 / §9 / §10).
8. Verify with the gates in §11. Do not claim done without evidence.

If the user named a symptom, a course page, a channel (extension / Tampermonkey / bookmarklet), or a screenshot: treat those as primary evidence. Do not "fix" a different problem.

---

## 1. What this repo is

**Product name in the UI / store:** DIPI Tools (Audit / Scrape / Photos).
**GitHub:** `kapaggar/callconfirm`. **Live static host:** `https://kapaggar.github.io/callconfirm/`.

Personal **browser tooling** for the course-admin volunteer at **Dhamma Sudha** (dipi centre **63** on `dipi.vridhamma.org`). Dipi is a Drupal 7 portal that lists course applicants in a paginated DataTable and has **no calling workflow**. This repo layers three client-side tools on top of that authenticated page **without a backend of our own**.

| Tool | Job in the real week | Entry |
|---|---|---|
| **Scrape + Call Tracker** | Before a 10-day (or STP / 3-day) course, Expected/Confirmed applicants must be phoned to reconfirm. Tracker holds per-person call status, attempts, notes, WhatsApp letters, and a wait-list backfill pool. | `scraper.js` → `tracker-inline.js` |
| **Course Audit** | Pre-course data-quality pass: hard errors (IDs, phones, PAN/Aadhaar, duplicates), safety flags, sensitive-field counts, cross-course double-booking. Feeds a teacher-review prompt and a short admin WhatsApp summary. | `course-audit/audit.js` + `loader.js` |
| **Photo Review** | Applicants upload sideways or whole-passport photos. Dipi re-encodes to 800px JPEG and **strips EXIF**, so orientation is a pixel problem. Local rotate/crop, on-device face detect, optional full-form write-back to dipi, optional face-embedding duplicate scan. | `photo-review/review.js` + `facematch.js` |

**Operator:** one (sometimes 1–3) centre volunteer(s). Not a multi-tenant SaaS. Not an Android app. Not a Gradle project.

**Domain constraints that drive product decisions:**

- Students must reconfirm ~2–3 weeks before the course or the seat auto-cancels onto the wait-list.
- Late cancellations leave empty cushions; no-shows waste food/bedding planned on confirmed numbers.
- Gender-balanced groups (`NM`/`OM`/`SM`/`NF`/`OF`/`SF`) constrain who can fill a freed seat.
- Dipi status changes are **consequential** (Confirmed assigns a Conf No and starts accommodation allotment). Tracker call-status is **local workflow** and must stay decoupled unless the user explicitly writes to dipi.
- Applicant records include names, phones, government IDs, and health/mental-health/medication/pregnancy disclosures. Face descriptors are biometric-adjacent.

---

## 2. Non-negotiables

Violate any of these and the change is wrong even if tests pass.

1. **No backend, no cloud datastore, no analytics.** All applicant data stays in the browser (dipi origin). The only network destinations that are allowed without asking:
   - same-origin `dipi.vridhamma.org` (scrape, status GET, photo GET, form GET/POST)
   - `applicant.vridhamma.org/l.php?a=` (personalized letter, allow-listed)
   - user-initiated navigation: `tel:`, `whatsapp://`, `wa.me`
2. **Nothing may leave the browser except explicit user actions** (WhatsApp deep links, CSV/JSON/PDF exports, photo upload to dipi). Face descriptors in IndexedDB `vcall_faces` **never** leave the machine; only name+distance summaries go to `localStorage.faceDedup.flags`.
3. **Do not paste real applicant PII** (names, phones, Aadhaar, PAN, health text, photos, face descriptors) into commits, issues, PRs, chat, docs, or test fixtures. Use placeholders (`<applicant>`, `<aid>`, `<mobile>`). Store listing screenshots must never contain real applicant data. Gitignore already blocks `*.xlsx`, `*.csv`, `session_*.json`, `*.har`, `store-assets/`.
4. **Do not auto-sync tracker call-status to dipi status.** Default for new tracker features: local only. Ask before any write path to dipi. Photo write-back and `/change-status` already exist — extend them with dry-run / throttle / per-row verify, never with silent bulk writes.
5. **Ask before adding audit rules**, and classify each as hard error vs safety vs soft. Preference: surface, don't block, unless legally mandated (PAN for 80G receipts). Do not regress rules calibrated against the four 2026 course exports.
6. **Single source of truth for each tool.** `tracker-inline.js` is the only tracker. Do not re-add tracker logic to `index.html` (that page is a static signpost; the github.io PWA tracker was retired 2026-07-16). Do not fork a tool file per delivery channel.
7. **Vanilla JS, no build step, no runtime npm dependencies** for the tools. Tests use zero-dep `node:test`. Photo-review's only heavy deps are **pinned, self-hosted** under `vendor/mediapipe/` and `vendor/faceapi/` — never a CDN, never a remote script/wasm URL in any file that ships in the extension zip (Chrome Web Store rejection "Blue Argon").
8. **MV3 remote-code policy.** No hardcoded `https://…` script/wasm load URLs in packaged files. Bases derive from `document.currentScript.src` (failure value `''`, not a URL). The extension pre-injects dependencies so dynamic loaders short-circuit on `window.*` guards.
9. **Three delivery channels share logic, not shells.** Bookmarklet cache-busts via `?v=Date.now()` against github.io. Tampermonkey shells must have `@version` bumped on **every** tool change (even if only the cache-busted `.js` changed). Extension updates = `git pull` + Reload — cache-busting is **inert** on `chrome-extension://`.
10. **Do not run Tampermonkey shells and the unpacked extension in the same profile** when testing (buttons dedupe by DOM id; autorun can fire twice).
11. **Centre 63 and status filter `Expected,Confirmed,WaitList,Review` are hardcoded in `scraper.js`.** Photo-review is centre-agnostic. Do not "generalise to all centres" unless asked.
12. **Escape scraped/user strings with the local `escHtml()`** before interpolating into `innerHTML`.
13. **Commit messages:** `type(scope): short imperative summary` only. No `Co-Authored-By`, session URLs, "Generated with", or agent watermarks. See `AGENTS.md`.
14. **Prose:** answer first, then reasoning. Surface tradeoffs and uncertainty. En-dashes/hyphens, no em-dashes.
15. **`hub/` is out of scope.** It is an untracked nested clone of a different product (Hubspaces — local markdown/HTML indexer). Do not mix it into DIPI tool analysis, commits, or GitHub Pages output unless the user explicitly asks.

---

## 3. Architecture (one picture)

```
                    dipi.vridhamma.org
                    /search-course/63/{courseid}
                              │
     Tampermonkey .user.js  /  bookmarklet launcher.js  /  MV3 extension-fab.js
                              │
                    #dipi-fab-stack  (bottom-right)
                    data-order: Audit 10 · Scrape 20 · Photos 30
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
 course-audit/          scraper.js            photo-review/
 loader.js +            (DataTable            review.js
 audit.js               scrape)               (+ facematch.js
        │                     │                  on 👥)
        │                     ▼
        │              tracker-inline.js
        │              overlay + IndexedDB
        │                     │
        │                     ├── letter bridge ──► background.js
        │                     │                     (or GM_xmlhttpRequest)
        │                     │                     applicant.vridhamma.org/l.php
        │                     ├── GET /change-status/{aid}
        │                     └── tel: / whatsapp:// / wa.me
        │
        └── (audit is read-only against dipi)
            photo write-back: GET+POST /app/{aid}/edit (full Drupal form)
```

**Worlds:**

- Bookmarklet / Tampermonkey-injected scripts / extension-injected `<script src>` run in the page **MAIN** world (jQuery, DataTables, dipi-origin storage).
- `extension-fab.js` itself runs in the **ISOLATED** world. It cannot see `$.fn.DataTable`; it polls `#table-applicants_wrapper` + tbody rows, then injects tools into MAIN.
- `background.js` is the MV3 service worker. **One job:** fetch allow-listed letter URLs. Must not become a generic proxy.

**Overlays are mutually exclusive** where it matters: opening the tracker closes the scraper; tracker Re-scrape closes itself and calls `DipiScraper.run()`. Audit is an iframe (split) or floating overlay. Photo-review is its own overlay. Do not stack three tool UIs.

**Deploy:** push to `main` → GitHub Pages. Logic files are cache-busted for web/TM. Extension zip is built locally (`store-assets/` is gitignored).

---

## 4. File map (read these, not the vendors)

### Always (orientation)

| Path | Role |
|---|---|
| `CLAUDE.md` | Agent orientation |
| `AGENTS.md` | Commit-message law |
| `CALL-TRACKER-MEMORY.md` | Full hand-off: endpoints, crypto, decisions, open questions |
| `TODO.md` | Prioritized backlog |
| `docs/QA-TEST-PLAN.md` | Manual cases keyed INST/FAB/SCR/TRK/WA/BF/EXP/AUD/PR/PRA/DUP/UP/PRIV/EDGE |
| `README.md` | User-facing setup |
| `SECURITY.md` | Privacy posture (note: some PWA wording is stale) |

### Scraper + tracker (~1.4k lines of logic)

| Path | Lines (approx) | Role |
|---|---|---|
| `scraper.js` | 383 | Course picker + DataTable scrape. Hardcoded `CID='63'`, `STATUS_FILTER`. Exposes `window.DipiScraper.{run,pick}`. |
| `tracker-inline.js` | 1046 | Calling dashboard overlay. IndexedDB `vcall_inline`. Exposes `window.DipiTracker.{open,import,close,_internal}`. |
| `scraper.user.js` | 167 | TM shell `@version 1.7.4`. FAB + letter bridge via `GM_xmlhttpRequest` + `unsafeWindow`. |
| `launcher.js` | 89 | All-in-one bookmarklet target. Host-guards `vridhamma.org`. Idempotent `window.DipiLauncher`. |
| `bookmarklet-all.txt` | — | Drag-to-bookmarks payload |
| `scraper-bookmarklet.txt` | — | Scraper-only bookmarklet (no letter bridge) |

### Course audit

| Path | Lines | Role |
|---|---|---|
| `course-audit/audit.js` | 488 | Pure rule engine. `CourseAudit.run(rows, opts)` → `{hardErrors,safety,soft,sensitiveCounts,crossCourse}`. |
| `course-audit/loader.js` | 1020 | Dipi adapter, panel UI, teacher-review prompt, admin WhatsApp, cache. |
| `course-audit/userscript.user.js` | 121 | TM shell `@version 1.2.4` |

### Photo review

| Path | Lines | Role |
|---|---|---|
| `photo-review/review.js` | 1373 | Overlay, rotate/crop, MediaPipe/FaceDetector, write-back. `window.DipiPhotoReview.{open,close,_internal}`. |
| `photo-review/facematch.js` | 270 | Face embeddings + match math. `window.FaceMatch`, `_internal.{dist,tier,matchPairs,pruneKeep}`. |
| `photo-review/userscript.user.js` | 111 | TM shell `@version 1.9.0` |

### Extension / landing

| Path | Role |
|---|---|
| `manifest.json` | MV3 manifest **version 1.5.6**. Repo root **is** the extension. |
| `extension-fab.js` | Isolated-world content script: FAB union + letter-bridge relay |
| `background.js` | Letter fetch only; regex `^https://applicant.vridhamma.org/l.php?a=` |
| `index.html` | Static github.io landing. **No tracker code.** |
| `setup.html` | Bookmarklet installer |
| `manifest.webmanifest`, `sw.js` | Landing-page PWA leftovers |
| `icons/` | Store / extension icons (lotus) |

### Tests / CI

| Path | Covers |
|---|---|
| `test/audit.test.js` | Rule engine (PAN, IDs, phones, age, duplicates, safety, soft, cross-course) |
| `test/tracker.test.js` | `parseCourseStart`, `deadlineInfo`, `priorityRank`, backup validate/merge, `isPool`, `backfillCandidates` |
| `test/facematch.test.js` | Distance, tiers, within/cross-course pairs, prune cap |
| `.github/workflows/test.yml` | `node --test` on push/PR, Node 20, no install |

### Vendored (do not "upgrade to latest")

| Path | Role |
|---|---|
| `vendor/mediapipe/` | `@mediapipe/tasks-vision` 0.10.14 + BlazeFace model + WASM. Hashes in its README. |
| `vendor/faceapi/` | face-api.js 0.22.2 + weights. Hashes in its README. |

### Ignore / do not publish

`graphify-out/` (local code-graph cache), `store-assets/` (Web Store zips + screenshots), `hub/` (unrelated nested repo), `*.har`, `*.xlsx`, `*.csv`, `session_*.json`.

---

## 5. Public APIs (stable seams)

```js
window.DipiScraper.run()     // scrape current /search-course/ page
window.DipiScraper.pick()    // course picker (used on /centre/)

window.DipiTracker.open()    // last / chosen session overlay
window.DipiTracker.import(apps, title, dates, courseType)
window.DipiTracker.close()
window.DipiTracker._internal // parseCourseStart, deadlineInfo, priorityRank,
                             // validateBackup, mergeSessions, isPool, backfillCandidates

window.CourseAudit.run(attendees, {
  courseStart, courseId, allCourses, checkPanPresence
})
window.CourseAudit._internal // normPhone, normName, normAadhar, ageOn, isActive, namePrefix

window.DipiPhotoReview.open()
window.DipiPhotoReview.close()
window.DipiPhotoReview._internal // geometry, upload body builder, detection classifiers

window.FaceMatch             // loaded on demand by review.js
window.FaceMatch._internal   // dist, tier, matchPairs, pruneKeep

window.DipiLauncher.ensure() // bookmarklet FAB idempotent re-entry
window._DIPI_TRACKER_BASE    // set by bookmarklet/TM before injecting scraper.js
```

FAB button ids (dedupe across channels):

| Tool | Userscript / extension id | Launcher id |
|---|---|---|
| Audit | `ca-rerun-btn` | `dl-audit-btn` |
| Scrape | `dipi-tracker-fab-primary` | `dl-scrape-btn` |
| Photos | `pr-fab-btn` | `dl-photos-btn` |

Autorun localStorage (right-click FAB; default **off**):

- `dipiTracker.autorun`
- `courseAudit.autorun`
- `photoReview.autorun`

---

## 6. Data model and storage (all on dipi origin)

### Tracker IndexedDB `vcall_inline` (v1, store `sessions`, keyPath `id`)

Session:

```js
{
  id: 's-<timestamp>',
  title: '10 Day / 2026 / …',
  dates: '20th-May to 31st-May 2026',
  courseType: '10 Day',
  courseKey: '63/<courseid>',   // may be missing on older sessions
  createdAt, updatedAt,
  count: 96,
  applicants: [ /* see below */ ]
}
```

Applicant (after `importApps`):

```js
{
  id, name, mobile, home, office, email,
  gender, age, city, group, aid,
  dipiStatus,          // scraped, e.g. "Expected (NF13)" — authoritative VRI record
  status: 'pending',   // tracker call-status: pending|confirmed|cancelled|
                       //   no_answer|callback|tentative|left_message
  attempts: 0,
  lastAttempt: null,   // ISO
  notes: ''
}
```

**Re-scrape merge (`importApps`):** match session by `title + dates`. Within session, match applicants by **AID**. Carry over `status`, `attempts`, `lastAttempt`, `notes`. Roster is **destructive** (new scrape wins; vanished applicants disappear). New AIDs start `pending`. No-AID rows do not match. There is no conflict UI.

**Backup import (`mergeSessions`):** different merge — newest `lastAttempt` wins, notes never dropped, attempts = max, unmatched incoming appended. Envelope `{kind:'dipiTracker.session', v:1, session}`.

### Tracker localStorage

| Key | Purpose |
|---|---|
| `dipiTracker.sessionIndex` | `{ "63/<courseid>": {sessionId, count, withProgress, updatedAt} }` — scraper resume label |
| `dipiTracker.waMode` | `app` (default, `whatsapp://`) vs `web` (`wa.me`) |
| `dipiTracker.reconfirmDays` | 7 / 14 / 21 |
| `dipiTracker.prioritySort` | pending-first vs A–Z |
| `dipiTracker.autorun` | scrape FAB |

### Audit localStorage

| Key | Purpose |
|---|---|
| `courseAudit.cache` | last 12 courses of mapped rows (cross-course dedup) |
| `courseAudit.checkPan` | opt-in `pan_missing` |
| `courseAudit.mode` | `split` (default) / `float` |
| `courseAudit.whatsapp.recipients` | `[{label, e164}]` |
| `courseAudit.whatsapp.recent` | last 5 e164 |
| `courseAudit.autorun` | |

### Photo-review

| Store | Purpose |
|---|---|
| `localStorage.photoReview.corrections` | rotation + crop geometry keyed by photo id (no pixels). After successful dipi upload, geometry is **zeroed** and an `uploaded` marker is kept (double-apply guard). |
| `localStorage.photoReview.autorun` | |
| IndexedDB `vcall_faces` | 128-d descriptors, last 12 courses. **Never export.** |
| `localStorage.faceDedup.flags` | name + distance + tier only; audit Cross-course section reads this |

SessionStorage (scraper only): `_ds_auto` (resume scrape after navigation), `_ds_flt_retry` (one-shot guard against filter-reload loops).

---

## 7. DIPI integration surface (treat as hostile / version-sensitive)

Captured behaviour lives in `CALL-TRACKER-MEMORY.md`. Re-read that section before touching any of these.

### Scrape

- Dipi's `var dataset = [...]` is inside `$(document).ready()` — **not** a reachable global.
- Scraper forces DataTables page-length `-1`, expands rows via jQuery (fallback click), then text-parses DOM.
- If the page `?s=` filter is narrower than `Expected,Confirmed,WaitList,Review`, scraper reloads once with the full filter (`_ds_flt_retry` prevents a loop).
- Audit loader instead uses `$('#table-applicants').DataTable().rows().data().toArray()` and maps ~84 internal keys to xlsx-style column names. Use `app_status`, not `status` (the latter appends Conf No, e.g. `"Expected (SM1)"`).

### Status change (tracker)

```
GET /change-status/{aid}?s={NewStatus}&l=&c={custom}
X-Requested-With: XMLHttpRequest
→ { status: "OK", msg: "", confno: "SM4", newstatus: "" }
```

Known values: `Confirmed, Cancelled, Clarification, Duplicate, PreConfirmation, Regret, Rejected, Review, WaitList, Custom`.

Open questions (do not "fix" speculatively): meaning of `l` (empty works; captured value was `4230`); exact FAIL JSON shape; Custom `c` payload in the wild.

### Letters (tracker WhatsApp)

- Auth code = double-base64(AES-256-CBC(`{aid}-{msgType}`)). Constants and MSG_TYPE are in `CALL-TRACKER-MEMORY.md` (reverse-engineered from dipi PHP `simple_crypt`). Do not rotate them.
- Fetch `https://applicant.vridhamma.org/l.php?a={authCode}`. **No CORS** → page `fetch` cannot read the body.
- Bridge: tracker posts `{__dipiLetter:'req', id, url}` if `<html data-dipi-letter-bridge="1">`. Extension relays to `background.js`; TM uses `GM_xmlhttpRequest`. Both allow-list the URL. Bookmarklet has **no** bridge → generic Hindi fallback (expected).
- Parse HTML, drop first two lines of body text. A past bug collapsed the letter to a single line / trailing link only — regression tests: WA-01.

### Photo write-back

Dipi has **no photo-only endpoint**. Saving a photo resubmits the entire `/app/{aid}/edit` form (`form_id=dh_ma_applicant_form`, multipart, CSRF `form_build_id`/`form_token`, 302 on success). A dropped field would wipe VRI data. The existing pipeline is: fetch live form → swap only `files[upload_photo]` → dry-run preview (masked) → staleness re-GET → POST → re-GET and diff. Batch stops at first failure. First-use checklist in `photo-review/README.md` is mandatory before trusting batch upload.

---

## 8. MODE=scan — analysis protocol

Goal: a report a future agent can act on, not a tour of files.

### 8.1 Pass order

1. **Intent** — restate the operator week: scrape → call with T-minus priority → WhatsApp letter → optional dipi status → re-scrape merge → wait-list backfill on cancel → pre-course audit → photo fix → optional write-back.
2. **Delivery channels** — confirm the three loaders still share the same logic files and that FAB ids / autorun keys still match.
3. **State & merge** — `importApps` vs `mergeSessions`; sessionIndex; pool vs main queue; what happens to no-AID rows.
4. **Write paths** — enumerate every dipi write and every privileged fetch. Confirm allow-lists, dry-runs, and "ask first" gates.
5. **Purity boundary** — what is in `_internal` + `node:test`, what is DOM-only (must be verified in a real dipi session).
6. **Backlog vs code** — for each `TODO.md` P1–P3 item, mark shipped / partial / missing, with the function that would change.
7. **Doc drift** — README / SECURITY / QA notes that disagree with code. (Picker subtitle and SECURITY.md PWA wording were fixed; re-check if you still see them.)
8. **Risk register** — see §8.3.

Do not dump `graphify-out/`. If you need a map, use the file/API tables above.

### 8.2 Scan output template

```markdown
# callconfirm scan — YYYY-MM-DD

## What it is (5 lines)
## Current versions
- extension manifest:
- scraper.user.js @version:
- course-audit userscript @version:
- photo-review userscript @version:

## Architecture deltas vs CALL-TRACKER-MEMORY.md
## Write paths (table: trigger → URL → dry-run? → data leaving browser)
## Storage map (what a profile wipe destroys)
## Test coverage vs DOM-only gaps
## TODO.md status (shipped / next / blocked)
## Bugs / doc drift found
## Recommended next change (one item) + why
## Questions for Kapil (max 5)
```

### 8.3 Recurring risk themes (look for these)

- **Silent dipi writes** — any new code that GETs `/change-status` or POSTs `/app/{aid}/edit` without a preview.
- **Merge data loss** — re-scrape dropping notes because AID missing; backup import vs re-scrape semantics confused.
- **Pool leakage** — WaitList/Review appearing in main stats/queue, or confirmed pool members re-offered as backfill.
- **Letter bridge abuse** — widening the URL allow-list; using the background worker as a generic fetch proxy.
- **Remote code** — a github.io literal next to `script.src` in a file that ships in the zip.
- **Double-apply photos** — storing rotation after upload so the next open rotates an already-fixed JPEG.
- **Face data egress** — descriptors in exports, audit WhatsApp text, or network.
- **innerHTML XSS** — scraped name/notes/letter HTML interpolated without `escHtml`.
- **Channel split-brain** — fix works on TM (cache-bust) but not extension (needs Reload); or bookmarklet missing the letter bridge treated as a bug.
- **Autorun double-fire** — TM + extension in one profile.
- **CSP future** — if dipi ships a strict CSP, extension `<script src>` injection dies. Documented fallback (`"world": "MAIN"` content scripts) is **not built**.

---

## 9. MODE=debug — protocol

Do not guess. Do not start by rewriting a 1k-line overlay.

### 9.1 Classify the failure

| Class | Typical symptom | First files | Likely channel-specific? |
|---|---|---|---|
| **Load / FAB** | Buttons missing, stacked, autorun unexpected | `extension-fab.js`, `*.user.js`, `launcher.js` | Yes |
| **Scrape** | Wrong count, missing WaitList, AID `X/Y`, picker | `scraper.js` | Rarely (DataTable wait differs in extension) |
| **Tracker state** | Lost notes, bad merge, pool in stats, T-minus wrong | `tracker-inline.js`, `test/tracker.test.js` | No |
| **WhatsApp / letter** | Generic fallback, timeout, one-line letter, wrong app/web | `tracker-inline.js` `fetchLetterHtml`, `background.js`, `scraper.user.js` | **Yes** (bookmarklet has no bridge) |
| **Dipi status** | Update no-ops, FAIL, Conf No not shown | `changeDipiStatus` | Cookie / CSRF / endpoint drift |
| **Audit rules** | Missed/false flag | `course-audit/audit.js` + `test/audit.test.js` | No |
| **Audit UI** | Split/float, notify, teacher prompt noise | `course-audit/loader.js` | Rarely |
| **Photo geometry** | Wrong rotation, crop, double-rotate | `photo-review/review.js` | FaceDetector vs MediaPipe vs none |
| **Face dup** | Missed close-up, false twin | `facematch.js`, `test/facematch.test.js` | Vendor load |
| **Write-back** | Field wipe, validation bounce, stale commit | `review.js` upload helpers | Session / form_token |
| **Store / MV3** | Rejected zip, remote-code flag | `manifest.json`, grep for `https://` in packaged JS | Extension only |

Ask (or infer from the report): **which channel**, **which course URL pattern**, **Chrome vs Safari/Firefox**, **whether TM and extension are both installed**.

### 9.2 Reproduce with the cheapest probe

1. `npm test` / `node --test` — if the bug is in `_internal` or a named audit check, write a failing unit test **first**.
2. For DOM/channel bugs: follow the matching ID in `docs/QA-TEST-PLAN.md` (e.g. WA-01, SCR-03, UP-03). Log Pass/Fail **per channel**.
3. DevTools on the dipi page:
   - Console: `[dipi-tracker]`, `[dipi-ext]`, `[course-audit]`, `[photo-review]`, `[dipi-launcher]`
   - Application: IndexedDB `vcall_inline` / `vcall_faces`; localStorage keys in §6
   - Network: only dipi + (explicit) `l.php`. Filter `l.php`, `/change-status/`, `/app/`, `show-photo/`
4. Confirm you are not looking at a stale extension: edit → behaviour unchanged until `chrome://extensions` Reload.

### 9.3 Isolate before patching

- Reduce to one applicant / one photo / one finding id (`check` string).
- Binary-split: "is the data wrong in the scrape object, or only in the overlay?" Dump the in-memory `apps[]` / session applicant vs the card UI.
- For letters: does `document.documentElement.dataset.dipiLetterBridge === '1'`? Did the allow-list reject the URL? Did parse drop the body?
- For merge: does the row have an AID? Do `title` and `dates` exactly match the existing session?
- For photos: is MediaPipe loaded (self-hosted) or native `FaceDetector` or neither? Are you on the area-dominance path (no landmarks → 180° must stay suggestion)?

### 9.4 Patch rules

- Touch only the failing tool file + its test + its `.user.js` `@version` if that shell's behaviour changed (and `manifest.json` `"version"` only for a store release).
- Prefer extracting a pure helper onto `_internal` and covering it in `node:test` over adding DOM branches.
- Do not "improve" adjacent CSS, rename statuses, or refactor `render()`.
- After a letter/write-back/merge fix, re-read PRIV-* and the relevant QA IDs.

### 9.5 Debug report template

```markdown
## Symptom
## Channel / browser
## Repro (exact clicks)
## Root cause (file:function)
## Why it was wrong (one mechanism)
## Fix
## Tests added/updated
## Manual QA IDs re-run
## Residual risk
```

---

## 10. MODE=feature — protocol

### 10.1 Decide whether to build

Default answers (do not fight these without asking):

| Idea | Default |
|---|---|
| New tracker field that stays in IndexedDB | OK if it survives `importApps` merge (AID carry-over list) |
| Auto-flip dipi when tracker hits Confirmed | **No** — use explicit bulk + dry-run (`TODO.md` #5) |
| New audit hard error | **Ask** — hard vs safety vs soft |
| New remote host / CDN | **No** |
| Framework / bundler / React | **No** |
| Multi-admin realtime sync | **No** — export/import is the 80% answer |
| Background dial / SMS chains | Deferred in `TODO.md` |
| Centre-id configurability | **Ask** — scraper is hardcoded 63 on purpose |
| Diff-mode re-scrape (`TODO.md` #2) | Next P1 — compute in `importApps` before overwrite; no dipi writes |

### 10.2 Implementation order

1. Name the user-visible behaviour in one sentence and the **non-goals**.
2. Identify the purity boundary: if the logic can live in `_internal`, write `node:test` cases first (`test/*.test.js`).
3. Implement the smallest overlay/loader change. Match existing style: IIFE, `'use strict'`, `var` in scraper/launcher/extension-fab (ES5-ish), `const`/`let` already used in tracker/audit/photo-review — **do not restyle the file**.
4. Wire storage. If you add a field to applicants, update: `importApps` carry-over, `mergeSessions`, CSV/WhatsApp/PDF exports, backup envelope (bump `v` only if incompatible).
5. Channel check: does bookmarklet need a bridge? Does extension need a new `web_accessible_resources` entry? Did you add a remote URL literal?
6. Bump versions:
   - logic-only + TM users: bump the matching `@version` in `.user.js`
   - store release: bump `manifest.json` `"version"` and rebuild the zip locally (do not commit `store-assets/`)
7. Docs: `CALL-TRACKER-MEMORY.md` / tool README / `TODO.md` / `docs/QA-TEST-PLAN.md` if behaviour changed. `CLAUDE.md` if an agent gotcha appeared.
8. Manual: regression smoke list at the bottom of `docs/QA-TEST-PLAN.md` (non-destructive). Write paths (UP-*, TRK-08) only with a disposable applicant.

### 10.3 Feature-specific landmines

**Diff-mode re-scrape (`TODO.md` #2)** — compute `{added, removed, statusChanged}` in `importApps` **before** replacing `existing.applicants`. No-AID rows cannot be matched; do not pretend they can. Persist the diff until the next scrape (session field or localStorage). UI: toast + a "changed" pill. Keep merge of call progress unchanged.

**Bulk dipi status (`TODO.md` #5)** — must have: dry-run list of exact AID+old→new, throttle, per-row log, circuit-break on consecutive FAIL, no retry storms. Copy the photo `WriteBack` discipline, not a `for` loop of fire-and-forget GETs.

**Stats panel (`TODO.md` #6)** — aggregate existing sessions only. Day-0 attendance (`TODO.md` #8) is a separate capture.

**Letter pre-fetch (`TODO.md` #9)** — throttled loop over the existing bridge; cache in memory/IndexedDB; still allow-listed; do not prefetch from the bookmarklet path (no bridge).

**Callback scheduler (`TODO.md` #7)** — optional structured time on `callback`; do not parse free-text notes as a scheduler.

**Audit rule** — add a fixture row in `test/audit.test.js` that would have been a false positive on a clean `mkRow()`. Inactive rows (`isActive`) are exempt from most rules — do not flag Cancelled/Regret as missing PAN.

**Photo detection** — MediaPipe keypoints are the preferred upright test; native `FaceDetector` false-positives on sideways faces. Safari/Firefox: hide auto buttons, manual only. Never load vendor from a CDN.

### 10.4 Version bump mapping

| You edited | Also bump |
|---|---|
| `scraper.js`, `tracker-inline.js` | `scraper.user.js` `@version` |
| `course-audit/audit.js`, `loader.js` | `course-audit/userscript.user.js` `@version` |
| `photo-review/review.js`, `facematch.js` | `photo-review/userscript.user.js` `@version` |
| `extension-fab.js`, `background.js`, `manifest.json` resources | `manifest.json` `"version"` for store; TM unaffected |
| `launcher.js` | github.io only (bookmarklet cache-busts); no TM version |

---

## 11. Verification gates (required before "done")

### Automated

```bash
npm test          # or: node --test
```

Must stay green. If you changed a pure helper or audit check and did not add/adjust a case, you are not done.

There is **no** browser automation harness. DOM paths are manual.

### Manual (minimum)

Use `docs/QA-TEST-PLAN.md` **Regression smoke test** (10 steps, non-destructive) after any logic change.

Additionally match the area:

| Area | Extra IDs |
|---|---|
| Scrape / filter / pool | SCR-03, SCR-07, BF-01 |
| Merge / backup | TRK-02, EXP-05, EXP-06, EXP-07 |
| WhatsApp | WA-01, WA-02, WA-10 (bookmarklet expected generic) |
| Audit rules | AUD-03, AUD-04, plus the specific `check` id |
| Photos local | PRA-01, PR-02, PR-12 |
| Photos upload | UP-10 first-use on **one** disposable record before any batch |
| Privacy | PRIV-01, PRIV-02 |

Repeat per channel when the case table says so.

### Grep guards for packaged files

Before a store zip / any change under files listed in `manifest.json` `web_accessible_resources`:

- No new `https://` literals used as `script.src`, `import()`, or wasm roots.
- Letter URLs still allow-listed in `background.js` and `scraper.user.js`.
- `git check-ignore` on any new `*.csv` / `session_*.json` / screenshot you created.

### Do not claim

- "Works in the extension" if you only tested the github.io cache-busted path.
- "Personalized WhatsApp works" on the bookmarklet (it cannot).
- "Write-back is safe" without the first-use checklist.
- "Duplicates are the same person" — matches are **leads**, verify ID documents.

---

## 12. Current shipped surface (so you do not rebuild it)

Versions at last inventory (re-read files; do not trust this paragraph after a release):

- Extension `manifest.json` **1.5.6**
- `scraper.user.js` **1.7.5**
- `course-audit/userscript.user.js` **1.2.5**
- `photo-review/userscript.user.js` **1.9.0**

**Already shipped (do not duplicate):**

- Inline tracker (PWA copy retired)
- Session backup export/import
- Reconfirmation countdown (⏳ T-7/14/21) + priority sort
- Wait-list/Review pool + backfill on Cancelled
- Letter-fetch bridge (extension + TM)
- Native WhatsApp app scheme by default
- Audit rule unit tests + CI
- Photo MediaPipe self-host, auto-scan/fix, dipi write-back with dry-run
- 👥 face duplicates (close-up indexing fix in 1.5.6)
- Click-to-run FAB default, autorun opt-in

**Next P1:** diff-mode re-scrape (`TODO.md` #2).

**P2:** bulk dipi status with dry-run (#5), stats panel (#6).

**Open questions** (from memory doc — investigate only if the bug needs them):

1. `/change-status` `l` parameter
2. Real FAIL response schema
3. Whether scraper exposes `pancard` when Aadhaar is primary ID
4. Custom status `c` HAR verification
5. Two-admin last-write-wins on dipi (accepted for 1–3 people)
6. Whether `show-photo/{id}` id is stable after upload

---

## 13. Audit check ids (when debugging a finding)

Hard: `missing_field`, `phone_short`, `phone_prefix_invalid`, `email_missing`, `email_malformed`, `aadhar_masked`, `aadhar_length`, `id_missing`, `id_type_concatenated`, `id_type_unknown`, `id_type_mismatch`, `pan_missing` (opt-in), `pan_invalid`, `age_dob_mismatch`, `age_under_min`, `age_over_max`, `conf_gender_mismatch`, `conf_no_duplicate`, `within_file_duplicate`, `status_unknown`, `name_title_prefix`.

Safety: `emergency_eq_self`, `emergency_partial`.

Soft: `shared_mobile`, `shared_email_unrelated`.

Cross-course: `cross_course_duplicate` (aadhar / PAN / phone / email / name+DOB) plus optional 👥 face flags from `faceDedup.flags`.

Teacher-review prompt: noise-filtered sensitive disclosures only (see `course-audit/README.md`). Admin WhatsApp summary: names + check labels + **counts**, never raw Aadhaar/health text.

---

## 14. Working style (Kapil)

- Answer first, then reasoning. Direct, technically precise.
- Surface tradeoffs and uncertainty. If two interpretations exist, present them.
- Suggest a commit message when shipping, in the `type(scope):` shape, without extra trailers.
- Do not suggest switching frameworks, adding a server, or moving storage off-device.
- Test against real course data before declaring done; never commit that data.
- Conservative on safety-related defaults.

---

## 15. First commands in a new checkout

```bash
cd /path/to/callconfirm
npm test                          # zero-dep unit tests
# Extension: chrome://extensions → Load unpacked → repo root
# TM: install the three github.io .user.js URLs (or raw files)
# Bookmarklet: open setup.html
# Then log into dipi, open /search-course/63/{courseid}
```

If `hub/` is present: ignore it for DIPI work.

---

## 16. One-shot invocation examples

**Scan:**

> Read `docs/FEATURE-DEBUG-PROMPT.md`. MODE=scan. Produce the scan output template. Do not edit files.

**Debug:**

> Read `docs/FEATURE-DEBUG-PROMPT.md`. MODE=debug. Channel=extension. Symptom: 💬 WhatsApp on an applicant with an AID falls back to the generic Hindi template within a second. Isolate whether the letter bridge ran, whether the allow-list rejected the URL, and whether parse dropped the body. Fix only if you can name the function.

**Feature:**

> Read `docs/FEATURE-DEBUG-PROMPT.md`. MODE=feature. Implement `TODO.md` #2 diff-mode re-scrape. Keep `importApps` AID merge unchanged. Add unit tests for the diff computation. No dipi writes. Bump `scraper.user.js` `@version`. Update QA-TEST-PLAN with a SCR/TRK case.

---

*This prompt is the operational contract. If it disagrees with code, the code plus a failing test win — then update this file, `CALL-TRACKER-MEMORY.md`, and the relevant README in the same change.*
