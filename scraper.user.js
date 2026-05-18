// ==UserScript==
// @name         DIPI Call Tracker
// @namespace    https://github.com/kapaggar/callconfirm
// @version      1.0.0
// @description  Scrape applicants from dipi.vridhamma.org and run an inline call tracker. Adds a floating button to /search-course/ and /centre/ pages.
// @author       Kapil Aggarwal
// @match        https://dipi.vridhamma.org/search-course/*
// @match        https://dipi.vridhamma.org/centre/*
// @match        https://*.vridhamma.org/search-course/*
// @match        https://*.vridhamma.org/centre/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://kapaggar.github.io/callconfirm/scraper.user.js
// @downloadURL  https://kapaggar.github.io/callconfirm/scraper.user.js
// ==/UserScript==

(function () {
  'use strict';

  var SCRAPER_URL = 'https://kapaggar.github.io/callconfirm/scraper.js';
  var TRACKER_URL = 'https://kapaggar.github.io/callconfirm/tracker-inline.js';

  var AUTORUN_KEY  = 'dipiTracker.autorun';      // 'true' | 'false' | null (default true on /search-course/)
  var BTN_ID       = 'dipi-tracker-fab';
  var FAB_POS_KEY  = 'dipiTracker.fabPos';

  function injectScraper() {
    // Tear down any existing scraper overlay first
    var old = document.getElementById('_ds');
    if (old) old.remove();
    window._DIPI_PWA_URL = 'https://kapaggar.github.io/callconfirm';
    window._DIPI_TRACKER_BASE = 'https://kapaggar.github.io/callconfirm';
    var s = document.createElement('script');
    s.src = SCRAPER_URL + '?v=' + Date.now();
    s.onerror = function () { console.error('[dipi-tracker] failed to load scraper.js'); };
    document.head.appendChild(s);
  }

  function openInlineTracker() {
    // If tracker is already loaded, just call open()
    if (window.DipiTracker) { window.DipiTracker.open(); return; }
    var s = document.createElement('script');
    s.src = TRACKER_URL + '?v=' + Date.now();
    s.onload = function () { window.DipiTracker && window.DipiTracker.open(); };
    s.onerror = function () { alert('[dipi-tracker] failed to load tracker-inline.js'); };
    document.head.appendChild(s);
  }

  function shouldAutoRun() {
    var v = localStorage.getItem(AUTORUN_KEY);
    return v === null ? true : v === 'true';
  }

  function waitForDataTable(maxMs, intervalMs) {
    maxMs = maxMs || 15000;
    intervalMs = intervalMs || 250;
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function tick() {
        try {
          var $ = window.jQuery || window.$;
          if ($ && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable) {
            var $tbl = $('#table-applicants').length ? $('#table-applicants') : $('table.dataTable');
            if ($tbl.length && $.fn.DataTable.isDataTable($tbl)) { resolve(); return; }
          }
        } catch (e) {}
        if (Date.now() - t0 > maxMs) { reject(new Error('DataTable init timeout')); return; }
        setTimeout(tick, intervalMs);
      })();
    });
  }

  function makeFab() {
    if (document.getElementById(BTN_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = BTN_ID;
    wrap.style.cssText = [
      'position:fixed', 'bottom:18px', 'right:18px', 'z-index:2147483644',
      'display:flex', 'flex-direction:column', 'gap:6px', 'align-items:flex-end',
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      'user-select:none'
    ].join(';');

    // Main button: re-run scraper (different label on /centre/ vs /search-course/)
    var path = location.pathname;
    var isSearch = path.indexOf('/search-course/') > -1;
    var primaryLabel = isSearch ? '🔄 Scrape' : '🧘 Pick Course';

    var primary = document.createElement('button');
    primary.textContent = primaryLabel;
    primary.title = 'Run DIPI scraper (right-click to toggle auto-run)';
    primary.style.cssText = btnStyle('#3b82f6');
    primary.onclick = injectScraper;
    primary.oncontextmenu = function (e) {
      e.preventDefault();
      var cur = localStorage.getItem(AUTORUN_KEY);
      var newVal = (cur === 'false') ? 'true' : 'false';
      localStorage.setItem(AUTORUN_KEY, newVal);
      primary.style.opacity = (newVal === 'true') ? '1' : '0.55';
      primary.title = 'Run DIPI scraper (auto-run: ' + newVal + ')';
    };
    if (!shouldAutoRun()) primary.style.opacity = '0.55';

    // Secondary: open last session in tracker (without re-scrape)
    var openBtn = document.createElement('button');
    openBtn.textContent = '📞 Open Tracker';
    openBtn.title = 'Open inline call tracker on last session';
    openBtn.style.cssText = btnStyle('#475569');
    openBtn.onclick = openInlineTracker;

    wrap.appendChild(openBtn);
    wrap.appendChild(primary);
    document.body.appendChild(wrap);
  }

  function btnStyle(bg) {
    return [
      'padding:10px 14px', 'background:' + bg, 'color:#fff', 'border:0',
      'border-radius:6px', 'cursor:pointer', 'font-size:13px', 'font-weight:600',
      'box-shadow:0 2px 8px rgba(0,0,0,.3)', 'min-width:140px', 'text-align:center'
    ].join(';');
  }

  // ---- Run ----
  makeFab();

  var isSearchPage = location.pathname.indexOf('/search-course/') > -1;
  if (isSearchPage && shouldAutoRun()) {
    waitForDataTable().then(injectScraper).catch(function (err) {
      console.warn('[dipi-tracker] auto-run skipped:', err.message);
    });
  }
})();
