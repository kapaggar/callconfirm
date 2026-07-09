// ==UserScript==
// @name         dipi.vridhamma.org Photo Review
// @namespace    https://github.com/kapaggar/callconfirm
// @version      1.8.3
// @description  Review and correct applicant photos (rotate / crop) on dipi search-course pages. Local by default; explicit ⬆dipi write-back. Adds a 📷 Photos button to the shared FAB stack.
// @author       Kapil Aggarwal
// @match        https://dipi.vridhamma.org/search-course/*
// @match        https://*.vridhamma.org/search-course/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://kapaggar.github.io/callconfirm/photo-review/userscript.user.js
// @downloadURL  https://kapaggar.github.io/callconfirm/photo-review/userscript.user.js
// ==/UserScript==

(function () {
  'use strict';

  const REVIEW_URL = 'https://kapaggar.github.io/callconfirm/photo-review/review.js';
  const AUTORUN_KEY = 'photoReview.autorun';

  function injectReview() {
    if (window.DipiPhotoReview) { window.DipiPhotoReview.open(); return; }
    const s = document.createElement('script');
    s.src = REVIEW_URL + '?v=' + Date.now();
    s.onerror = () => console.error('[photo-review] failed to load', s.src);
    document.head.appendChild(s);
  }

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

  // ---------- Shared FAB stack (same convention as audit/scraper userscripts) ----------
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
    const kids = Array.from(stack.children).sort((a, b) =>
      (parseInt(a.dataset.order || '99', 10)) - (parseInt(b.dataset.order || '99', 10))
    );
    kids.forEach(k => stack.appendChild(k));
  }

  function addPhotosButton() {
    if (document.getElementById('pr-fab-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'pr-fab-btn';
    btn.textContent = '📷 Photos';
    btn.title = 'Review applicant photos (right-click to toggle auto-run)';
    btn.style.cssText = [
      'padding:10px 14px', 'background:#0d9488', 'color:#fff', 'border:0',
      'border-radius:6px', 'cursor:pointer', 'pointer-events:auto',
      "font:13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      'font-weight:600', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
      'min-width:140px', 'text-align:center'
    ].join(';');
    btn.onclick = () => waitForDataTable(4000).then(injectReview).catch(() => injectReview());
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      const cur = localStorage.getItem(AUTORUN_KEY);
      const newVal = (cur === 'true') ? 'false' : 'true';
      localStorage.setItem(AUTORUN_KEY, newVal);
      btn.style.opacity = (newVal === 'true') ? '1' : '0.55';
      btn.title = `Review applicant photos (auto-run: ${newVal})`;
    };
    if (shouldAutoRun() === false) btn.style.opacity = '0.55';
    appendFab(btn, 30); // FAB order: Audit 10, Scrape 20, Photos 30
  }

  // Image loading is heavy, so unlike audit/scraper this defaults to OFF.
  function shouldAutoRun() {
    return localStorage.getItem(AUTORUN_KEY) === 'true';
  }

  // ---------- Run ----------
  addPhotosButton();

  if (shouldAutoRun()) {
    waitForDataTable().then(injectReview).catch(err => {
      console.warn('[photo-review] auto-run skipped:', err.message);
    });
  }
})();
