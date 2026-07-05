# dipi.vridhamma.org Photo Review

Review and correct applicant photos on `https://dipi.vridhamma.org/search-course/{centreid}/{courseid}` pages. Photos are often rotated 90°/180° (phone uploads) or "zoomed out" (a whole passport page where the face is a tiny fraction of the frame). dipi re-encodes uploads to 800px JPEGs and strips EXIF, so orientation cannot be fixed via metadata — this tool rotates/crops the actual pixels.

**Local by default.** Corrections (rotation angle + crop rectangle, no pixels) are stored in `localStorage.photoReview.corrections`, keyed by photo ID. Corrected JPEGs are exported by explicit download. Nothing is written to dipi and no photo leaves the browser except via the explicit ⬆dipi upload buttons described below.

Works on any centre — nothing is hardcoded.

## Files

| File | Role |
|---|---|
| `review.js` | The overlay: review grid, rotate/crop, FaceDetector auto-suggest + confidence-gated auto-fix, JPEG export. Cache-busted (`?v=Date.now()`) — updates go live on next run after push. |
| `userscript.user.js` | Tampermonkey shell. Adds "📷 Photos" to the shared FAB stack (`data-order` 30, below Audit 10 and Scrape 20). Auto-run defaults **off** (image loading is heavy); right-click the button to toggle. |
| `bookmarklet.txt` | One-click alternative for machines without Tampermonkey. |

## Install

- **Userscript:** open `https://kapaggar.github.io/callconfirm/photo-review/userscript.user.js` — Tampermonkey prompts to install.
- **Bookmarklet:** drag the contents of `bookmarklet.txt` to your bookmarks bar; click it on a `/search-course/` page.

## Usage

1. Open a course page, click **📷 Photos**. The grid loads every applicant photo from the DataTable dataset (`show-photo/{id}` URLs, same-origin) — lazily, as you scroll.
2. **⚡ Auto-scan** (Chrome only): uses the browser's on-device `FaceDetector` to try all four rotations per photo. Suggests a rotation when the face is only upright in another orientation, and a crop when the detected face is under 15% of the frame (documents, full-body shots, framed prints, and borderline wide shots — course-58 portraits ran 13–33%). After a scan, photos with nothing to fix and a face in the 15–45% band get a green **✓ good** badge as positive confirmation. The suggested crop is passport-style: the whole head with hair/chin margin (0.6 face-heights above and below the detected box), pixel aspect locked to **260:280** to match dipi's photo frame; it shrinks to keep that ratio when the head runs past the photo edge. Suggestions are amber badges — click to apply; nothing is applied automatically. Hovering a badge shows the raw evidence (face-area % per rotation, landmark verdict). `FaceDetector` also "detects" faces at wrong rotations, so when rotation 0 already sees a comparable face and no other rotation clearly dominates it, the photo is left as-is rather than suggesting whichever rotation scored the biggest box. Safari/Firefox don't have `FaceDetector`; the buttons are hidden and review is manual. Note: desktop Chrome only exposes `FaceDetector` behind `chrome://flags/#enable-experimental-web-platform-features`.
   - **▦ Boxes** (header) overlays FaceDetector's bounding box and face-area % on each card (for the displayed rotation, uncropped photos only) — use it to see exactly what the detector saw and to calibrate the thresholds. Cards with a crop suggestion also show the proposed 260:280 passport crop as a dashed green rectangle, so you can judge it before clicking the badge.
3. **✨ Auto-fix** (Chrome only): like Auto-scan, but it *applies* the fixes it's confident about instead of only suggesting them. `FaceDetector` gives no confidence score and will even detect upside-down faces, so confidence is derived from **landmarks** (eyes/nose/mouth via `fastMode:false`): a fix is auto-applied only when one orientation's landmarks are unambiguously upright (eyes level, above nose/mouth), or — when landmarks are unavailable — when a face is found at exactly one rotation. Everything else stays an amber suggestion, and photos with no detectable face are left for manual review.
   - **When landmarks aren't available** (Chrome on macOS returns face boxes but no eyes/nose/mouth), it falls back to **area dominance**: the correct orientation usually detects a clearly larger face, so a rotation is auto-applied when one orientation dominates the others in face size. The 90°/270° sideways cases (phone photos) are handled this way; the 180° flip stays a *suggestion* in this path, because face size alone can't reliably tell an upright face from an upside-down one. With landmarks present, 180° auto-applies too.
   - **Rotation** auto-applies on high confidence. **Crop** auto-applies only when high-confidence *and* there's a single face *and* it's centred enough that the crop won't clip it; otherwise the crop stays a suggestion.
   - Auto-fixed cards get a blue border and a **✨ auto** badge and are **not** marked done — you still confirm each. Click **✓** to keep it, or click the blue badge to **revert** to the original. The **✨ Auto-fixed** filter shows exactly the batch awaiting your confirmation. Any manual rotate/crop also clears the auto flag. **✓ Keep auto-fixes** (header) marks the whole auto-fixed batch reviewed in one click — after you've looked it over via the filter; it is intentionally never automatic, since ✓ is what gates batch upload to dipi.
   - Nothing is uploaded to dipi by Auto-fix — it only writes local corrections.
4. **Manual controls per card:** ↺ ↻ 180° rotate, ✂ drag-crop (Esc cancels, ✂ again clears), ✓ mark reviewed, ⬇ download corrected JPEG (`{aid}_{name}.jpg`).
5. **Keyboard:** ←/→ select card, `r` rotate clockwise, `d` toggle done, `s` download.
6. **⬇ Download fixed** exports every photo marked ✓ that has a correction (allow multiple downloads when Chrome asks).
7. Filters: All / ⚠ Suggested / ✨ Auto-fixed / ✓ Fixed / ⏳ Unreviewed.
8. **♻ Reset local** (header) discards ALL locally saved corrections — every course, not just the open one: rotations, crops, ✓ fixed marks, ✨ auto flags and uploaded markers. Behind a confirm; cannot be undone. dipi is untouched, so photos already uploaded stay corrected there.

Corrections persist in localStorage and re-apply whenever the same photo ID appears again (re-opening the course, or the same applicant in another course). Once a photo has been **uploaded to dipi**, the stored geometry is zeroed and an `uploaded` marker is kept instead — the fix now lives in dipi's pixels, so re-applying the saved rotation would double-rotate the already-fixed photo (and a later batch upload would write that corruption back). The ⬆dipi button shows ✓dipi until you make a new correction, which re-arms it.

## Privacy

Applicant photos are sensitive (faces, ID documents). Everything runs in the browser: the photo fetch is same-origin using your existing dipi session, face detection is Chrome's on-device Shape Detection API (no cloud), and localStorage holds only geometry. The only way pixels leave the page is your explicit download click.

## Write corrected photos back to dipi

dipi has **no photo-only endpoint**. Saving a photo means resubmitting the entire application form to `POST /app/{aid}/edit` (Drupal 7, `form_id=dh_ma_applicant_form`, multipart, 302 → `/course/{centre}/{course}` on success). The form carries every field — name, DOB, Aadhar, phone, address, emergency contact, and the health/mental-health/medication/pregnancy disclosures — so a dropped or altered field would **wipe authoritative VRI data**. The upload is built to make that impossible to do silently:

1. **Fetch live form** — GET `/app/{aid}/edit` and snapshot every current field value + fresh `form_build_id`/`form_token` (per-render CSRF; never reused).
2. **Swap only the photo** — replace `files[upload_photo]` with the corrected JPEG; every other field is preserved byte-for-byte.
3. **Dry run** — the per-photo **⬆dipi** button first shows a preview of the exact field set being resubmitted (Aadhar/phone/email/tokens masked on screen, sent in full), with the photo swap highlighted. Nothing is sent until you click **Commit**.
4. **Staleness re-check** (single-photo path) — the dry-run modal can sit open a while; before POSTing, the form is re-fetched and compared with the previewed snapshot. If anyone edited the record on dipi in the meantime, the upload aborts with the changed field names instead of silently overwriting their edit. The fresh fetch also supplies current CSRF tokens.
5. **Verify** — after the POST, the form is re-fetched and diffed against the submitted snapshot (ignoring the photo and the rotating tokens). If any other field drifted, or if Drupal re-rendered the form (validation error = not saved), you get a warning and are told to check the record. A clean result reports "all other fields preserved".

**⬆ Upload fixed to dipi** (header) batches every corrected, reviewed, not-yet-uploaded photo through the same round-trip (minus the staleness re-check — its prepare→commit gap is milliseconds) and **stops at the first failure or drift** so you can inspect it before continuing. The uploaded marker persists in localStorage, so re-running the batch after a reload will not re-send photos that already went through.

### First-use checklist (do this once before trusting it)
1. Correct one photo for a known applicant, mark ✓ done, click **⬆dipi**.
2. In the dry-run preview, confirm the field list looks complete and correct.
3. Commit. Expect "✓ Uploaded — all other fields preserved".
4. Open that applicant's `/app/{aid}/edit` on dipi and eyeball: name, Aadhar (document id), phone, emergency contact, and any health disclosures are all intact, and the photo is now upright.
5. Only after that passes should you use the batch button.

If you'd rather not write to dipi at all, the ⬇ download path still works: export the corrected JPEG and upload it manually on the edit page.
