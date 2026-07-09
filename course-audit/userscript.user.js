// ==UserScript==
// @name         dipi.vridhamma.org Course Audit
// @namespace    https://github.com/kapaggar/callconfirm
// @version      1.1.1
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

  // ---------- Shared FAB stack ----------
  // Multiple userscripts append into one #dipi-fab-stack so buttons don't overlap.
  // Each button sets data-order; we re-sort on append so load order doesn't matter.
  function getFabStack() {
    let stack = document.getElementById('dipi-fab-stack');
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
    const stack = getFabStack();
    stack.appendChild(btn);
    // Re-sort by data-order ascending (top to bottom)
    const kids = Array.from(stack.children).sort((a, b) =>
      (parseInt(a.dataset.order || '99', 10)) - (parseInt(b.dataset.order || '99', 10))
    );
    kids.forEach(k => stack.appendChild(k));
  }

  // ---------- Floating Re-run button (always available) ----------
  function addReRunButton() {
    if (document.getElementById('ca-rerun-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ca-rerun-btn';
    btn.textContent = '↻ Audit';
    btn.title = 'Re-run course audit (right-click to toggle auto-run)';
    btn.style.cssText = [
      'padding:10px 14px', 'background:#06c', 'color:#fff', 'border:0',
      'border-radius:6px', 'cursor:pointer', 'pointer-events:auto',
      "font:13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      'font-weight:600', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
      'min-width:140px', 'text-align:center'
    ].join(';');
    btn.onclick = () => injectLoader();
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      const cur = localStorage.getItem(AUTORUN_KEY);
      const newVal = (cur === 'false') ? 'true' : 'false';
      localStorage.setItem(AUTORUN_KEY, newVal);
      btn.style.opacity = (newVal === 'true') ? '1' : '0.55';
      btn.title = `Re-run audit (auto-run: ${newVal})`;
    };
    if (localStorage.getItem(AUTORUN_KEY) === 'false') {
      btn.style.opacity = '0.55';
      btn.title = 'Re-run audit (auto-run: false)';
    }
    appendFab(btn, 10); // order: 10 (between Open Tracker=5 and Scrape=20)
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
