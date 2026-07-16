// ==UserScript==
// @name         DIPI Call Tracker
// @namespace    https://github.com/kapaggar/callconfirm
// @version      1.4.0
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

  var AUTORUN_KEY  = 'dipiTracker.autorun';

  function injectScraper() {
    // Tear down any existing scraper overlay first
    var old = document.getElementById('_ds');
    if (old) old.remove();
    window._DIPI_TRACKER_BASE = 'https://kapaggar.github.io/callconfirm';
    var s = document.createElement('script');
    s.src = SCRAPER_URL + '?v=' + Date.now();
    s.onerror = function () { console.error('[dipi-tracker] failed to load scraper.js'); };
    document.head.appendChild(s);
  }

  // Click-to-run by default; auto-run is opt-in (right-click the FAB).
  function shouldAutoRun() {
    return localStorage.getItem(AUTORUN_KEY) === 'true';
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
      return (parseInt(a.dataset.order || '99', 10)) - (parseInt(b.dataset.order || '99', 10));
    });
    kids.forEach(function (k) { stack.appendChild(k); });
  }

  function makeFab() {
    if (document.getElementById('dipi-tracker-fab-primary')) return;

    var path = location.pathname;
    var isSearch = path.indexOf('/search-course/') > -1;
    var primaryLabel = isSearch ? '🔄 Scrape' : '🧘 Pick Course';

    var primary = document.createElement('button');
    primary.id = 'dipi-tracker-fab-primary';
    primary.textContent = primaryLabel;
    primary.title = 'Run DIPI scraper (right-click to toggle auto-run)';
    primary.style.cssText = btnStyle();
    primary.onclick = injectScraper;
    primary.oncontextmenu = function (e) {
      e.preventDefault();
      var newVal = shouldAutoRun() ? 'false' : 'true';
      localStorage.setItem(AUTORUN_KEY, newVal);
      primary.style.opacity = (newVal === 'true') ? '1' : '0.55';
      primary.title = 'Run DIPI scraper (auto-run: ' + newVal + ')';
    };
    if (!shouldAutoRun()) primary.style.opacity = '0.55';

    // FAB stack top-to-bottom: Audit (10, added by audit userscript), Scrape (20)
    appendFab(primary, 20);
  }

  // Shared neutral FAB style (keep in sync across the shells)
  function btnStyle() {
    return [
      'padding:10px 14px', 'background:rgba(30,41,59,.92)', 'color:#cbd5e1',
      'border:1px solid #475569',
      'border-radius:6px', 'cursor:pointer', 'pointer-events:auto',
      'font-size:13px', 'font-weight:600',
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
