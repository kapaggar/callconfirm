// photo-review/review.js — applicant photo review overlay for dipi.vridhamma.org
// Rotate / crop applicant photos that were uploaded sideways, upside down, or
// zoomed out. Local by default: corrections live in localStorage (geometry, no
// pixels), corrected JPEGs are exported via download. dipi is only written via
// the explicit ⬆dipi buttons (full-form-preserving round-trip, see below).
//
// Auto-suggest uses the browser's on-device FaceDetector API where available
// (Chrome); manual rotate/crop works everywhere.
//
// API: window.DipiPhotoReview.{open, close}
(function () {
  'use strict';

  if (window.DipiPhotoReview) { window.DipiPhotoReview.open(); return; }

  const HOST_OK = /(^|\.)vridhamma\.org$/i.test(location.hostname);
  if (!HOST_OK) { alert('Photo Review: not on vridhamma.org. Run on a /search-course/ page.'); return; }

  const OVERLAY_ID = 'dipi-photo-review';
  const STYLE_ID = 'dipi-photo-review-style';
  const STORE_KEY = 'photoReview.corrections';
  const MAX_STORE = 1000;
  const DISPLAY_W = 220;   // card canvas display width
  const SCAN_W = 640;      // downscale width for face detection (bigger = small
                           // faces in full-body shots survive; BlazeFace short-
                           // range needs the face to be a decent px size)
  const RESCAN_W = 1024;   // sharper retry width when the SCAN_W pass finds nothing
  const TINY_FACE = 0.20;  // face area below this fraction => suggest passport crop
                           // (course 58 portraits ran 13-33%; zoom candidates 1.3-7.3%.
                           //  20% pulls every borderline shot into a standard crop)
  const GOOD_MIN = 0.20;   // scanned face area band badged "good size" — no action needed
  const GOOD_MAX = 0.45;   // above this the face fills the frame; left neutral
  const CROP_RATIO = 260 / 280; // crop pixel aspect (w:h) — dipi's photo frame
  const HEAD_TOP = 0.60;    // extra face-heights above the box (hair / forehead)
  const HEAD_BOTTOM = 0.60; // extra face-heights below (chin / neck / shoulders)
  const LEVEL_TOL = 0.35;  // eye-line tilt tolerance (|Δy| / eye-spacing) for "upright"
  const AREA_DOMINANCE = 1.5; // one orientation's face must be this× the next to win on area alone
  const CROP_SAFE_MARGIN = 0.12; // face centre must be this far from any edge to auto-crop

  // ── Pure helpers (unit-testable via _internal) ──
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function rotatedDims(w, h, rot) {
    return (rot === 90 || rot === 270) ? [h, w] : [w, h];
  }
  // Clamp a normalized crop rect to [0,1] with a minimum size
  function clampCrop(c) {
    if (!c) return null;
    let { x, y, w, h } = c;
    w = Math.min(Math.max(w, 0.05), 1);
    h = Math.min(Math.max(h, 0.05), 1);
    x = Math.min(Math.max(x, 0), 1 - w);
    y = Math.min(Math.max(y, 0), 1 - h);
    return { x, y, w, h };
  }
  // Passport-style crop around a detected face box: the whole head (hair above,
  // chin/neck margin below) with the pixel aspect locked to CROP_RATIO (260:280,
  // dipi's photo frame). box is normalized; imgAspect is the rotated image's W/H,
  // needed because a normalized rect's pixel aspect depends on the image shape.
  // Shrinks (keeping ratio) if the head margins run past the frame, then shifts
  // inside without resizing. Pure.
  function passportCrop(box, imgAspect, ratio) {
    if (!box || !(imgAspect > 0)) return null;
    const R = ratio || CROP_RATIO;
    let h = box.h * (1 + HEAD_TOP + HEAD_BOTTOM);
    let w = R * h / imgAspect;
    if (h > 1) { w /= h; h = 1; }
    if (w > 1) { h /= w; w = 1; }
    const x = Math.min(Math.max(box.x + box.w / 2 - w / 2, 0), 1 - w);
    const y = Math.min(Math.max(box.y - box.h * HEAD_TOP, 0), 1 - h);
    return { x, y, w, h };
  }
  // Keep the newest `max` entries of the corrections map
  function pruneCorrections(map, max) {
    const keys = Object.keys(map);
    if (keys.length <= max) return map;
    keys.sort((a, b) => String(map[a].updatedAt || '').localeCompare(String(map[b].updatedAt || '')));
    for (const k of keys.slice(0, keys.length - max)) delete map[k];
    return map;
  }
  function photoIdFromUrl(url) {
    const m = String(url || '').match(/\/show-photo\/(\d+)/);
    return m ? m[1] : null;
  }

  // ── Confidence from FaceDetector landmarks (pure, unit-testable) ──
  // FaceDetector gives no confidence score and detects faces even upside-down, so
  // to tell an upright orientation from a rotated one we inspect the landmarks
  // (eyes/nose/mouth) of the detection made on an already-rotated canvas.
  // Returns true/false, or null when landmarks are missing (→ fall back to area).
  function landmarkOrientationUpright(landmarks) {
    if (!Array.isArray(landmarks) || !landmarks.length) return null;
    const pts = (type) => landmarks
      .filter(l => l && l.type === type && Array.isArray(l.locations))
      .flatMap(l => l.locations)
      .filter(p => p && typeof p.x === 'number' && typeof p.y === 'number');
    const eyes = pts('eye');
    const nose = pts('nose');
    const mouth = pts('mouth');
    if (eyes.length < 2 || (!nose.length && !mouth.length)) return null;
    const [e1, e2] = eyes;
    const spacing = Math.hypot(e2.x - e1.x, e2.y - e1.y);
    if (spacing < 1e-6) return null;
    const level = Math.abs(e1.y - e2.y) / spacing < LEVEL_TOL;
    const avgEyeY = (e1.y + e2.y) / 2;
    const mean = (arr) => arr.reduce((s, p) => s + p.y, 0) / arr.length;
    // eyes must sit above the mouth (and above/at the nose) for an upright face
    const vsMouth = mouth.length ? avgEyeY < mean(mouth) : true;
    const vsNose = nose.length ? avgEyeY <= mean(nose) : true;
    return level && vsMouth && vsNose;
  }

  // Is the face centred enough that an expanded crop won't clip it? (pure)
  function cropIsSafe(box, margin) {
    if (!box) return false;
    const m = margin != null ? margin : CROP_SAFE_MARGIN;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    return cx > m && cx < 1 - m && cy > m && cy < 1 - m &&
      box.x >= 0 && box.y >= 0 && box.x + box.w <= 1 && box.y + box.h <= 1;
  }

  // Turn per-rotation detections into a correction + confidence. (pure)
  // dets: [{ rot, faces, area?, box?, landmarksOk? }] — one entry per rotation tried.
  // Returns { rot?, crop?, confidence:'high'|'medium'|'low', auto:{rot,crop}, noFace? }.
  function classifyDetections(dets, opts) {
    opts = opts || {};
    const tiny = opts.tinyFace != null ? opts.tinyFace : TINY_FACE;
    const dom = opts.areaDominance != null ? opts.areaDominance : AREA_DOMINANCE;
    const margin = opts.cropMargin != null ? opts.cropMargin : CROP_SAFE_MARGIN;
    const withFace = (dets || []).filter(d => d && d.faces >= 1);
    const none = { confidence: 'low', auto: { rot: false, crop: false }, noFace: true };
    if (!withFace.length) return none;

    const byArea = (a, b) => (b.area || 0) - (a.area || 0);
    const landmarkWins = withFace.filter(d => d.landmarksOk === true).sort(byArea);
    const anyLandmarkInfo = withFace.some(d => d.landmarksOk === true || d.landmarksOk === false);

    let best, confidence, landmarkConfirmed = false;
    const det0 = withFace.find(d => d.rot === 0) || null;
    if (landmarkWins.length) {
      // an upright-confirmed face at rot 0 means the photo is already fine —
      // prefer it over a bigger face at some other rotation
      const zero = landmarkWins.find(d => d.rot === 0);
      if (zero) { best = zero; confidence = 'high'; landmarkConfirmed = true; }
      else {
        best = landmarkWins[0];
        // one upright orientation = confident; several = only if one dominates on area
        confidence = (landmarkWins.length === 1 ||
          best.area > (landmarkWins[1].area || 0) * dom) ? 'high' : 'medium';
        landmarkConfirmed = confidence === 'high';
      }
    } else if (!anyLandmarkInfo) {
      // No landmark data anywhere (Chrome/macOS returns boxes but no eyes/nose/mouth):
      // fall back to area — the correct orientation usually detects a clearly bigger
      // face. High confidence when a single rotation dominates the others.
      const sorted = withFace.slice().sort(byArea);
      best = sorted[0];
      confidence = (sorted.length === 1 || best.area > (sorted[1].area || 0) * dom) ? 'high' : 'medium';
      // FaceDetector also "finds" faces at wrong rotations, so when rot 0 sees a
      // face and no other rotation clearly dominates it, keep the photo as-is
      // rather than suggesting whichever rotation scored the biggest box.
      if (det0 && best.rot !== 0 && (best.area || 0) <= (det0.area || 0) * dom) {
        best = det0;
        confidence = 'medium';
      }
    } else {
      // landmarks existed but none confirmed upright → ambiguous; prefer as-is
      best = det0 || withFace.slice().sort(byArea)[0];
      confidence = 'medium';
    }

    const out = { confidence, auto: { rot: false, crop: false } };
    if (best.rot) out.rot = best.rot;
    if (best.box && (best.area || 0) < tiny) out.crop = passportCrop(best.box, best.aspect || 1);
    // Auto-rotate on high confidence. Without landmark confirmation we trust the
    // 90°/270° sideways cases but leave the 180° flip as a suggestion (area alone
    // can't reliably tell an upright face from an upside-down one).
    out.auto.rot = confidence === 'high' && !!best.rot && (landmarkConfirmed || best.rot !== 180);
    out.auto.crop = confidence === 'high' && !!out.crop && best.faces === 1 && cropIsSafe(best.box, margin);
    return out;
  }

  // ── Corrections store (localStorage, geometry only) ──
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveStore(map) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(pruneCorrections(map, MAX_STORE))); } catch (e) {}
  }
  function saveCorrection(item) {
    const map = loadStore();
    map[item.photoId] = {
      rot: item.rot, crop: item.crop || null, done: !!item.done, auto: !!item.auto,
      uploaded: !!item.uploaded, uploadedAt: item.uploadedAt || null,
      aid: item.aid || '', updatedAt: new Date().toISOString(),
    };
    saveStore(map);
  }

  // ── Row extraction (same source as the audit: the DataTable dataset) ──
  function extractRows() {
    const $ = window.jQuery || window.$;
    if (!$) throw new Error('jQuery not found on page');
    const $tbl = $('#table-applicants');
    if (!$tbl.length) throw new Error('#table-applicants not present on this page');
    if (!$.fn.DataTable.isDataTable($tbl)) throw new Error('DataTable not yet initialized; wait and retry');
    return $tbl.DataTable().rows().data().toArray();
  }
  function cleanName(s) {
    if (s == null) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = String(s);
    const link = tmp.querySelector('a[href*="/app/"]');
    const base = link ? link.textContent : tmp.textContent;
    return base.replace(/\s+/g, ' ').trim();
  }

  // ── Rotation drawing ──
  // Draw bitmap into ctx rotated by rot; dw/dh are the (already rotated) dest dims.
  function drawRotated(ctx, bmp, rot, dw, dh) {
    ctx.save();
    switch (rot) {
      case 90:  ctx.translate(dw, 0); ctx.rotate(Math.PI / 2);  ctx.drawImage(bmp, 0, 0, dh, dw); break;
      case 180: ctx.translate(dw, dh); ctx.rotate(Math.PI);     ctx.drawImage(bmp, 0, 0, dw, dh); break;
      case 270: ctx.translate(0, dh); ctx.rotate(-Math.PI / 2); ctx.drawImage(bmp, 0, 0, dh, dw); break;
      default:  ctx.drawImage(bmp, 0, 0, dw, dh);
    }
    ctx.restore();
  }
  // Full-resolution corrected canvas: rotate, then crop (crop is normalized,
  // in post-rotation coordinates — you crop what you see).
  function correctedCanvas(item) {
    const bmp = item.bitmap;
    const [rw, rh] = rotatedDims(bmp.width, bmp.height, item.rot);
    const full = document.createElement('canvas');
    full.width = rw; full.height = rh;
    drawRotated(full.getContext('2d'), bmp, item.rot, rw, rh);
    if (!item.crop) return full;
    const c = item.crop;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(c.w * rw));
    out.height = Math.max(1, Math.round(c.h * rh));
    out.getContext('2d').drawImage(full, c.x * rw, c.y * rh, c.w * rw, c.h * rh, 0, 0, out.width, out.height);
    return out;
  }

  // ── dipi write-back (phase 2) ──
  // dipi has no photo-only endpoint. Saving a photo means resubmitting the WHOLE
  // application form to POST /app/{aid}/edit (multipart, 302 on success). So we:
  //   1. GET the live edit form, preserve every current field + fresh CSRF tokens
  //   2. swap only files[upload_photo] with the corrected JPEG
  //   3. POST the reconstructed form
  //   4. re-GET and diff — confirm no other field (name, Aadhar, health, etc.) drifted
  // A dropped/altered field would wipe authoritative VRI data, so every step verifies.
  const APPLICANT_FORM_ID = 'dh_ma_applicant_form';
  const VERIFY_IGNORE = new Set(['form_build_id', 'form_token', 'files[upload_photo]', 'op']);

  function editUrlFor(aid) { return '/app/' + encodeURIComponent(aid) + '/edit'; }

  // Pure: turn a plain control descriptor into its submitted [name,value] entries,
  // following standard HTML form-submission semantics.
  function controlToEntries(c) {
    if (!c.name || c.disabled) return [];
    const type = (c.type || '').toLowerCase();
    if (type === 'file' || type === 'submit' || type === 'button' || type === 'image' || type === 'reset') return [];
    if (type === 'checkbox' || type === 'radio') return c.checked ? [[c.name, c.value != null ? c.value : 'on']] : [];
    if (c.tag === 'select') return (c.options || []).filter(o => o.selected).map(o => [c.name, o.value]);
    return [[c.name, c.value != null ? c.value : '']];
  }

  // Read a DOM control into the plain descriptor controlToEntries expects.
  function describeControl(el) {
    return {
      name: el.name, tag: el.tagName.toLowerCase(), type: el.type, disabled: el.disabled,
      checked: el.checked, value: el.value,
      options: el.tagName.toLowerCase() === 'select'
        ? Array.from(el.options).map(o => ({ value: o.value, selected: o.selected })) : null,
    };
  }

  // Parse the edit-form HTML into { form, entries }. Picks the form carrying the
  // applicant form_id, so unrelated page forms (search, logout) are never touched.
  function parseEditForm(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const forms = Array.from(doc.querySelectorAll('form'));
    const form = forms.find(f => {
      const fid = f.querySelector('input[name="form_id"]');
      return fid && fid.value === APPLICANT_FORM_ID;
    });
    if (!form) return { form: null, entries: [] };
    const entries = [];
    form.querySelectorAll('input, select, textarea').forEach(el => {
      controlToEntries(describeControl(el)).forEach(e => entries.push(e));
    });
    return { form, entries };
  }

  // Pure: names whose trimmed value differs between two entry lists (ignoring set).
  function diffEntries(before, after, ignore) {
    const norm = (list) => {
      const m = {};
      list.forEach(([k, v]) => { if (!ignore.has(k)) m[k] = (m[k] || []).concat(String(v == null ? '' : v).trim()); });
      return m;
    };
    const a = norm(before), b = norm(after);
    const drift = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const av = (a[k] || []).join(''), bv = (b[k] || []).join('');
      if (av !== bv) drift.push(k);
    }
    return drift;
  }

  // Pure: mask sensitive values for the dry-run preview (data is still SENT in full;
  // this only controls what's shown on screen).
  function maskValue(name, val) {
    const s = String(val == null ? '' : val);
    if (/form_build_id|form_token/.test(name)) return '<' + s.length + ' chars>';
    if (/document_id|phone|_num|mobile/i.test(name) && s.replace(/\D/g, '').length >= 5) {
      const d = s.replace(/\s/g, '');
      return d.length <= 4 ? d : 'XXXX…' + d.slice(-4);
    }
    if (/email/i.test(name) && s.includes('@')) { const [u, dom] = s.split('@'); return (u[0] || '') + '…@' + dom; }
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }

  function buildUploadBody(entries, blob, filename) {
    const fd = new FormData();
    entries.forEach(([k, v]) => { if (k !== 'files[upload_photo]') fd.append(k, v); });
    fd.set('op', 'Update');
    fd.set('files[upload_photo]', blob, filename);
    return fd;
  }

  async function correctedBlob(item) {
    if (!item.bitmap) await loadBitmap(item);
    if (!item.bitmap) throw new Error('photo not loaded');
    const c = correctedCanvas(item);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('JPEG export failed');
    return blob;
  }
  function uploadFilename(item) {
    const safe = (item.name || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return (item.aid || item.photoId) + (safe ? '_' + safe : '') + '.jpg';
  }

  // Step 1: fetch the live form, snapshot every field, render the corrected JPEG.
  // Returns { ok, entries, blob, filename } or an error result. Never throws.
  async function prepareUpload(item) {
    if (!item.aid) return { ok: false, stage: 'precheck', error: 'no application id (aid) for this row' };
    if (item.rot === 0 && !item.crop) return { ok: false, stage: 'precheck', error: 'no correction to upload' };
    try {
      const getResp = await fetch(editUrlFor(item.aid), { credentials: 'same-origin' });
      if (!getResp.ok) return { ok: false, stage: 'fetch-form', error: 'HTTP ' + getResp.status };
      const before = parseEditForm(await getResp.text());
      if (!before.form) return { ok: false, stage: 'fetch-form', error: 'applicant form not found (session expired?)' };
      const blob = await correctedBlob(item);
      return { ok: true, entries: before.entries, blob, filename: uploadFilename(item) };
    } catch (e) {
      return { ok: false, stage: 'exception', error: e.message };
    }
  }

  // Step 2: POST the reconstructed form (photo swapped), then re-GET and diff to
  // prove no other field drifted. Returns a result object; never throws.
  // opts.recheckStale: re-fetch the form just before POSTing and abort if any
  // field no longer matches the previewed snapshot — the dry-run modal can sit
  // open a while, and POSTing a stale snapshot would silently overwrite an edit
  // someone made on dipi in the meantime (a drift the post-verify can't see,
  // because it diffs against our own snapshot). The fresh fetch also supplies
  // current CSRF tokens. Used by the single-photo path; the batch loop's
  // prepare→commit gap is milliseconds, so it skips the extra GET.
  async function commitUpload(item, prepared, opts) {
    opts = opts || {};
    try {
      let entries = prepared.entries;
      if (opts.recheckStale) {
        const freshResp = await fetch(editUrlFor(item.aid), { credentials: 'same-origin' });
        if (!freshResp.ok) return { ok: false, stage: 'recheck', error: 'HTTP ' + freshResp.status };
        const fresh = parseEditForm(await freshResp.text());
        if (!fresh.form) return { ok: false, stage: 'recheck', error: 'applicant form not found (session expired?)' };
        const stale = diffEntries(prepared.entries, fresh.entries, VERIFY_IGNORE);
        if (stale.length) return { ok: false, stage: 'recheck', error: 'record changed on dipi since the preview (' + stale.join(', ') + ') — nothing sent; run ⬆dipi again to preview the current values' };
        entries = fresh.entries;
      }
      const body = buildUploadBody(entries, prepared.blob, prepared.filename);
      const postResp = await fetch(editUrlFor(item.aid), { method: 'POST', credentials: 'same-origin', body });
      const landedOnEdit = /\/app\/\d+\/edit/.test(postResp.url);
      if (!postResp.ok || landedOnEdit) {
        // Drupal re-renders the form (200, still on /edit) on validation failure — NOT saved.
        return { ok: false, stage: 'submit', error: landedOnEdit ? 'form rejected (validation error) — nothing saved' : 'HTTP ' + postResp.status };
      }
      const verifyResp = await fetch(editUrlFor(item.aid), { credentials: 'same-origin' });
      if (!verifyResp.ok) return { ok: true, stage: 'verify', warn: 'saved, but could not re-fetch to verify (HTTP ' + verifyResp.status + ')' };
      const after = parseEditForm(await verifyResp.text());
      const drift = diffEntries(entries, after.entries, VERIFY_IGNORE);
      if (drift.length) return { ok: true, stage: 'verify', drift, warn: 'saved, but these fields changed: ' + drift.join(', ') };
      return { ok: true, stage: 'done' };
    } catch (e) {
      return { ok: false, stage: 'exception', error: e.message };
    }
  }

  // ── Face detection backends ──
  // Preferred: MediaPipe tasks-vision (BlazeFace, WASM) — runs fully on-device,
  // returns eye/nose/mouth keypoints so "upright" can be confirmed at each
  // rotation, and it barely detects faces at wrong rotations (clean signal).
  // The library + model (~3 MB) are fetched once from pinned CDN URLs; photos
  // never leave the browser with either backend.
  // Fallback: native window.FaceDetector (Chrome behind a flag) — on macOS it
  // returns boxes without landmarks and detects sideways faces at rot 0, so
  // orientation there rests on the weaker area heuristics.
  const hasFaceDetector = ('FaceDetector' in window);
  // Self-hosted MediaPipe only (repo vendor/mediapipe/, version + hashes in its
  // README): the base derives from this script's own URL, so the same file
  // works from the web-hosted copy and the chrome-extension:// copy. Must run
  // synchronously at load — document.currentScript is null in callbacks.
  // Deliberately NO CDN fallback: MV3 forbids remotely hosted code and the Web
  // Store rejects packages containing remote script/wasm URLs ("Blue Argon").
  const MP_SELF = (() => {
    const cs = document.currentScript;
    return (cs && cs.src) ? new URL('../vendor/mediapipe/', cs.src).href : null;
  })();
  // Own URL — lazy-loads the sibling facematch.js when 👥 Duplicates is used.
  const PR_SELF = (document.currentScript && document.currentScript.src) || null;
  let mpDetector = null, mpTried = false;
  async function getMpDetector() {
    if (mpDetector || mpTried) return mpDetector;
    mpTried = true;
    if (!MP_SELF) return null; // inline-eval'd (never in practice) → native fallback
    try {
      const vision = await import(MP_SELF + 'vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(MP_SELF + 'wasm');
      mpDetector = await vision.FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: MP_SELF + 'blaze_face_short_range.tflite' },
        runningMode: 'IMAGE',
        // Recall-biased: a small/backlit face against a busy background scores
        // low, and every suggestion is human-confirmed (✓), so a marginal hit is
        // cheaper than a "no face found" miss.
        minDetectionConfidence: 0.3,
      });
    } catch (e) {
      mpDetector = null; // vendor assets missing/unreachable → native FaceDetector fallback
    }
    return mpDetector;
  }

  // MediaPipe keypoint order: 0 right eye, 1 left eye, 2 nose tip, 3 mouth,
  // 4/5 ear tragions. Upright = eye line level AND eyes above nose and mouth.
  // Returns true/false, or null when keypoints are missing. (pure)
  function keypointsUpright(kps) {
    if (!Array.isArray(kps) || kps.length < 4) return null;
    const [eyeR, eyeL, nose, mouth] = kps;
    if ([eyeR, eyeL, nose, mouth].some(p => !p || typeof p.x !== 'number' || typeof p.y !== 'number')) return null;
    const spacing = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y);
    if (!(spacing > 1e-6)) return null;
    const level = Math.abs(eyeL.y - eyeR.y) / spacing < LEVEL_TOL;
    const avgEyeY = (eyeR.y + eyeL.y) / 2;
    return level && avgEyeY < mouth.y && avgEyeY < nose.y;
  }

  // Detect faces on a canvas via the best available backend. Returns a list of
  // { box (normalized), upright (true/false/null) } sorted by area desc, or
  // null when no backend is available at all.
  let nativeFd = null;
  async function detectOn(canvas) {
    const mp = await getMpDetector();
    if (mp) {
      const res = mp.detect(canvas);
      return (res.detections || []).map(d => ({
        box: {
          x: d.boundingBox.originX / canvas.width, y: d.boundingBox.originY / canvas.height,
          w: d.boundingBox.width / canvas.width, h: d.boundingBox.height / canvas.height,
        },
        upright: keypointsUpright(d.keypoints),
      })).sort((a, b) => (b.box.w * b.box.h) - (a.box.w * a.box.h));
    }
    if (!hasFaceDetector) return null;
    // fastMode:false yields landmarks where the platform provides them
    if (!nativeFd) nativeFd = new window.FaceDetector({ maxDetectedFaces: 2, fastMode: false });
    const faces = await nativeFd.detect(canvas);
    return faces.map(f => ({
      box: {
        x: f.boundingBox.x / canvas.width, y: f.boundingBox.y / canvas.height,
        w: f.boundingBox.width / canvas.width, h: f.boundingBox.height / canvas.height,
      },
      upright: landmarkOrientationUpright(f.landmarks),
    })).sort((a, b) => (b.box.w * b.box.h) - (a.box.w * a.box.h));
  }

  // Scan all four rotations at a given downscale width. Returns a per-rotation
  // dets array, or null when no detection backend is available at all.
  async function scanRotations(item, scanW) {
    const dets = [];
    for (const rot of [0, 90, 270, 180]) {
      const [rw, rh] = rotatedDims(item.bitmap.width, item.bitmap.height, rot);
      const scale = Math.min(1, scanW / rw); // never upscale past native
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(rw * scale));
      c.height = Math.max(1, Math.round(rh * scale));
      drawRotated(c.getContext('2d'), item.bitmap, rot, c.width, c.height);
      let faces;
      try { faces = await detectOn(c); } catch (e) { return null; }
      if (faces === null) return null; // no detection backend available
      if (!faces.length) { dets.push({ rot, faces: 0 }); continue; }
      const f = faces[0];
      dets.push({
        rot, faces: faces.length,
        area: f.box.w * f.box.h,
        aspect: c.width / c.height, // rotated-image shape; passportCrop needs it to lock pixel aspect
        box: f.box,
        landmarksOk: f.upright,
      });
    }
    return dets;
  }

  async function suggestFor(item) {
    if (!item.bitmap) return null;
    let dets = await scanRotations(item, SCAN_W);
    if (dets === null) return null; // no detection backend available
    // Small face in a wide/full-body shot can fall below the detector's floor at
    // the base width. If nothing was found and the source has resolution to
    // spare, retry once sharper before giving up ("no face found").
    if (!dets.some(d => d.faces > 0) &&
        Math.max(item.bitmap.width, item.bitmap.height) > SCAN_W) {
      const sharper = await scanRotations(item, RESCAN_W);
      if (sharper && sharper.some(d => d.faces > 0)) dets = sharper;
    }
    item.dets = dets; // kept for the ▦ Boxes overlay and the badge tooltip
    return classifyDetections(dets, { tinyFace: TINY_FACE });
  }

  // One line per rotation tried: face area % and landmark verdict — this is the
  // raw evidence behind a suggestion, surfaced so thresholds can be calibrated.
  function detSummary(item) {
    if (!item.dets) return '';
    return item.dets.map(d => d.rot + '°: ' + (d.faces
      ? (100 * (d.area || 0)).toFixed(1) + '%' + (d.landmarksOk === true ? ' ✓lm' : d.landmarksOk === false ? ' ✗lm' : '')
      : 'no face')).join('  ·  ');
  }

  // ── State ──
  const state = { items: [], filter: 'all', sel: -1, scanning: false, showBoxes: false };

  function counts() {
    const c = { all: state.items.length, suggested: 0, autofixed: 0, fixed: 0, unreviewed: 0 };
    state.items.forEach(it => {
      if (it.suggestion && (it.suggestion.rot !== undefined || it.suggestion.crop)) c.suggested++;
      if (it.auto && !it.done) c.autofixed++;
      if (it.done) c.fixed++; else c.unreviewed++;
    });
    return c;
  }
  function visible(it) {
    if (state.filter === 'suggested') return it.suggestion && (it.suggestion.rot !== undefined || it.suggestion.crop);
    if (state.filter === 'autofixed') return it.auto && !it.done;
    if (state.filter === 'fixed') return it.done;
    if (state.filter === 'unreviewed') return !it.done;
    return true;
  }

  // ── Write-back UI: dry-run preview + single / batch orchestration ──
  function correctionSummary(item) {
    const bits = [];
    if (item.rot) bits.push('rotated ' + item.rot + '°');
    if (item.crop) bits.push('cropped');
    return bits.join(' + ') || 'no change';
  }

  // Modal listing every field that will be resubmitted (sensitive values masked),
  // with the photo swap highlighted. Resolves true to commit, false to cancel.
  function dryRunConfirm(item, prepared) {
    return new Promise((resolve) => {
      const ov = document.getElementById(OVERLAY_ID);
      const modal = document.createElement('div');
      modal.className = 'pr-modal';
      const rows = prepared.entries
        .filter(([k]) => k !== 'files[upload_photo]')
        .map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${escHtml(maskValue(k, v))}</td></tr>`).join('');
      const kb = Math.round(prepared.blob.size / 1024);
      modal.innerHTML = `
        <div class="pr-modal-card">
          <div class="pr-modal-title">Dry run — resubmit ${escHtml(item.name || 'applicant')}'s full application?</div>
          <div class="pr-modal-warn">This posts the entire form back to dipi. Only the photo changes (${escHtml(correctionSummary(item))}, ${kb} KB). Every field below is preserved exactly as shown; after saving it is re-checked and any drift is flagged.</div>
          <div class="pr-modal-photo">📷 <b>files[upload_photo]</b> → new corrected JPEG (${prepared.filename})</div>
          <div class="pr-modal-tablewrap"><table class="pr-modal-table"><tr><th>field</th><th>value (sensitive fields masked)</th></tr>${rows}</table></div>
          <div class="pr-modal-actions">
            <button class="pr-btn pr-btn-gray" data-x="cancel">Cancel</button>
            <button class="pr-btn pr-btn-blue" data-x="commit">Commit upload to dipi</button>
          </div>
        </div>`;
      ov.appendChild(modal);
      const done = (val) => { modal.remove(); resolve(val); };
      modal.addEventListener('click', (e) => {
        if (e.target === modal) return done(false);
        const x = e.target.closest('[data-x]');
        if (!x) return;
        done(x.dataset.x === 'commit');
      });
    });
  }

  // After a successful upload dipi holds the corrected pixels, so the stored
  // geometry must never be applied again: a persisted 90° would double-rotate
  // the already-fixed photo on the next open, and a later batch upload would
  // write that double-rotated image back to dipi. Bake the correction into the
  // local bitmap as the new baseline (what dipi now serves), zero the geometry,
  // and persist the uploaded marker so the guard survives reloads.
  async function markUploaded(item) {
    if (item.bitmap) {
      try { item.bitmap = await createImageBitmap(correctedCanvas(item)); } catch (e) {}
    }
    item.rot = 0; item.crop = null; item.auto = false; item.suggestion = null;
    item.uploaded = true;
    item.uploadedAt = new Date().toISOString();
    saveCorrection(item);
  }

  function reportResult(item, res) {
    if (res.ok && res.stage === 'done') { toast('✓ Uploaded ' + item.name.split(' ')[0] + ' — all other fields preserved'); }
    else if (res.ok && res.warn) { alert('⚠ ' + item.name + ': ' + res.warn + '\n\nOpen their dipi edit page to double-check.'); }
    else { alert('✗ Upload failed for ' + item.name + ' (' + res.stage + '): ' + (res.error || 'unknown') + '\n\nNothing was saved.'); }
  }

  async function uploadSingle(item) {
    toast('Fetching ' + (item.name.split(' ')[0] || 'record') + '’s current form…');
    const prepared = await prepareUpload(item);
    if (!prepared.ok) { reportResult(item, prepared); return; }
    const go = await dryRunConfirm(item, prepared);
    if (!go) { toast('Cancelled — nothing sent'); return; }
    toast('Uploading…');
    const res = await commitUpload(item, prepared, { recheckStale: true });
    if (res.ok) await markUploaded(item);
    reportResult(item, res);
    updateCard(item);
    updatePills();
  }

  // Discard every locally saved correction (the whole store, all courses) and
  // clear the current grid's markers — rot/crop, ✓ done, ✨ auto, uploaded.
  // Local-only: nothing on dipi is touched.
  function resetLocal() {
    const stored = Object.keys(loadStore()).length;
    if (!confirm('Reset local photo cache?\n\nThis discards ALL locally saved corrections (' + stored + ' photo(s), across every course): rotations, crops, ✓ fixed marks, ✨ auto flags and uploaded markers — plus every stored face signature and duplicate flag from 👥 Duplicates.\n\nPhotos already uploaded to dipi are NOT affected. This cannot be undone.')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    // Face-dedup biometric data: wipe directly (facematch.js may not be loaded)
    try { localStorage.removeItem('faceDedup.flags'); } catch (e) {}
    try { indexedDB.deleteDatabase('vcall_faces'); } catch (e) {}
    state.items.forEach(it => {
      it.rot = 0; it.crop = null; it.done = false; it.auto = false;
      it.suggestion = null; it.uploaded = false; it.uploadedAt = null; it.dup = null;
      if (it.el) updateCard(it);
    });
    updatePills();
    toast('Local corrections cleared — photos shown as-is from dipi');
  }

  async function uploadAllFixed() {
    const fixed = state.items.filter(it => it.done && (it.rot !== 0 || it.crop) && it.aid && !it.uploaded);
    if (!fixed.length) { toast('No fixed, un-uploaded photos with an AID'); return; }
    if (!confirm('Upload ' + fixed.length + ' corrected photo(s) to dipi?\n\nEach does a full-form-preserving round-trip with verify. The batch STOPS at the first failure or field drift so you can inspect it.\n\nProceed?')) return;
    let okN = 0;
    for (const item of fixed) {
      toast('Uploading ' + (okN + 1) + '/' + fixed.length + ' — ' + item.name.split(' ')[0] + '…');
      const prepared = await prepareUpload(item);
      if (!prepared.ok) { alert('Batch stopped at ' + item.name + ': ' + prepared.error + '\n\n' + okN + ' uploaded so far.'); return; }
      const res = await commitUpload(item, prepared);
      if (res.ok) await markUploaded(item); // saved (even with drift) — never re-apply this geometry
      if (!res.ok || res.drift) {
        updateCard(item);
        alert('Batch stopped at ' + item.name + ':\n' + (res.error || res.warn) + '\n\n' + okN + ' uploaded successfully before this. Inspect this record on dipi before continuing.');
        return;
      }
      okN++;
      updateCard(item);
      await new Promise(r => setTimeout(r, 400));
    }
    toast('✓ Uploaded ' + okN + ' photo(s), all fields preserved');
  }

  // ── Overlay ──
  function ensureOverlay() {
    let ov = document.getElementById(OVERLAY_ID);
    if (ov) return ov;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} { position:fixed; inset:0; z-index:2147483646; background:#f1f5f9; overflow-y:auto;
        -webkit-overflow-scrolling:touch; color-scheme:light; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1e293b; }
      #${OVERLAY_ID} * { box-sizing:border-box; }
      #${OVERLAY_ID} .pr-header { background:linear-gradient(135deg,#1e293b,#334155); color:#fff; padding:12px 16px;
        position:sticky; top:0; z-index:5; box-shadow:0 2px 12px rgba(0,0,0,.15); display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
      #${OVERLAY_ID} .pr-title { font-size:15px; font-weight:700; margin-right:auto; }
      #${OVERLAY_ID} .pr-title .sub { display:block; font-size:11px; color:#94a3b8; font-weight:400; }
      #${OVERLAY_ID} .pr-btn { border:1px solid transparent; border-radius:8px; padding:7px 12px; font-size:12px; font-weight:600; cursor:pointer; }
      #${OVERLAY_ID} .pr-btn-blue { background:#3f65a7; color:#fff; }
      #${OVERLAY_ID} .pr-btn-indigo { background:rgba(148,163,184,.12); border-color:#475569; color:#cbd5e1; }
      #${OVERLAY_ID} .pr-btn-gray { background:rgba(148,163,184,.12); border-color:#475569; color:#cbd5e1; }
      #${OVERLAY_ID} .pr-btn-red { background:transparent; border-color:#5f4444; color:#cf8d8d; }
      #${OVERLAY_ID} .pr-btn-orange { background:transparent; border-color:#5f4444; color:#cf8d8d; }
      #${OVERLAY_ID} .pr-pills { display:flex; gap:6px; width:100%; overflow-x:auto; padding-top:6px; }
      #${OVERLAY_ID} .pr-pill { padding:4px 10px; border-radius:20px; border:none; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap; }
      #${OVERLAY_ID} .pr-pill.active { background:rgba(255,255,255,.18); color:#e8edf3; }
      #${OVERLAY_ID} .pr-pill:not(.active) { background:rgba(255,255,255,.06); color:#94a3b8; }
      #${OVERLAY_ID} .pr-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(${DISPLAY_W + 20}px,1fr)); gap:12px; padding:14px; }
      #${OVERLAY_ID} .pr-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.05); }
      #${OVERLAY_ID} .pr-card.sel { outline:2px solid #3f65a7; }
      #${OVERLAY_ID} .pr-card.done { opacity:.75; border-color:#86efac; }
      #${OVERLAY_ID} .pr-card.auto { border-color:#818cf8; box-shadow:0 0 0 2px #c7d2fe; }
      #${OVERLAY_ID} .pr-canvas-wrap { position:relative; background:#0f172a; display:flex; justify-content:center; min-height:120px; }
      #${OVERLAY_ID} canvas { display:block; max-width:100%; }
      #${OVERLAY_ID} .pr-canvas-wrap.cropping { cursor:crosshair; }
      #${OVERLAY_ID} .pr-cropbox { position:absolute; border:2px dashed #c9a94f; background:rgba(201,169,79,.15); pointer-events:none; }
      #${OVERLAY_ID} .pr-badge { position:absolute; top:6px; left:6px; background:#b9873d; color:#fff; font-size:10px; font-weight:700;
        padding:3px 8px; border-radius:6px; cursor:pointer; box-shadow:0 1px 4px rgba(0,0,0,.3); }
      #${OVERLAY_ID} .pr-badge.nf { background:#64748b; cursor:default; }
      #${OVERLAY_ID} .pr-badge.good { background:#3d8b62; cursor:default; }
      #${OVERLAY_ID} .pr-badge.auto { background:#5a63a8; }
      #${OVERLAY_ID} .pr-dup-badge { position:absolute; bottom:6px; left:6px; background:#8f3c50; color:#fff;
        font-size:10px; font-weight:700; padding:3px 7px; border-radius:6px; cursor:default; max-width:92%;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #${OVERLAY_ID} .pr-dup-badge.possible { background:rgba(143,60,80,.72); }
      #${OVERLAY_ID} .pr-meta { padding:8px 10px 2px; }
      #${OVERLAY_ID} .pr-name { font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #${OVERLAY_ID} .pr-sub { font-size:10px; color:#94a3b8; }
      #${OVERLAY_ID} .pr-controls { display:flex; gap:4px; padding:8px 10px 10px; flex-wrap:wrap; }
      #${OVERLAY_ID} .pr-c { flex:1; min-width:32px; border:1px solid #e2e8f0; background:#f8fafc; border-radius:7px;
        font-size:13px; padding:6px 0; cursor:pointer; text-align:center; }
      #${OVERLAY_ID} .pr-c:hover { background:#eef2f7; }
      #${OVERLAY_ID} .pr-c.on { background:#dcfce7; border-color:#86efac; }
      #${OVERLAY_ID} .pr-c-dipi { flex-basis:100%; font-size:12px; font-weight:600; color:#0f766e; }
      #${OVERLAY_ID} .pr-c-dipi:disabled { color:#cbd5e1; background:#f8fafc; cursor:not-allowed; }
      #${OVERLAY_ID} .pr-c-dipi.on { background:#ccfbf1; border-color:#5eead4; color:#0f766e; }
      #${OVERLAY_ID} .pr-btn-teal { background:#2e7d5b; color:#fff; }
      #${OVERLAY_ID} .pr-empty { text-align:center; color:#94a3b8; padding:48px 16px; grid-column:1/-1; }
      #${OVERLAY_ID} .pr-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#1e293b; color:#fff;
        padding:10px 20px; border-radius:10px; font-size:13px; z-index:2147483647; white-space:nowrap; }
      #${OVERLAY_ID} .pr-modal { position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:16px; }
      #${OVERLAY_ID} .pr-modal-card { background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 8px 40px rgba(0,0,0,.4); }
      #${OVERLAY_ID} .pr-modal-title { font-size:15px; font-weight:700; padding:16px 18px 6px; }
      #${OVERLAY_ID} .pr-modal-warn { font-size:12px; color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; margin:0 18px; padding:8px 10px; }
      #${OVERLAY_ID} .pr-modal-photo { font-size:12px; color:#0f766e; padding:8px 18px 4px; }
      #${OVERLAY_ID} .pr-modal-tablewrap { overflow:auto; margin:4px 18px; border:1px solid #e2e8f0; border-radius:8px; }
      #${OVERLAY_ID} .pr-modal-table { width:100%; border-collapse:collapse; font-size:11px; }
      #${OVERLAY_ID} .pr-modal-table th { text-align:left; background:#f1f5f9; padding:5px 8px; position:sticky; top:0; }
      #${OVERLAY_ID} .pr-modal-table td { padding:4px 8px; border-top:1px solid #f1f5f9; vertical-align:top; word-break:break-word; }
      #${OVERLAY_ID} .pr-modal-table td:first-child { color:#64748b; white-space:nowrap; font-family:ui-monospace,monospace; }
      #${OVERLAY_ID} .pr-modal-actions { display:flex; justify-content:flex-end; gap:8px; padding:12px 18px 16px; }
    `;
    document.head.appendChild(style);
    ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    document.body.appendChild(ov);
    return ov;
  }

  let toastTimer = null;
  function toast(msg) {
    const ov = document.getElementById(OVERLAY_ID);
    if (!ov) return;
    let t = ov.querySelector('.pr-toast');
    if (!t) { t = document.createElement('div'); t.className = 'pr-toast'; ov.appendChild(t); }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2200);
  }

  // ── Card rendering (imperative: canvases keep their bitmaps across updates) ──
  function drawCard(item) {
    const cv = item.el.querySelector('canvas');
    const ctx = cv.getContext('2d');
    if (!item.bitmap) {
      cv.width = DISPLAY_W; cv.height = Math.round(DISPLAY_W * 0.75);
      ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#475569'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(item.loadError ? 'load failed' : 'loading…', cv.width / 2, cv.height / 2);
      return;
    }
    const src = correctedCanvas(item);
    const scale = DISPLAY_W / src.width;
    cv.width = DISPLAY_W;
    cv.height = Math.max(1, Math.round(src.height * scale));
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    // ▦ Boxes: overlay what FaceDetector saw for the displayed rotation. Box
    // coords are normalized to the rotated (uncropped) frame, so skip when a
    // crop is active — they would no longer line up.
    if (state.showBoxes && item.dets && !item.crop) {
      const det = item.dets.find(d => d.rot === item.rot && d.box);
      if (det) {
        ctx.strokeStyle = '#c9a94f'; ctx.lineWidth = 2;
        ctx.strokeRect(det.box.x * cv.width, det.box.y * cv.height, det.box.w * cv.width, det.box.h * cv.height);
        ctx.fillStyle = '#c9a94f'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('face ' + (100 * (det.area || 0)).toFixed(1) + '%' + (det.faces > 1 ? ' (+' + (det.faces - 1) + ')' : ''),
          det.box.x * cv.width + 3, Math.max(12, det.box.y * cv.height - 5));
      }
      // Preview of the suggested passport crop (dashed green) so it can be judged
      // before clicking the badge. Crop coords are normalized to the suggested
      // rotation's frame, so only drawable when that matches what's displayed.
      const s = item.suggestion;
      if (s && s.crop && (s.rot === undefined || s.rot === item.rot)) {
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(s.crop.x * cv.width, s.crop.y * cv.height, s.crop.w * cv.width, s.crop.h * cv.height);
        ctx.setLineDash([]);
        ctx.fillStyle = '#4ade80'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('crop 260:280', s.crop.x * cv.width + 3,
          Math.min(cv.height - 5, (s.crop.y + s.crop.h) * cv.height - 5));
      }
    }
  }

  function updateCard(item) {
    const el = item.el;
    el.classList.toggle('done', !!item.done);
    el.classList.toggle('auto', !!item.auto && !item.done);
    // Badge is rebuilt each render so its click behaviour matches its mode:
    //   auto (needs confirm) → click reverts;  suggestion → click applies.
    const wrap = el.querySelector('.pr-canvas-wrap');
    el.querySelector('.pr-badge')?.remove();
    if (item.auto && !item.done) {
      const badge = document.createElement('div');
      badge.className = 'pr-badge auto';
      badge.textContent = '✨ auto' + (item.rot ? ' ↻' + item.rot + '°' : '') + (item.crop ? ' ✂' : '') + ' — ✓ keep / tap to revert';
      badge.title = 'Auto-fixed. Mark ✓ done to keep, or click this badge to revert to the original.';
      badge.addEventListener('click', () => revertAuto(item));
      wrap.appendChild(badge);
    } else {
      const s = item.suggestion;
      const wants = s && (s.rot !== undefined || s.crop) ? ('suggest' + (s.rot !== undefined ? ' ↻' + s.rot + '°' : '') + (s.crop ? ' ✂ zoom' : '')) :
                    (s && s.noFace ? 'no face found' : null);
      if (wants) {
        const badge = document.createElement('div');
        badge.className = 'pr-badge' + (s && s.noFace ? ' nf' : '');
        badge.textContent = wants;
        badge.title = detSummary(item); // per-rotation evidence behind the suggestion
        if (!(s && s.noFace)) badge.addEventListener('click', () => applySuggestion(item));
        wrap.appendChild(badge);
      } else if (item.dets && !item.done) {
        // scanned, nothing to fix, face well-sized → positive confirmation badge
        const det = item.dets.find(d => d.rot === item.rot && d.box);
        if (det && det.area >= GOOD_MIN && det.area <= GOOD_MAX) {
          const badge = document.createElement('div');
          badge.className = 'pr-badge good';
          badge.textContent = '✓ good ' + (100 * det.area).toFixed(0) + '%';
          badge.title = detSummary(item);
          wrap.appendChild(badge);
        }
      }
    }
    // Duplicate-face badge (bottom-left, independent of the correction badge).
    // Rebuilt each render; set by 👥 Duplicates, cleared on the next run.
    el.querySelector('.pr-dup-badge')?.remove();
    if (item.dup) {
      const b = document.createElement('div');
      b.className = 'pr-dup-badge' + (item.dup.tier === 'possible' ? ' possible' : '');
      b.textContent = '👥 ' + (item.dup.withinCourse ? 'dup in course: ' : '') + item.dup.otherName +
        (item.dup.withinCourse ? '' : ' @ ' + item.dup.otherCourse);
      b.title = 'Face matches ' + item.dup.otherName +
        (item.dup.withinCourse ? ' in this same course' : ' in course ' + item.dup.otherCourse) +
        ' — distance ' + item.dup.dist + ' (' + item.dup.tier + '). A lead, not proof: verify ID documents before acting.';
      wrap.appendChild(b);
    }
    el.querySelector('[data-act="done"]').classList.toggle('on', !!item.done);
    el.querySelector('[data-act="crop"]').classList.toggle('on', !!item.crop);
    const dipiBtn = el.querySelector('[data-act="dipi"]');
    if (dipiBtn) {
      const hasCorrection = (item.rot !== 0 || !!item.crop);
      dipiBtn.disabled = !hasCorrection || !item.aid || !!item.uploaded;
      dipiBtn.classList.toggle('on', !!item.uploaded);
      dipiBtn.textContent = item.uploaded ? '✓dipi' : '⬆dipi';
      dipiBtn.title = !item.aid ? 'No application id — cannot upload'
        : item.uploaded ? 'Already uploaded — rotate/crop again to enable a new upload'
        : !hasCorrection ? 'Rotate or crop first'
        : 'Upload corrected photo to dipi (full-form-preserving, with dry-run)';
    }
    drawCard(item);
  }

  function applySuggestion(item) {
    const s = item.suggestion;
    if (!s || (s.rot === undefined && !s.crop)) return;
    if (s.rot !== undefined) item.rot = s.rot;
    if (s.crop) item.crop = s.crop;
    item.suggestion = null;
    item.auto = false; // user chose it by hand
    item.uploaded = false; // a new correction re-arms ⬆dipi
    saveCorrection(item);
    updateCard(item);
    updatePills();
    toast('Applied suggestion for ' + item.name.split(' ')[0]);
  }

  // Undo an auto-applied fix, back to the untouched original.
  function revertAuto(item) {
    item.rot = 0;
    item.crop = null;
    item.auto = false;
    item.suggestion = null;
    saveCorrection(item);
    updateCard(item);
    updatePills();
    toast('Reverted ' + item.name.split(' ')[0] + ' to original');
  }

  function rotate(item, delta) {
    item.rot = ((item.rot + delta) % 360 + 360) % 360;
    item.crop = null; // crop coords are post-rotation; a new rotation invalidates them
    item.auto = false; // manual edit takes over from an auto fix
    item.uploaded = false; // a new correction re-arms ⬆dipi (baseline is the uploaded photo)
    saveCorrection(item);
    updateCard(item);
  }

  async function download(item) {
    if (!item.bitmap) { toast('Photo not loaded yet'); return; }
    const c = correctedCanvas(item);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) { toast('Export failed'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeName = (item.name || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    a.download = (item.aid || item.photoId) + (safeName ? '_' + safeName : '') + '.jpg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ── Crop drag ──
  function armCrop(item) {
    const wrap = item.el.querySelector('.pr-canvas-wrap');
    if (wrap.classList.contains('cropping')) { disarmCrop(item); return; }
    wrap.classList.add('cropping');
    const cv = item.el.querySelector('canvas');
    let start = null, box = null;
    const toNorm = (ev) => {
      const r = cv.getBoundingClientRect();
      return { x: Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1), y: Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 1) };
    };
    const onDown = (ev) => {
      start = toNorm(ev);
      box = document.createElement('div');
      box.className = 'pr-cropbox';
      wrap.appendChild(box);
      ev.preventDefault();
    };
    const onMove = (ev) => {
      if (!start || !box) return;
      const p = toNorm(ev);
      const r = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
      const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      box.style.left = (r.left - wr.left + x * r.width) + 'px';
      box.style.top = (r.top - wr.top + y * r.height) + 'px';
      box.style.width = (w * r.width) + 'px';
      box.style.height = (h * r.height) + 'px';
    };
    const onUp = (ev) => {
      if (!start) return;
      const p = toNorm(ev);
      const crop = clampCrop({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
      disarmCrop(item);
      if (crop && crop.w > 0.06 && crop.h > 0.06) {
        // crop is relative to the currently displayed (already-cropped) view; compose with existing crop
        const prev = item.crop;
        item.crop = prev
          ? clampCrop({ x: prev.x + crop.x * prev.w, y: prev.y + crop.y * prev.h, w: crop.w * prev.w, h: crop.h * prev.h })
          : crop;
        item.auto = false; // manual crop takes over from an auto fix
        item.uploaded = false; // a new correction re-arms ⬆dipi
        saveCorrection(item);
        updateCard(item);
      }
    };
    const onKey = (ev) => { if (ev.key === 'Escape') disarmCrop(item); };
    item._cropHandlers = { onDown, onMove, onUp, onKey };
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey);
    toast('Drag on the photo to crop (Esc to cancel, ✂ again to clear)');
  }
  function disarmCrop(item) {
    const wrap = item.el.querySelector('.pr-canvas-wrap');
    wrap.classList.remove('cropping');
    wrap.querySelector('.pr-cropbox')?.remove();
    const h = item._cropHandlers;
    if (h) {
      wrap.removeEventListener('pointerdown', h.onDown);
      wrap.removeEventListener('pointermove', h.onMove);
      wrap.removeEventListener('pointerup', h.onUp);
      document.removeEventListener('keydown', h.onKey);
      item._cropHandlers = null;
    }
  }

  function makeCard(item, idx) {
    const el = document.createElement('div');
    el.className = 'pr-card';
    el.dataset.idx = String(idx);
    el.innerHTML = `
      <div class="pr-canvas-wrap"><canvas></canvas></div>
      <div class="pr-meta">
        <div class="pr-name">${escHtml(item.name)}</div>
        <div class="pr-sub">${escHtml([item.confno, item.status].filter(Boolean).join(' · ')) || '&nbsp;'}</div>
      </div>
      <div class="pr-controls">
        <button class="pr-c" data-act="ccw" title="Rotate 90° counter-clockwise">↺</button>
        <button class="pr-c" data-act="cw" title="Rotate 90° clockwise (r)">↻</button>
        <button class="pr-c" data-act="flip" title="Rotate 180°">180°</button>
        <button class="pr-c" data-act="crop" title="Drag-crop; click again to clear">✂</button>
        <button class="pr-c" data-act="done" title="Mark reviewed (d)">✓</button>
        <button class="pr-c" data-act="dl" title="Download corrected JPEG (s)">⬇</button>
        <button class="pr-c pr-c-dipi" data-act="dipi" title="Upload corrected photo to dipi">⬆dipi</button>
      </div>`;
    el.addEventListener('click', (e) => {
      selectCard(idx);
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'ccw') rotate(item, -90);
      else if (act === 'cw') rotate(item, 90);
      else if (act === 'flip') rotate(item, 180);
      else if (act === 'crop') {
        if (item.crop) { item.crop = null; item.auto = false; saveCorrection(item); updateCard(item); }
        else armCrop(item);
      }
      else if (act === 'done') { item.done = !item.done; saveCorrection(item); updateCard(item); updatePills(); }
      else if (act === 'dl') download(item);
      else if (act === 'dipi') { if (!btn.disabled) uploadSingle(item); }
    });
    item.el = el;
    return el;
  }

  function selectCard(idx) {
    state.sel = idx;
    state.items.forEach((it, i) => it.el && it.el.classList.toggle('sel', i === idx));
  }

  function updatePills() {
    const ov = document.getElementById(OVERLAY_ID);
    if (!ov) return;
    const c = counts();
    ov.querySelectorAll('.pr-pill').forEach(p => {
      const f = p.dataset.f;
      p.classList.toggle('active', state.filter === f);
      p.textContent = { all: 'All ' + c.all, suggested: '⚠ Suggested ' + c.suggested, autofixed: '✨ Auto-fixed ' + c.autofixed, fixed: '✓ Fixed ' + c.fixed, unreviewed: '⏳ Unreviewed ' + c.unreviewed }[f];
    });
    state.items.forEach(it => { if (it.el) it.el.style.display = visible(it) ? '' : 'none'; });
  }

  // ── Lazy image loading ──
  async function loadBitmap(item) {
    if (item.bitmap || item.loading) return;
    item.loading = true;
    try {
      const resp = await fetch(item.url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      item.bitmap = await createImageBitmap(blob);
    } catch (e) {
      item.loadError = true;
    }
    item.loading = false;
    updateCard(item);
  }

  // ── Auto-scan all loaded photos ──
  async function autoScan() {
    if (state.scanning) return;
    state.scanning = true;
    if (!mpDetector && !mpTried) toast('Loading on-device face model (~3 MB, one-time)…');
    if (!(await getMpDetector()) && !hasFaceDetector) {
      toast('No face detection available — model CDN unreachable and no native FaceDetector. Manual review only.');
      state.scanning = false; return;
    }
    const btn = document.getElementById('pr-scan');
    let n = 0;
    for (const item of state.items) {
      if (item.done) continue;
      if (!item.bitmap && !item.loadError) await loadBitmap(item);
      if (!item.bitmap) continue;
      if (btn) btn.textContent = '⚡ Scanning ' + (++n) + '/' + state.items.length + '…';
      item.suggestion = await suggestFor(item);
      updateCard(item);
    }
    if (btn) btn.textContent = '⚡ Auto-scan';
    state.scanning = false;
    updatePills();
    const c = counts();
    toast('Scan done — ' + c.suggested + ' photo(s) look wrong');
  }

  // ── 👥 Duplicates: face-embedding match against stored courses ──
  // Descriptors + matching live in the sibling facematch.js (lazy-loaded);
  // everything runs on-device and the biometric data stays in this browser.
  function loadFaceMatch() {
    if (window.FaceMatch) return Promise.resolve(true);
    if (!PR_SELF) return Promise.resolve(false);
    return new Promise((res) => {
      const s = document.createElement('script');
      s.src = new URL('facematch.js', PR_SELF).href + '?v=' + Date.now();
      s.onload = () => res(!!window.FaceMatch);
      s.onerror = () => res(false);
      document.head.appendChild(s);
    });
  }

  function dedupCourseKey() {
    const m = location.pathname.match(/\/search-course\/(\d+)\/(\d+)/);
    return m ? m[1] + '/' + m[2] : location.pathname; // "63/66893" — same shape as the audit's courseKey
  }

  async function findDuplicates() {
    if (state.scanning) return;
    state.scanning = true;
    const btn = document.getElementById('pr-dedup');
    const setLbl = (t) => { if (btn) btn.textContent = t; };
    try {
      if (!(await loadFaceMatch())) { toast('Face-match module failed to load'); return; }
      setLbl('👥 Loading model…');
      if (!(await window.FaceMatch.load())) { toast('Face-recognition model failed to load (vendor assets unreachable)'); return; }
      const ck = dedupCourseKey();
      // Descriptors need pixels: load every photo, embed the corrected
      // (upright) image so sideways photos still match.
      const entries = [];
      let n = 0;
      for (const item of state.items) {
        setLbl('👥 Photos ' + (++n) + '/' + state.items.length + '…');
        if (!item.bitmap && !item.loadError) await loadBitmap(item);
        if (!item.bitmap || !item.aid) continue;
        entries.push({ aid: item.aid, name: item.name, canvas: correctedCanvas(item) });
      }
      const { indexed, noFace } = await window.FaceMatch.indexCourse(ck, entries,
        (i, total) => setLbl('👥 Faces ' + i + '/' + total + '…'));
      const matches = await window.FaceMatch.findMatches(ck);
      window.FaceMatch.saveFlags(ck, matches); // surfaced by the course-audit panel too
      // Badge matched cards — best (closest) match per card, both sides of
      // a within-course pair.
      state.items.forEach(it => { it.dup = null; });
      matches.forEach(m => {
        const mine = state.items.find(x => x.aid === m.aid);
        if (mine && (!mine.dup || m.dist < mine.dup.dist)) mine.dup = m;
        if (m.withinCourse) {
          const other = state.items.find(x => x.aid === m.otherAid);
          if (other && (!other.dup || m.dist < other.dup.dist)) {
            other.dup = { ...m, aid: m.otherAid, name: m.otherName, otherAid: m.aid, otherName: m.name };
          }
        }
      });
      state.items.forEach(it => { if (it.el) updateCard(it); });
      const stats = await window.FaceMatch.indexStats();
      if (matches.length) showDupSummary(matches, stats);
      else toast('No matching faces — indexed ' + indexed + ' face(s)' +
        (noFace ? ' (' + noFace + ' had no detectable face)' : '') +
        ', compared across ' + stats.courses + ' stored course(s)');
    } finally {
      setLbl('👥 Duplicates');
      state.scanning = false;
    }
  }

  function showDupSummary(matches, stats) {
    const ov = document.getElementById(OVERLAY_ID);
    const modal = document.createElement('div');
    modal.className = 'pr-modal';
    const rows = matches.map(m => `<tr>
      <td>${escHtml(m.name)}</td>
      <td>${escHtml(m.otherName)}</td>
      <td>${m.withinCourse ? 'this course' : escHtml(m.otherCourse)}</td>
      <td>${m.dist} · ${m.tier === 'strong' ? '🔴 strong' : '🟠 possible'}</td>
    </tr>`).join('');
    modal.innerHTML = `
      <div class="pr-modal-card">
        <div class="pr-modal-title">👥 ${matches.length} face match(es) across ${stats.courses} stored course(s)</div>
        <div class="pr-modal-warn">Face similarity is a lead, not proof — matches can be siblings, twins, or photo quirks. Verify against ID documents before acting. These flags also appear in the course-audit panel (Cross-course). All processing stayed in this browser.</div>
        <div class="pr-modal-tablewrap"><table class="pr-modal-table"><tr><th>this course</th><th>matches</th><th>where</th><th>distance</th></tr>${rows}</table></div>
        <div class="pr-modal-actions"><button class="pr-btn pr-btn-gray" data-x="close">Close</button></div>
      </div>`;
    ov.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-x]')) modal.remove();
    });
  }

  // ── Auto-fix: apply high-confidence corrections; suggest the rest ──
  // Only writes local corrections and never marks a card done — every auto fix
  // still needs a human ✓ (or a revert). Nothing is uploaded to dipi here.
  async function autoFix() {
    if (state.scanning) return;
    state.scanning = true;
    if (!mpDetector && !mpTried) toast('Loading on-device face model (~3 MB, one-time)…');
    if (!(await getMpDetector()) && !hasFaceDetector) {
      toast('No face detection available — model CDN unreachable and no native FaceDetector. Manual review only.');
      state.scanning = false; return;
    }
    const btn = document.getElementById('pr-autofix');
    let n = 0, fixed = 0, suggested = 0, manual = 0;
    for (const item of state.items) {
      if (item.done) continue;
      if (!item.bitmap && !item.loadError) await loadBitmap(item);
      if (!item.bitmap) continue;
      if (btn) btn.textContent = '✨ Fixing ' + (++n) + '/' + state.items.length + '…';
      const s = await suggestFor(item);
      item.suggestion = s;
      if (s && s.auto && (s.auto.rot || s.auto.crop)) {
        if (s.auto.rot && s.rot !== undefined) item.rot = s.rot;
        if (s.auto.crop && s.crop) item.crop = s.crop;
        item.auto = true;
        item.suggestion = null; // consumed into a needs-confirm correction
        saveCorrection(item);
        fixed++;
      } else if (s && (s.rot !== undefined || s.crop)) {
        suggested++;
      } else if (s && s.noFace) {
        manual++;
      }
      updateCard(item);
    }
    if (btn) btn.textContent = '✨ Auto-fix';
    state.scanning = false;
    updatePills();
    toast('Auto-fixed ' + fixed + ' · ' + suggested + ' suggested · ' + manual + ' need a manual look');
  }

  function onKeyNav(e) {
    if (!document.getElementById(OVERLAY_ID)) return;
    if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
    const vis = state.items.map((it, i) => ({ it, i })).filter(x => visible(x.it));
    if (!vis.length) return;
    const pos = vis.findIndex(x => x.i === state.sel);
    if (e.key === 'ArrowRight') { selectCard(vis[Math.min(pos + 1, vis.length - 1)]?.i ?? vis[0].i); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { selectCard(vis[Math.max(pos - 1, 0)]?.i ?? vis[0].i); e.preventDefault(); }
    else if (state.sel >= 0) {
      const item = state.items[state.sel];
      if (!item) return;
      if (e.key === 'r') rotate(item, 90);
      else if (e.key === 'd') { item.done = !item.done; saveCorrection(item); updateCard(item); updatePills(); }
      else if (e.key === 's') download(item);
    }
    const selEl = state.items[state.sel]?.el;
    if (selEl && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) selEl.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    state.items.forEach(it => { it.el = null; it.bitmap = null; });
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.removeEventListener('keydown', onKeyNav);
  }

  function open() {
    let rows;
    try { rows = extractRows(); }
    catch (e) { alert('Photo Review: ' + e.message); return; }

    const store = loadStore();
    state.items = rows
      .map(r => {
        const photoId = photoIdFromUrl(r.photo);
        if (!photoId) return null;
        const prev = store[photoId] || {};
        return {
          photoId, url: r.photo,
          name: cleanName(r.name), aid: r.aid || '', confno: r.confno || '',
          status: r.app_status || '',
          rot: prev.rot || 0, crop: prev.crop || null, done: !!prev.done, auto: !!prev.auto,
          uploaded: !!prev.uploaded, uploadedAt: prev.uploadedAt || null,
          bitmap: null, suggestion: null, el: null,
        };
      })
      .filter(Boolean);
    state.filter = 'all';
    state.sel = -1;

    const ov = ensureOverlay();
    const courseKey = (location.pathname.match(/\/search-course\/(\d+)\/(\d+)/) || [])[0] || location.pathname;
    ov.innerHTML = `
      <div class="pr-header">
        <div class="pr-title">📷 Photo Review
          <span class="sub">${escHtml(courseKey)} · ${state.items.length} photo(s) · corrections are local until you upload to dipi</span>
        </div>
        <button class="pr-btn pr-btn-blue" id="pr-scan">⚡ Auto-scan</button>
        <button class="pr-btn pr-btn-indigo" id="pr-autofix" title="Apply high-confidence rotation/crop fixes; each still needs your ✓">✨ Auto-fix</button>
        <button class="pr-btn pr-btn-gray" id="pr-boxes" title="Overlay the detected face box + area % on each photo (run Auto-scan first)">▦ Boxes</button>
        <button class="pr-btn pr-btn-gray" id="pr-dedup" title="Match faces against other scanned courses to flag possible duplicate applications. Fully on-device; face signatures stay in this browser (last 12 courses, wiped by ♻ Reset local).">👥 Duplicates</button>
        <button class="pr-btn pr-btn-indigo" id="pr-ok-auto" title="Consent to every modification made so far (auto + manual): all corrected photos are marked ✓ fixed, ready for ⬆ Upload fixed to dipi">✓ Accept all fixes</button>
        <button class="pr-btn pr-btn-gray" id="pr-dl-all">⬇ Download fixed</button>
        <button class="pr-btn pr-btn-teal" id="pr-up-all">⬆ Upload fixed to dipi</button>
        <button class="pr-btn pr-btn-orange" id="pr-reset" title="Discard all locally saved corrections and markers (dipi untouched)">♻ Reset local</button>
        <button class="pr-btn pr-btn-red" id="pr-close">✕ Close</button>
        <div class="pr-pills">
          <button class="pr-pill" data-f="all"></button>
          <button class="pr-pill" data-f="suggested"></button>
          <button class="pr-pill" data-f="autofixed"></button>
          <button class="pr-pill" data-f="fixed"></button>
          <button class="pr-pill" data-f="unreviewed"></button>
        </div>
      </div>
      <div class="pr-grid">${state.items.length ? '' : '<div class="pr-empty">No photos in this course’s rows</div>'}</div>`;

    const grid = ov.querySelector('.pr-grid');
    state.items.forEach((item, i) => grid.appendChild(makeCard(item, i)));
    state.items.forEach(it => drawCard(it));

    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const item = state.items[parseInt(en.target.dataset.idx, 10)];
          if (item) loadBitmap(item);
          io.unobserve(en.target);
        }
      });
    }, { root: ov, rootMargin: '400px' });
    state.items.forEach(it => io.observe(it.el));

    ov.querySelector('#pr-close').addEventListener('click', close);
    ov.querySelector('#pr-scan')?.addEventListener('click', autoScan);
    ov.querySelector('#pr-autofix')?.addEventListener('click', autoFix);
    ov.querySelector('#pr-dedup')?.addEventListener('click', findDuplicates);
    ov.querySelector('#pr-boxes')?.addEventListener('click', () => {
      state.showBoxes = !state.showBoxes;
      ov.querySelector('#pr-boxes').textContent = state.showBoxes ? '▦ Boxes ON' : '▦ Boxes';
      state.items.forEach(it => { if (it.bitmap && it.el) drawCard(it); });
      if (state.showBoxes && !state.items.some(it => it.dets)) toast('Run ⚡ Auto-scan first — boxes come from the scan');
    });
    // Bulk-consent: every modification made so far (✨ auto-fixes, applied
    // suggestions, manual rotates/crops) is accepted and marked ✓ fixed, making
    // it eligible for ⬆ Upload fixed to dipi as the next step. Deliberately NOT
    // automatic — this is one click after a human look, not a bypass of it.
    // Local done flags only; nothing is uploaded here.
    ov.querySelector('#pr-ok-auto')?.addEventListener('click', () => {
      const batch = state.items.filter(it => !it.done && (it.rot !== 0 || it.crop));
      if (!batch.length) { toast('No corrected photos awaiting acceptance'); return; }
      const autos = batch.filter(it => it.auto).length;
      if (!confirm('Accept all ' + batch.length + ' modified photo(s) as ✓ fixed?' +
        (autos ? '\n(' + autos + ' of them are ✨ auto-fixes — look them over via the ✨ filter first.)' : '') +
        '\n\nThey become eligible for "⬆ Upload fixed to dipi" as the next step. Nothing is uploaded yet.')) return;
      batch.forEach(it => { it.done = true; saveCorrection(it); updateCard(it); });
      updatePills();
      toast('✓ Accepted ' + batch.length + ' fix(es) — ready for ⬆ Upload fixed to dipi');
    });
    ov.querySelector('#pr-dl-all').addEventListener('click', async () => {
      const fixed = state.items.filter(it => it.done && (it.rot !== 0 || it.crop));
      if (!fixed.length) { toast('No fixed photos yet — mark corrections ✓ done first'); return; }
      toast('Downloading ' + fixed.length + ' photo(s)… allow multiple downloads if asked');
      for (const it of fixed) {
        if (!it.bitmap) await loadBitmap(it);
        if (it.bitmap) await download(it);
        await new Promise(r => setTimeout(r, 350));
      }
    });
    ov.querySelector('#pr-up-all').addEventListener('click', uploadAllFixed);
    ov.querySelector('#pr-reset').addEventListener('click', resetLocal);
    ov.querySelectorAll('.pr-pill').forEach(p => p.addEventListener('click', () => { state.filter = p.dataset.f; updatePills(); }));
    document.addEventListener('keydown', onKeyNav);
    updatePills();
  }

  window.DipiPhotoReview = {
    open, close,
    _internal: {
      rotatedDims, clampCrop, passportCrop, pruneCorrections, photoIdFromUrl, escHtml,
      landmarkOrientationUpright, keypointsUpright, cropIsSafe, classifyDetections,
      controlToEntries, diffEntries, maskValue, buildUploadBody, uploadFilename,
    },
  };

  open();
})();
