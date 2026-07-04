# dipi.vridhamma.org Photo Review

Review and correct applicant photos on `https://dipi.vridhamma.org/search-course/{centreid}/{courseid}` pages. Photos are often rotated 90°/180° (phone uploads) or "zoomed out" (a whole passport page where the face is a tiny fraction of the frame). dipi re-encodes uploads to 800px JPEGs and strips EXIF, so orientation cannot be fixed via metadata — this tool rotates/crops the actual pixels.

**Local-only.** Corrections (rotation angle + crop rectangle, no pixels) are stored in `localStorage.photoReview.corrections`, keyed by photo ID. Corrected JPEGs are exported by explicit download. Nothing is written to dipi and no photo ever leaves the browser.

Works on any centre — nothing is hardcoded.

## Files

| File | Role |
|---|---|
| `review.js` | The overlay: review grid, rotate/crop, FaceDetector auto-suggest, JPEG export. Cache-busted (`?v=Date.now()`) — updates go live on next run after push. |
| `userscript.user.js` | Tampermonkey shell. Adds "📷 Photos" to the shared FAB stack (`data-order` 30, below Audit 10 and Scrape 20). Auto-run defaults **off** (image loading is heavy); right-click the button to toggle. |
| `bookmarklet.txt` | One-click alternative for machines without Tampermonkey. |

## Install

- **Userscript:** open `https://kapaggar.github.io/callconfirm/photo-review/userscript.user.js` — Tampermonkey prompts to install.
- **Bookmarklet:** drag the contents of `bookmarklet.txt` to your bookmarks bar; click it on a `/search-course/` page.

## Usage

1. Open a course page, click **📷 Photos**. The grid loads every applicant photo from the DataTable dataset (`show-photo/{id}` URLs, same-origin) — lazily, as you scroll.
2. **⚡ Auto-scan** (Chrome only): uses the browser's on-device `FaceDetector` to try all four rotations per photo. Suggests a rotation when the face is only upright in another orientation, and a crop when the detected face is under ~4% of the frame (the passport-page case). Suggestions are amber badges — click to apply; nothing is applied automatically. Safari/Firefox don't have `FaceDetector`; the button is hidden and review is manual.
3. **Manual controls per card:** ↺ ↻ 180° rotate, ✂ drag-crop (Esc cancels, ✂ again clears), ✓ mark reviewed, ⬇ download corrected JPEG (`{aid}_{name}.jpg`).
4. **Keyboard:** ←/→ select card, `r` rotate clockwise, `d` toggle done, `s` download.
5. **⬇ Download fixed** exports every photo marked ✓ that has a correction (allow multiple downloads when Chrome asks).
6. Filters: All / ⚠ Suggested / ✓ Fixed / ⏳ Unreviewed.

Corrections persist in localStorage and re-apply whenever the same photo ID appears again (re-opening the course, or the same applicant in another course).

## Privacy

Applicant photos are sensitive (faces, ID documents). Everything runs in the browser: the photo fetch is same-origin using your existing dipi session, face detection is Chrome's on-device Shape Detection API (no cloud), and localStorage holds only geometry. The only way pixels leave the page is your explicit download click.

## Roadmap — phase 2: write corrected photos back to dipi

Not built yet, deliberately. The search-course page exposes no photo-upload endpoint; writing back means driving the Drupal form at `/app/{aid}/edit`. The plan, following the `/change-status` precedent in `CALL-TRACKER-MEMORY.md`:

1. Manually re-upload one photo via the edit form with DevTools recording → save HAR.
2. From the HAR, extract the multipart POST shape: file field name, `form_build_id`, `form_token`, and any AJAX wrapper Drupal uses.
3. Add a per-photo "⬆ Upload to dipi" button that posts the corrected canvas blob, gated behind an explicit confirm; keep the local correction as the audit trail.

Until then, the workflow for fixing dipi itself is: ⬇ download the corrected JPEG, then upload it manually on the applicant's edit page.
