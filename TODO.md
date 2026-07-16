# TODO — feature roadmap

Prioritized feature backlog for the DIPI course-admin tools. Grounded in two
sources: the centre's actual reconfirmation mechanics (students must reconfirm
~2–3 weeks before the course or the seat auto-cancels to the wait-list; late
cancellations leave cushions empty; a no-show wastes food/bedding planned on
confirmed numbers; gender balance constrains backfill), and the older raw list
in `CALL-TRACKER-MEMORY.md` → "Things NOT yet implemented".

Effort: **S** ≈ an evening, **M** ≈ a weekend, **L** = multi-session.
Risk = chance of breaking something that already works (write paths, merges).

---

## P1 — build next

### 1. Reconfirmation countdown ("T-minus" view) — ✅ SHIPPED 2026-07-16
- **Requirement:** Tracker header shows "course starts in N days — reconfirm
  deadline (T-14/T-21) in M days"; pending queue sorts not-yet-confirmed
  applicants to the top as the deadline nears; deadline offset configurable
  (centres differ: 14 vs 21 days).
- **Helps:** Turns the tracker from a flat list into deadline triage — the
  admin calls the riskiest people first, before seats auto-cancel. Matches how
  centres actually run the confirmation window.
- **Effort: S.** Course dates are already scraped (`courseDates` in the
  session); needs a date parser for the "30th-Jul to 2nd-Aug 2026" format
  (one exists in `course-audit/loader.js` → `parseCourseStart`), a header line
  and a sort tweak in `tracker-inline.js`. No writes, no new data.

### 2. Diff-mode re-scrape
- **Requirement:** After a re-scrape of a course that already has a session,
  show what changed: new applicants, dropped/cancelled, dipi-status changes.
  Toast summary + a "changed" filter pill; changes list kept until next scrape.
- **Helps:** Admins re-scrape daily during the confirmation window; today the
  new scrape silently wins and changes are invisible. This makes the daily
  check a 10-second glance and pairs with the T-minus view (deadline + delta).
- **Effort: M.** `importApps` in `tracker-inline.js` already merges by AID —
  compute the diff there before overwriting; UI is a pill + list. Care at the
  merge edge cases (no-AID rows match by nothing). No writes to dipi.

### 3. Session export / import (backup + hand-off)
- **Requirement:** Export the active session (applicants + call statuses +
  notes) to a JSON file; import it on another machine/profile, merging by AID
  with newest-timestamp-wins.
- **Helps:** All call progress lives in one browser's IndexedDB — a profile
  wipe or machine switch mid-course loses it, and a half-done calling session
  can't be handed to another volunteer today. Cheap insurance for the scariest
  operational risk.
- **Effort: S.** Serialize the session object (already self-contained);
  import = existing merge logic + a file picker. Note the export contains
  applicant PII — same handling rules as CSV exports (gitignored patterns).

---

## P2 — high value, needs more care

### 4. Wait-list backfill assistant
- **Requirement:** Scrape must include `WaitList` status rows (today
  `STATUS_FILTER` in `scraper.js` is hardcoded `Expected,Confirmed`). When an
  applicant is marked Cancelled, surface "next eligible wait-list candidates"
  filtered to the same gender/group (NM/OM/NF/OF/SM/SF already captured), with
  call/WhatsApp buttons.
- **Helps:** Late cancellations "often lead to unfilled vacancies" — seats sit
  empty because backfill is slow and gender-constrained. This closes the loop
  from cancellation to offer in one click.
- **Effort: M.** Scraper filter + group-matching + a small panel in the
  expanded card. Read-only against dipi; the offer itself stays human.

### 5. Bulk dipi status change (dry-run gated)
- **Requirement:** "Mark all applicants with ≥3 no-answer attempts as
  Cancelled in dipi" — batch over the existing per-applicant
  `changeDipiStatus` (GET `/change-status/{aid}`), behind a dry-run list
  showing exactly who/what changes, throttled, with a per-row result log.
- **Helps:** Right before the deadline this is dozens of identical manual
  clicks; batch + dry-run does it in one reviewed action and frees seats for
  the wait-list sooner.
- **Effort: M, risk high** (write path). Follow the photo-upload discipline:
  dry-run modal, throttle, per-row verify, no retry storms. Circuit-break on
  consecutive failures like WriteBack.gs does in the 80G repo.

### 6. Stats panel
- **Requirement:** Per-course and cross-course funnel from stored sessions:
  confirmed/cancelled/no-answer rates, avg attempts to confirm, best
  time-of-day to reach people, no-show rate once day-0 data exists.
- **Helps:** Tells the centre *how much* to over-book — the strategic answer
  to no-shows wasting food/bedding — and when calling is most effective.
- **Effort: M.** Data already in IndexedDB sessions; work is aggregation +
  rendering. No new capture needed except day-0 attendance (see #8).

---

## P3 — nice to have

### 7. Callback scheduler
- **Requirement:** The existing `callback` status gets an optional "after
  HH:MM" note; queue floats due callbacks to the top.
- **Helps:** "Call me after 6pm" currently lives in free-text notes and gets
  forgotten. **Effort: S.**

### 8. Day-0 arrival mode
- **Requirement:** On course-start day, a check-in list (arrived / expected),
  instant no-show list with call buttons; writes attendance into the session
  for #6's no-show stats.
- **Helps:** The scramble hour where every no-show matters. **Effort: M.**

### 9. Letter pre-fetch cache
- **Requirement:** Before a calling session, pre-fetch personalized letters
  for all pending applicants (currently fetched one-by-one when 💬 is tapped).
- **Helps:** WhatsApp sends become instant during calls. **Effort: S**, but
  mind rate: throttle the `l.php` fetches.

### 10. WhatsApp templates per course type
- **Requirement:** Fallback message template varies by course type
  (10-day vs 3-day vs STP), editable in one place.
- **Helps:** Right expectations in the nudge message. **Effort: S.**

---

## Deferred (deliberately)

- **Background dial / SMS chains** — `tel:`/`sms:` handler behavior is fragile
  across platforms; low confidence it ever works reliably.
- **Two-way status sync** (tracker status → auto-offer dipi flip) — #5's
  explicit batch with dry-run covers the need with less magic.
- **Multi-admin live sync / conflict UI** — real problem (last-write-wins on
  dipi today) but heavy; #3's export/import hand-off is the 80% answer for a
  1–3 person team.
- **Multi-language tracker UI** — summaries already mix Hindi where donors see
  them; admin UI English is acceptable for now.

---

*Sources for the domain claims: dhamma.org centre pages (Dhamma Dharā "How to
Apply", Dhamma Surabhi "Registration", Dhamma Karunā "Registration of Your
Application", Dhamma Pallava FAQ, dhamma.org support FAQ) and
vipassana.cool's application guide — see git history (2026-07-16) for the
research summary.*
