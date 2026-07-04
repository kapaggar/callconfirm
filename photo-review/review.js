// photo-review/review.js — applicant photo review overlay for dipi.vridhamma.org
// Rotate / crop applicant photos that were uploaded sideways, upside down, or
// zoomed out. Local-only: corrections live in localStorage (geometry, no pixels),
// corrected JPEGs are exported via download. Nothing is written to dipi.
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
  const SCAN_W = 320;      // downscale for face detection
  const TINY_FACE = 0.04;  // face area below this fraction => suggest crop
  const CROP_EXPAND = 2.6; // face box expansion factor for suggested crop
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
  // Expand a normalized face box into a crop suggestion (slightly taller than wide,
  // biased upward so the crop includes hair/forehead rather than chest)
  function expandFaceBox(box, factor) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const w = box.w * factor;
    const h = box.h * factor * 1.15;
    return clampCrop({ x: cx - w / 2, y: cy - h / 2 - h * 0.06, w, h });
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
    if (landmarkWins.length) {
      best = landmarkWins[0];
      // one upright orientation = confident; several = only if one dominates on area
      confidence = (landmarkWins.length === 1 ||
        best.area > (landmarkWins[1].area || 0) * dom) ? 'high' : 'medium';
      landmarkConfirmed = confidence === 'high';
    } else if (!anyLandmarkInfo) {
      // No landmark data anywhere (Chrome/macOS returns boxes but no eyes/nose/mouth):
      // fall back to area — the correct orientation usually detects a clearly bigger
      // face. High confidence when a single rotation dominates the others.
      const sorted = withFace.slice().sort(byArea);
      best = sorted[0];
      confidence = (sorted.length === 1 || best.area > (sorted[1].area || 0) * dom) ? 'high' : 'medium';
    } else {
      // landmarks existed but none confirmed upright → ambiguous, suggest only
      best = withFace.slice().sort(byArea)[0];
      confidence = 'medium';
    }

    const out = { confidence, auto: { rot: false, crop: false } };
    if (best.rot) out.rot = best.rot;
    if (best.box && (best.area || 0) < tiny) out.crop = expandFaceBox(best.box, CROP_EXPAND);
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
  async function commitUpload(item, prepared) {
    try {
      const body = buildUploadBody(prepared.entries, prepared.blob, prepared.filename);
      const postResp = await fetch(editUrlFor(item.aid), { method: 'POST', credentials: 'same-origin', body });
      const landedOnEdit = /\/app\/\d+\/edit/.test(postResp.url);
      if (!postResp.ok || landedOnEdit) {
        // Drupal re-renders the form (200, still on /edit) on validation failure — NOT saved.
        return { ok: false, stage: 'submit', error: landedOnEdit ? 'form rejected (validation error) — nothing saved' : 'HTTP ' + postResp.status };
      }
      const verifyResp = await fetch(editUrlFor(item.aid), { credentials: 'same-origin' });
      if (!verifyResp.ok) return { ok: true, stage: 'verify', warn: 'saved, but could not re-fetch to verify (HTTP ' + verifyResp.status + ')' };
      const after = parseEditForm(await verifyResp.text());
      const drift = diffEntries(prepared.entries, after.entries, VERIFY_IGNORE);
      if (drift.length) return { ok: true, stage: 'verify', drift, warn: 'saved, but these fields changed: ' + drift.join(', ') };
      return { ok: true, stage: 'done' };
    } catch (e) {
      return { ok: false, stage: 'exception', error: e.message };
    }
  }

  // ── Face detection auto-suggest (Chrome only; on-device) ──
  const hasFaceDetector = ('FaceDetector' in window);
  async function suggestFor(item) {
    if (!hasFaceDetector || !item.bitmap) return null;
    // fastMode:false yields landmarks (eyes/nose/mouth) so we can tell upright from
    // upside-down; maxDetectedFaces:2 lets us spot group/ID-duplicate shots (no auto-crop).
    const fd = new window.FaceDetector({ maxDetectedFaces: 2, fastMode: false });
    const dets = [];
    for (const rot of [0, 90, 270, 180]) {
      const [rw, rh] = rotatedDims(item.bitmap.width, item.bitmap.height, rot);
      const scale = Math.min(1, SCAN_W / rw);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(rw * scale));
      c.height = Math.max(1, Math.round(rh * scale));
      drawRotated(c.getContext('2d'), item.bitmap, rot, c.width, c.height);
      let faces = [];
      try { faces = await fd.detect(c); } catch (e) { return null; }
      if (!faces.length) { dets.push({ rot, faces: 0 }); continue; }
      faces.sort((a, b) => (b.boundingBox.width * b.boundingBox.height) - (a.boundingBox.width * a.boundingBox.height));
      const b = faces[0].boundingBox;
      dets.push({
        rot, faces: faces.length,
        area: (b.width * b.height) / (c.width * c.height),
        box: { x: b.x / c.width, y: b.y / c.height, w: b.width / c.width, h: b.height / c.height },
        landmarksOk: landmarkOrientationUpright(faces[0].landmarks),
      });
    }
    return classifyDetections(dets, { tinyFace: TINY_FACE });
  }

  // ── State ──
  const state = { items: [], filter: 'all', sel: -1, scanning: false };

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

  function reportResult(item, res) {
    if (res.ok && res.stage === 'done') { item.uploaded = true; toast('✓ Uploaded ' + item.name.split(' ')[0] + ' — all other fields preserved'); }
    else if (res.ok && res.warn) { item.uploaded = true; alert('⚠ ' + item.name + ': ' + res.warn + '\n\nOpen their dipi edit page to double-check.'); }
    else { alert('✗ Upload failed for ' + item.name + ' (' + res.stage + '): ' + (res.error || 'unknown') + '\n\nNothing was saved.'); }
  }

  async function uploadSingle(item) {
    toast('Fetching ' + (item.name.split(' ')[0] || 'record') + '’s current form…');
    const prepared = await prepareUpload(item);
    if (!prepared.ok) { reportResult(item, prepared); return; }
    const go = await dryRunConfirm(item, prepared);
    if (!go) { toast('Cancelled — nothing sent'); return; }
    toast('Uploading…');
    const res = await commitUpload(item, prepared);
    reportResult(item, res);
    updateCard(item);
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
      if (!res.ok || res.drift) {
        updateCard(item);
        alert('Batch stopped at ' + item.name + ':\n' + (res.error || res.warn) + '\n\n' + okN + ' uploaded successfully before this. Inspect this record on dipi before continuing.');
        return;
      }
      item.uploaded = true; okN++;
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
      #${OVERLAY_ID} .pr-btn { border:none; border-radius:8px; padding:7px 12px; font-size:12px; font-weight:600; cursor:pointer; }
      #${OVERLAY_ID} .pr-btn-blue { background:#3b82f6; color:#fff; }
      #${OVERLAY_ID} .pr-btn-indigo { background:#6366f1; color:#fff; }
      #${OVERLAY_ID} .pr-btn-gray { background:#475569; color:#fff; }
      #${OVERLAY_ID} .pr-btn-red { background:#dc2626; color:#fff; }
      #${OVERLAY_ID} .pr-pills { display:flex; gap:6px; width:100%; overflow-x:auto; padding-top:6px; }
      #${OVERLAY_ID} .pr-pill { padding:4px 10px; border-radius:20px; border:none; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap; }
      #${OVERLAY_ID} .pr-pill.active { background:#fff; color:#1e293b; }
      #${OVERLAY_ID} .pr-pill:not(.active) { background:rgba(255,255,255,.1); color:#94a3b8; }
      #${OVERLAY_ID} .pr-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(${DISPLAY_W + 20}px,1fr)); gap:12px; padding:14px; }
      #${OVERLAY_ID} .pr-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.05); }
      #${OVERLAY_ID} .pr-card.sel { outline:3px solid #3b82f6; }
      #${OVERLAY_ID} .pr-card.done { opacity:.75; border-color:#86efac; }
      #${OVERLAY_ID} .pr-card.auto { border-color:#818cf8; box-shadow:0 0 0 2px #c7d2fe; }
      #${OVERLAY_ID} .pr-canvas-wrap { position:relative; background:#0f172a; display:flex; justify-content:center; min-height:120px; }
      #${OVERLAY_ID} canvas { display:block; max-width:100%; }
      #${OVERLAY_ID} .pr-canvas-wrap.cropping { cursor:crosshair; }
      #${OVERLAY_ID} .pr-cropbox { position:absolute; border:2px dashed #fbbf24; background:rgba(251,191,36,.15); pointer-events:none; }
      #${OVERLAY_ID} .pr-badge { position:absolute; top:6px; left:6px; background:#f59e0b; color:#fff; font-size:10px; font-weight:700;
        padding:3px 8px; border-radius:6px; cursor:pointer; box-shadow:0 1px 4px rgba(0,0,0,.3); }
      #${OVERLAY_ID} .pr-badge.nf { background:#64748b; cursor:default; }
      #${OVERLAY_ID} .pr-badge.auto { background:#6366f1; }
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
      #${OVERLAY_ID} .pr-btn-teal { background:#0d9488; color:#fff; }
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
        if (!(s && s.noFace)) badge.addEventListener('click', () => applySuggestion(item));
        wrap.appendChild(badge);
      }
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
        : item.uploaded ? 'Already uploaded this session'
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
    if (!hasFaceDetector) { toast('FaceDetector not available in this browser — manual review only'); return; }
    if (state.scanning) return;
    state.scanning = true;
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

  // ── Auto-fix: apply high-confidence corrections; suggest the rest ──
  // Only writes local corrections and never marks a card done — every auto fix
  // still needs a human ✓ (or a revert). Nothing is uploaded to dipi here.
  async function autoFix() {
    if (!hasFaceDetector) { toast('FaceDetector not available in this browser — manual review only'); return; }
    if (state.scanning) return;
    state.scanning = true;
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
          bitmap: null, suggestion: null, el: null, uploaded: false,
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
        ${hasFaceDetector ? '<button class="pr-btn pr-btn-blue" id="pr-scan">⚡ Auto-scan</button>' : ''}
        ${hasFaceDetector ? '<button class="pr-btn pr-btn-indigo" id="pr-autofix" title="Apply high-confidence rotation/crop fixes; each still needs your ✓">✨ Auto-fix</button>' : ''}
        <button class="pr-btn pr-btn-gray" id="pr-dl-all">⬇ Download fixed</button>
        <button class="pr-btn pr-btn-teal" id="pr-up-all">⬆ Upload fixed to dipi</button>
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
    ov.querySelectorAll('.pr-pill').forEach(p => p.addEventListener('click', () => { state.filter = p.dataset.f; updatePills(); }));
    document.addEventListener('keydown', onKeyNav);
    updatePills();
  }

  window.DipiPhotoReview = {
    open, close,
    _internal: {
      rotatedDims, clampCrop, expandFaceBox, pruneCorrections, photoIdFromUrl, escHtml,
      landmarkOrientationUpright, cropIsSafe, classifyDetections,
      controlToEntries, diffEntries, maskValue, buildUploadBody, uploadFilename,
    },
  };

  open();
})();
