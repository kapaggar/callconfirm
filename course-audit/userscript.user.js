// ==UserScript==
// @name         dipi.vridhamma.org Course Audit
// @namespace    https://github.com/kapaggar/callconfirm
// @version      1.0.0
// @description  Auto-runs course audit overlay on dipi.vridhamma.org applicants pages. Adds a floating Re-run button. Toggleable via localStorage.courseAudit.autorun.
// @author       Kapil Aggarwal
// @match        https://dipi.vridhamma.org/search-course/*
// @match        https://*.vridhamma.org/search-course/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://kapaggar.github.io/callconfirm/course-audit/userscript.user.js
// @downloadURL  https://kapaggar.github.io/callconfirm/course-audit/userscript.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LOADER_URL = 'https://kapaggar.github.io/callconfirm/course-audit/loader.js';
  const AUTORUN_KEY = 'courseAudit.autorun';

  // ---------- Inject loader.js (cache-busted so audit logic stays fresh) ----------
  function injectLoader() {
    // If a previous panel/iframe is still up, the loader will tear it down itself.
    const s = document.createElement('script');
    s.src = LOADER_URL + '?v=' + Date.now();
    s.onerror = () => console.error('[course-audit] failed to load', s.src);
    document.head.appendChild(s);
  }

  // ---------- Wait for DataTables to finish initializing ----------
  function waitForDataTable(maxMs = 15000, intervalMs = 250) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function tick() {
        try {
          const $ = window.jQuery || window.$;
          if ($ && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable) {
            const $tbl = $('#table-applicants');
            if ($tbl.length && $.fn.DataTable.isDataTable($tbl)) { resolve(); return; }
          }
        } catch (e) { /* keep polling */ }
        if (Date.now() - t0 > maxMs) { reject(new Error('DataTable init timeout')); return; }
        setTimeout(tick, intervalMs);
      })();
    });
  }

  // ---------- Floating Re-run button (always available) ----------
  function addReRunButton() {
    if (document.getElementById('ca-rerun-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ca-rerun-btn';
    btn.textContent = '↻ Audit';
    btn.title = 'Re-run course audit (right-click to toggle auto-run)';
    btn.style.cssText = [
      'position:fixed', 'bottom:18px', 'right:18px', 'z-index:2147483646',
      'padding:8px 14px', 'background:#06c', 'color:#fff', 'border:0',
      'border-radius:6px', 'cursor:pointer',
      "font:13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      'box-shadow:0 2px 8px rgba(0,0,0,.3)', 'user-select:none'
    ].join(';');
    btn.onclick = () => injectLoader();
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      const cur = localStorage.getItem(AUTORUN_KEY);
      const newVal = (cur === 'false') ? 'true' : 'false';
      localStorage.setItem(AUTORUN_KEY, newVal);
      btn.style.background = (newVal === 'true') ? '#06c' : '#888';
      btn.title = `Re-run audit (auto-run: ${newVal})`;
    };
    // Reflect initial state
    if (localStorage.getItem(AUTORUN_KEY) === 'false') {
      btn.style.background = '#888';
      btn.title = 'Re-run audit (auto-run: false)';
    }
    document.body.appendChild(btn);
  }

  function shouldAutoRun() {
    const v = localStorage.getItem(AUTORUN_KEY);
    return v === null || v === 'true';
  }

  // ---------- Run ----------
  addReRunButton();

  if (shouldAutoRun()) {
    waitForDataTable().then(injectLoader).catch(err => {
      console.warn('[course-audit] auto-run skipped:', err.message);
    });
  } else {
    console.info('[course-audit] auto-run disabled (right-click ↻ Audit button to re-enable)');
  }
})();
