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
      rot: item.rot, crop: item.crop || null, done: !!item.done,
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

  // ── Face detection auto-suggest (Chrome only; on-device) ──
  const hasFaceDetector = ('FaceDetector' in window);
  async function suggestFor(item) {
    if (!hasFaceDetector || !item.bitmap) return null;
    const fd = new window.FaceDetector({ maxDetectedFaces: 1, fastMode: true });
    let best = null;
    for (const rot of [0, 90, 180, 270]) {
      const [rw, rh] = rotatedDims(item.bitmap.width, item.bitmap.height, rot);
      const scale = Math.min(1, SCAN_W / rw);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(rw * scale));
      c.height = Math.max(1, Math.round(rh * scale));
      drawRotated(c.getContext('2d'), item.bitmap, rot, c.width, c.height);
      let faces = [];
      try { faces = await fd.detect(c); } catch (e) { return null; }
      if (faces.length) {
        const b = faces[0].boundingBox;
        const area = (b.width * b.height) / (c.width * c.height);
        // prefer the rotation with the largest detected face; ties favor 0
        if (!best || area > best.area * 1.15 || (rot === 0 && area > best.area * 0.85)) {
          best = { rot, area, box: { x: b.x / c.width, y: b.y / c.height, w: b.width / c.width, h: b.height / c.height } };
        }
      }
    }
    if (!best) return { noFace: true };
    const s = {};
    if (best.rot !== 0) s.rot = best.rot;
    if (best.area < TINY_FACE) s.crop = expandFaceBox(best.box, CROP_EXPAND);
    return (s.rot !== undefined || s.crop) ? s : { ok: true };
  }

  // ── State ──
  const state = { items: [], filter: 'all', sel: -1, scanning: false };

  function counts() {
    const c = { all: state.items.length, suggested: 0, fixed: 0, unreviewed: 0 };
    state.items.forEach(it => {
      if (it.suggestion && (it.suggestion.rot !== undefined || it.suggestion.crop)) c.suggested++;
      if (it.done) c.fixed++; else c.unreviewed++;
    });
    return c;
  }
  function visible(it) {
    if (state.filter === 'suggested') return it.suggestion && (it.suggestion.rot !== undefined || it.suggestion.crop);
    if (state.filter === 'fixed') return it.done;
    if (state.filter === 'unreviewed') return !it.done;
    return true;
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
      #${OVERLAY_ID} .pr-canvas-wrap { position:relative; background:#0f172a; display:flex; justify-content:center; min-height:120px; }
      #${OVERLAY_ID} canvas { display:block; max-width:100%; }
      #${OVERLAY_ID} .pr-canvas-wrap.cropping { cursor:crosshair; }
      #${OVERLAY_ID} .pr-cropbox { position:absolute; border:2px dashed #fbbf24; background:rgba(251,191,36,.15); pointer-events:none; }
      #${OVERLAY_ID} .pr-badge { position:absolute; top:6px; left:6px; background:#f59e0b; color:#fff; font-size:10px; font-weight:700;
        padding:3px 8px; border-radius:6px; cursor:pointer; box-shadow:0 1px 4px rgba(0,0,0,.3); }
      #${OVERLAY_ID} .pr-badge.nf { background:#64748b; cursor:default; }
      #${OVERLAY_ID} .pr-meta { padding:8px 10px 2px; }
      #${OVERLAY_ID} .pr-name { font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #${OVERLAY_ID} .pr-sub { font-size:10px; color:#94a3b8; }
      #${OVERLAY_ID} .pr-controls { display:flex; gap:4px; padding:8px 10px 10px; flex-wrap:wrap; }
      #${OVERLAY_ID} .pr-c { flex:1; min-width:32px; border:1px solid #e2e8f0; background:#f8fafc; border-radius:7px;
        font-size:13px; padding:6px 0; cursor:pointer; text-align:center; }
      #${OVERLAY_ID} .pr-c:hover { background:#eef2f7; }
      #${OVERLAY_ID} .pr-c.on { background:#dcfce7; border-color:#86efac; }
      #${OVERLAY_ID} .pr-empty { text-align:center; color:#94a3b8; padding:48px 16px; grid-column:1/-1; }
      #${OVERLAY_ID} .pr-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#1e293b; color:#fff;
        padding:10px 20px; border-radius:10px; font-size:13px; z-index:2147483647; white-space:nowrap; }
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
    // suggestion badge
    let badge = el.querySelector('.pr-badge');
    const s = item.suggestion;
    const wants = s && (s.rot !== undefined || s.crop) ? ('suggest' + (s.rot !== undefined ? ' ↻' + s.rot + '°' : '') + (s.crop ? ' ✂ zoom' : '')) :
                  (s && s.noFace ? 'no face found' : null);
    if (wants) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'pr-badge';
        el.querySelector('.pr-canvas-wrap').appendChild(badge);
        badge.addEventListener('click', () => applySuggestion(item));
      }
      badge.textContent = wants;
      badge.classList.toggle('nf', !!(s && s.noFace));
    } else if (badge) badge.remove();
    el.querySelector('[data-act="done"]').classList.toggle('on', !!item.done);
    el.querySelector('[data-act="crop"]').classList.toggle('on', !!item.crop);
    drawCard(item);
  }

  function applySuggestion(item) {
    const s = item.suggestion;
    if (!s || (s.rot === undefined && !s.crop)) return;
    if (s.rot !== undefined) item.rot = s.rot;
    if (s.crop) item.crop = s.crop;
    item.suggestion = null;
    saveCorrection(item);
    updateCard(item);
    updatePills();
    toast('Applied suggestion for ' + item.name.split(' ')[0]);
  }

  function rotate(item, delta) {
    item.rot = ((item.rot + delta) % 360 + 360) % 360;
    item.crop = null; // crop coords are post-rotation; a new rotation invalidates them
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
        if (item.crop) { item.crop = null; saveCorrection(item); updateCard(item); }
        else armCrop(item);
      }
      else if (act === 'done') { item.done = !item.done; saveCorrection(item); updateCard(item); updatePills(); }
      else if (act === 'dl') download(item);
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
      p.textContent = { all: 'All ' + c.all, suggested: '⚠ Suggested ' + c.suggested, fixed: '✓ Fixed ' + c.fixed, unreviewed: '⏳ Unreviewed ' + c.unreviewed }[f];
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
          rot: prev.rot || 0, crop: prev.crop || null, done: !!prev.done,
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
          <span class="sub">${escHtml(courseKey)} · ${state.items.length} photo(s) · local-only, nothing is uploaded</span>
        </div>
        ${hasFaceDetector ? '<button class="pr-btn pr-btn-blue" id="pr-scan">⚡ Auto-scan</button>' : ''}
        <button class="pr-btn pr-btn-gray" id="pr-dl-all">⬇ Download fixed</button>
        <button class="pr-btn pr-btn-red" id="pr-close">✕ Close</button>
        <div class="pr-pills">
          <button class="pr-pill" data-f="all"></button>
          <button class="pr-pill" data-f="suggested"></button>
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
    ov.querySelectorAll('.pr-pill').forEach(p => p.addEventListener('click', () => { state.filter = p.dataset.f; updatePills(); }));
    document.addEventListener('keydown', onKeyNav);
    updatePills();
  }

  window.DipiPhotoReview = {
    open, close,
    _internal: { rotatedDims, clampCrop, expandFaceBox, pruneCorrections, photoIdFromUrl, escHtml },
  };

  open();
})();
