// launcher.js — all-in-one bookmarklet target for the dipi tools.
// Adds the shared #dipi-fab-stack with all three buttons (🔍 Audit, 📥 Scrape,
// 📷 Photos); each button injects its tool on demand, cache-busted. Nothing
// auto-runs — scraper.js and review.js open their UIs on load, so injecting
// all three at once would stack three overlays.
// Loaded by bookmarklet-all.txt; Tampermonkey users don't need this (the
// .user.js shells add the same buttons).
(function () {
  'use strict';

  if (!/(^|\.)vridhamma\.org$/i.test(location.hostname)) {
    alert('DIPI Tools: not on vridhamma.org. Run this bookmark on a dipi page.');
    return;
  }

  var BASE = (window._DIPI_TRACKER_BASE || 'https://kapaggar.github.io/callconfirm').replace(/\/+$/, '');

  // Idempotent: clicking the bookmarklet again just (re)ensures the buttons.
  if (window.DipiLauncher) { window.DipiLauncher.ensure(); return; }

  function inject(path) {
    var s = document.createElement('script');
    s.src = BASE + path + '?v=' + Date.now();
    s.onerror = function () { console.error('[dipi-launcher] failed to load', s.src); };
    document.head.appendChild(s);
  }

  // ---------- Shared FAB stack (same convention as the userscript shells) ----------
  function getFabStack() {
    var stack = document.getElementById('dipi-fab-stack');
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = 'dipi-fab-stack';
    stack.style.cssText = [
      'position:fixed', 'bottom:18px', 'right:18px', 'z-index:2147483644',
      'display:flex', 'flex-direction:column', 'gap:8px', 'align-items:flex-end',
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      'user-select:none', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(stack);
    return stack;
  }
  function appendFab(btn, order) {
    btn.dataset.order = String(order);
    var stack = getFabStack();
    stack.appendChild(btn);
    var kids = Array.prototype.slice.call(stack.children).sort(function (a, b) {
      return parseInt(a.dataset.order || '99', 10) - parseInt(b.dataset.order || '99', 10);
    });
    kids.forEach(function (k) { stack.appendChild(k); });
  }
  function makeBtn(id, text, title, order, onClick) {
    if (document.getElementById(id)) return;
    var btn = document.createElement('button');
    btn.id = id;
    btn.textContent = text;
    btn.title = title;
    btn.style.cssText = [
      'padding:10px 14px', 'background:rgba(30,41,59,.92)', 'color:#cbd5e1',
      'border:1px solid #475569',
      'border-radius:6px', 'cursor:pointer', 'pointer-events:auto',
      "font:13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      'font-weight:600', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
      'min-width:140px', 'text-align:center'
    ].join(';');
    btn.onclick = onClick;
    appendFab(btn, order);
  }

  function ensure() {
    // FAB order convention: Audit 10, Scrape 20, Photos 30
    makeBtn('dl-audit-btn', '🔍 Audit', 'Run the pre-course data-quality audit', 10, function () {
      inject('/course-audit/loader.js'); // loader tears down a previous panel itself
    });
    makeBtn('dl-scrape-btn', '📥 Scrape', 'Scrape applicants / open the call tracker', 20, function () {
      var old = document.getElementById('_ds');
      if (old) old.remove();
      window._DIPI_PWA_URL = BASE;
      window._DIPI_TRACKER_BASE = BASE;
      inject('/scraper.js');
    });
    makeBtn('dl-photos-btn', '📷 Photos', 'Review / correct applicant photos', 30, function () {
      if (window.DipiPhotoReview) { window.DipiPhotoReview.open(); return; }
      inject('/photo-review/review.js');
    });
  }

  ensure();
  window.DipiLauncher = { ensure: ensure, base: BASE };
})();
