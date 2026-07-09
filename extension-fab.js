// extension-fab.js — MV3 content script (ISOLATED world) for the DIPI tools.
// Port of the union of the three Tampermonkey shells: adds the shared
// #dipi-fab-stack with ↻ Audit / Scrape / 📷 Photos buttons and the same
// localStorage autorun flags (the content-script localStorage IS the page's,
// so flags and all tool data are shared with the userscript/bookmarklet paths).
//
// Tools are injected as <script src=chrome.runtime.getURL(...)> tags, so they
// execute in the page's MAIN world exactly as the github.io-loaded copies do —
// same window.jQuery/DataTables access, same dipi-origin localStorage/IndexedDB
// (zero storage migration). All files are bundled; nothing loads remotely.
// The ?v=Date.now() suffix is kept for symmetry with the other paths but is
// inert here: updates come from git pull + reloading the extension.
(function () {
  'use strict';

  var isSearch = location.pathname.indexOf('/search-course/') > -1;

  var AUTORUN = {
    scrape: { key: 'dipiTracker.autorun', def: true },
    audit:  { key: 'courseAudit.autorun', def: true },
    photos: { key: 'photoReview.autorun', def: false },
  };
  function autorunOn(t) {
    var v = localStorage.getItem(AUTORUN[t].key);
    return v === null ? AUTORUN[t].def : v === 'true';
  }

  function inject(path, onload) {
    var s = document.createElement('script');
    s.src = chrome.runtime.getURL(path) + '?v=' + Date.now();
    if (onload) s.onload = onload;
    s.onerror = function () { console.error('[dipi-ext] failed to load', s.src); };
    (document.head || document.documentElement).appendChild(s);
  }

  // Dependencies are pre-injected (audit.js before loader.js, tracker-inline.js
  // before scraper.js) so the tools' own dynamic script loaders short-circuit
  // on their window.CourseAudit / window.DipiTracker guards — under MV3 the
  // extension must never reach a runtime script fetch it doesn't bundle.
  var injectAudit = function () {
    inject('course-audit/audit.js', function () { inject('course-audit/loader.js'); });
  };
  var injectScraper = function () {
    var old = document.getElementById('_ds');
    if (old) old.remove();
    inject('tracker-inline.js', function () { inject('scraper.js'); }); // scraper derives TRACKER_BASE from its own src
  };
  var injectPhotos = function () { inject('photo-review/review.js'); }; // self-guards + re-opens

  // The isolated world can't see the page's $.fn.DataTable, so poll for the
  // DOM artifacts DataTables leaves instead (the _wrapper div + populated
  // tbody). Slightly earlier signal than isDataTable(); the tools' own
  // "wait and retry" guards absorb the gap.
  function waitForDataTable(maxMs, intervalMs) {
    maxMs = maxMs || 15000;
    intervalMs = intervalMs || 250;
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function tick() {
        var wrap = document.querySelector('#table-applicants_wrapper') ||
                   document.querySelector('.dataTables_wrapper');
        if (wrap && wrap.querySelector('tbody tr')) { resolve(); return; }
        if (Date.now() - t0 > maxMs) { reject(new Error('DataTable init timeout')); return; }
        setTimeout(tick, intervalMs);
      })();
    });
  }

  // ---------- Shared FAB stack (same convention/ids as the other shells) ----------
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
  function btnStyle(bg) {
    return [
      'padding:10px 14px', 'background:' + bg, 'color:#fff', 'border:0',
      'border-radius:6px', 'cursor:pointer', 'pointer-events:auto',
      "font:13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      'font-weight:600', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
      'min-width:140px', 'text-align:center'
    ].join(';');
  }

  // Skip if the userscript-shell id OR the bookmarklet-launcher id already
  // exists — the DOM is shared across worlds, so double-installs dedupe.
  function makeBtn(opts) {
    if (document.getElementById(opts.id) || document.getElementById(opts.launcherId)) return;
    var btn = document.createElement('button');
    btn.id = opts.id;
    btn.textContent = opts.text;
    btn.title = opts.title + ' (right-click to toggle auto-run)';
    btn.style.cssText = btnStyle(opts.bg);
    btn.onclick = opts.onClick;
    btn.oncontextmenu = function (e) {
      e.preventDefault();
      var newVal = autorunOn(opts.tool) ? 'false' : 'true';
      localStorage.setItem(AUTORUN[opts.tool].key, newVal);
      btn.style.opacity = (newVal === 'true') ? '1' : '0.55';
      btn.title = opts.title + ' (auto-run: ' + newVal + ')';
    };
    if (!autorunOn(opts.tool)) btn.style.opacity = '0.55';
    appendFab(btn, opts.order);
  }

  // ---------- Run ----------
  // Page scoping mirrors the userscript @match blocks: audit + photos only on
  // /search-course/ pages; scraper everywhere (it has a course picker).
  if (isSearch) {
    makeBtn({
      id: 'ca-rerun-btn', launcherId: 'dl-audit-btn', tool: 'audit',
      text: '↻ Audit', title: 'Re-run course audit', bg: '#06c', order: 10,
      onClick: injectAudit,
    });
  }
  makeBtn({
    id: 'dipi-tracker-fab-primary', launcherId: 'dl-scrape-btn', tool: 'scrape',
    text: isSearch ? '🔄 Scrape' : '🧘 Pick Course', title: 'Run DIPI scraper',
    bg: '#3b82f6', order: 20,
    onClick: injectScraper,
  });
  if (isSearch) {
    makeBtn({
      id: 'pr-fab-btn', launcherId: 'dl-photos-btn', tool: 'photos',
      text: '📷 Photos', title: 'Review applicant photos', bg: '#0d9488', order: 30,
      onClick: function () { waitForDataTable(4000).then(injectPhotos).catch(injectPhotos); },
    });
  }

  if (isSearch && autorunOn('audit')) {
    waitForDataTable().then(injectAudit).catch(function (err) {
      console.warn('[dipi-ext] audit auto-run skipped:', err.message);
    });
  }
  if (isSearch && autorunOn('scrape')) {
    waitForDataTable().then(injectScraper).catch(function (err) {
      console.warn('[dipi-ext] scraper auto-run skipped:', err.message);
    });
  }
  if (isSearch && autorunOn('photos')) {
    waitForDataTable().then(injectPhotos).catch(function (err) {
      console.warn('[dipi-ext] photos auto-run skipped:', err.message);
    });
  }
})();
