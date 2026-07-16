// ═══════════════════════════════════════════════════════════════
// DIPI Scraper v7
// - Same DataTables scraping logic as v6
// - Loads the inline tracker on the dipi page (no nav). The old "Open in
//   PWA" route was removed when the hosted tracker was retired.
// - Exposes window.DipiScraper.run() for the inline tracker's Re-scrape
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var CID = '63';
  var CENTRE_URL = '/centre/' + CID;
  var SEARCH_BASE = '/search-course/' + CID + '/';
  // WaitList + Review ride along as the backfill pool: the tracker keeps them
  // out of the main calling queue and offers them as candidates when a
  // confirmed seat frees up (cancellation).
  var STATUS_FILTER = 'Expected,Confirmed,WaitList,Review';
  // Base for loading tracker-inline.js: explicit global (bookmarklet/userscript)
  // wins, else derive from this script's own URL (works for the web-hosted AND the
  // chrome-extension:// copy — must run synchronously; currentScript is null
  // later). No hardcoded URLs anywhere in this file (Web Store remote-code policy).
  var SELF_BASE = (document.currentScript && document.currentScript.src)
    ? new URL('.', document.currentScript.src).href.replace(/\/+$/, '') : null;
  // No hardcoded fallback URL here: MV3 forbids remotely hosted code, and the
  // Web Store rejected the package for exactly that (a remote literal next to
  // script injection). Every load path provides a base — bookmarklet/userscript/
  // launcher set the global, and script-src loading (web or extension)
  // yields SELF_BASE. The extension also pre-injects tracker-inline.js, so
  // loadInlineTracker() short-circuits there.
  var TRACKER_BASE = window._DIPI_TRACKER_BASE || SELF_BASE || '';

  // Expose API for re-scrape from inline tracker
  window.DipiScraper = { run: runScraper, pick: pickCourse };

  // If invoked from inline tracker, skip the picker overlay and go straight to scrape
  var isSearchPage = window.location.pathname.indexOf('/search-course/') > -1;
  var auto = sessionStorage.getItem('_ds_auto');

  var old = document.getElementById('_ds');
  if (old) old.remove();

  var ov = document.createElement('div');
  ov.id = '_ds';
  ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483645;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch';
  document.body.appendChild(ov);

  function setUI(h) { ov.innerHTML = '<div style="width:100%;max-width:420px;padding:16px">' + h + '</div>'; }
  function msg(m) { setUI('<div style="text-align:center;padding:40px 0"><div style="font-size:28px;margin-bottom:10px">\u{1F9D8}</div><div style="font-size:14px;font-weight:600">' + m + '</div></div>'); }
  function close() { ov.remove(); }
  function B(id, bg, label, fg, bdr) {
    return '<button id="' + id + '" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:' + bg + ';color:' + (fg || '#fff') + ';border:' + (bdr || 'none') + ';border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">' + label + '</button>';
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  if (isSearchPage && auto) {
    sessionStorage.removeItem('_ds_auto');
    runScraper();
  } else if (isSearchPage) {
    setUI('<div style="text-align:center;padding:20px 0"><div style="font-size:20px;margin-bottom:4px">\u{1F9D8}</div><div style="font-size:15px;font-weight:700;margin-bottom:16px">DIPI Scraper</div>' +
      B('_ds-go', '#3f65a7', '\u{1F504} Scrape This Page') +
      B('_ds-pk', 'rgba(148,163,184,.12)', '\u{1F4CB} Pick Different Course', '#cbd5e1', '1px solid #475569') +
      B('_ds-x',  'transparent', '\u2715 Cancel', '#94a3b8', '1px solid #475569') + '</div>');
    document.getElementById('_ds-go').onclick = runScraper;
    document.getElementById('_ds-pk').onclick = pickCourse;
    document.getElementById('_ds-x').onclick  = close;
  } else {
    pickCourse();
  }

  // ═════════════════════════════════════
  // PHASE 1: Course Picker
  // ═════════════════════════════════════
  function pickCourse() {
    msg('Loading courses...');
    fetch(CENTRE_URL, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var upIds = {}, upOrder = [];
      doc.querySelectorAll('div.summary-block div.table-heading a').forEach(function (a) {
        var m = (a.getAttribute('href') || '').match(/\/course\/\d+\/(\d+)/);
        if (m && !upIds[m[1]]) { upIds[m[1]] = true; upOrder.push(m[1]); }
      });
      var counts = {};
      doc.querySelectorAll('div.summary-block').forEach(function (bl) {
        var lk = bl.querySelector('div.table-heading a');
        if (!lk) return;
        var m = (lk.getAttribute('href') || '').match(/\/course\/\d+\/(\d+)/);
        if (!m) return;
        var exp = 0, conf = 0;
        bl.querySelectorAll('tbody tr').forEach(function (tr) {
          var lb = (tr.querySelector('td:first-child a') || {}).textContent || '';
          var tot = 0;
          tr.querySelectorAll('b a').forEach(function (ba) { tot += parseInt(ba.textContent) || 0; });
          if (lb.trim() === 'Expected')  exp = tot;
          if (lb.trim() === 'Confirmed') conf = tot;
        });
        counts[m[1]] = { exp: exp, conf: conf };
      });
      var all = [];
      doc.querySelectorAll('select#edit-course option').forEach(function (o) {
        if (o.value && o.textContent.trim()) all.push({ id: o.value, title: o.textContent.trim(), up: !!upIds[o.value] });
      });
      var upcoming = upOrder.map(function (id) { return all.find(function (c) { return c.id === id; }); }).filter(Boolean);
      var others = all.filter(function (c) { return !c.up; });
      if (!all.length) {
        setUI('<div style="text-align:center;padding:20px"><div style="font-size:24px;margin-bottom:8px">\u26A0\uFE0F</div><div>No courses found. Logged in?</div>' + B('_ds-x', 'rgba(148,163,184,.12)', '\u2715 Close', '#cbd5e1', '1px solid #475569') + '</div>');
        document.getElementById('_ds-x').onclick = close; return;
      }
      var h = '<div style="text-align:center;margin-bottom:14px"><div style="font-size:20px;margin-bottom:2px">\u{1F9D8}</div><div style="font-size:15px;font-weight:700">Select Course</div><div style="font-size:11px;color:#94a3b8;margin-top:2px">Expected + Confirmed</div></div>';
      if (upcoming.length) {
        h += '<div style="font-size:10px;font-weight:700;color:#8aa8cc;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">\u{1F4C5} Upcoming</div>';
        upcoming.forEach(function (c, i) {
          var cn = counts[c.id];
          var chip = 'font-size:10px;background:rgba(148,163,184,.14);color:#a8b3c2;padding:2px 6px;border-radius:4px';
          var bg = cn ? '<div style="display:flex;gap:6px;margin-top:4px"><span style="' + chip + '">Exp ' + cn.exp + '</span><span style="' + chip + '">Conf ' + cn.conf + '</span><span style="' + chip + '">\u03A3 ' + (cn.exp + cn.conf) + '</span></div>' : '';
          h += '<button class="_ds-c" data-id="' + c.id + '" style="display:block;width:100%;text-align:left;padding:12px 14px;margin-bottom:6px;background:' + (i === 0 ? '#24344c' : '#1e293b') + ';border:' + (i === 0 ? '1px solid #3f65a7' : '1px solid #334155') + ';border-radius:10px;cursor:pointer;color:#fff"><div style="font-size:13px;font-weight:600;line-height:1.3">' + c.title + '</div>' + (i === 0 ? '<div style="font-size:9px;color:#8aa8cc;margin-top:2px;font-weight:700">NEXT UPCOMING</div>' : '') + bg + '</button>';
        });
      }
      if (others.length) {
        h += '<details style="margin-top:12px"><summary style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;cursor:pointer">\u{1F4C1} All (' + others.length + ')</summary><div style="margin-top:6px">';
        others.forEach(function (c) { h += '<button class="_ds-c" data-id="' + c.id + '" style="display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:4px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;cursor:pointer;color:#94a3b8;font-size:12px">' + c.title + '</button>'; });
        h += '</div></details>';
      }
      h += '<button id="_ds-x" style="display:block;width:100%;padding:12px;margin-top:12px;background:transparent;color:#64748b;border:1px solid #334155;border-radius:10px;font-size:13px;cursor:pointer">\u2715 Cancel</button>';
      setUI(h);
      document.querySelectorAll('._ds-c').forEach(function (b) { b.onclick = function () { goTo(this.dataset.id); }; });
      document.getElementById('_ds-x').onclick = close;
    }).catch(function (e) {
      setUI('<div style="text-align:center;padding:20px"><div style="font-size:24px;margin-bottom:8px">\u274C</div><div>' + e.message + '</div>' + B('_ds-x', 'rgba(148,163,184,.12)', '\u2715 Close', '#cbd5e1', '1px solid #475569') + '</div>');
      document.getElementById('_ds-x').onclick = close;
    });
  }

  function goTo(id) {
    sessionStorage.setItem('_ds_auto', '1');
    msg('Navigating...');
    window.location.href = SEARCH_BASE + id + '?s=' + encodeURIComponent(STATUS_FILTER) + '&t=&g=';
  }

  // ═════════════════════════════════════
  // PHASE 2: Scrape (batch expand)
  // ═════════════════════════════════════
  function runScraper() {
    var title = '', dates = '', courseType = '';
    var backLink = document.querySelector('a[href^="/course/' + CID + '/"]');
    if (backLink) title = backLink.textContent.trim();
    if (!title) title = (document.querySelector('h2') || {}).textContent || '';
    title = title.replace(/\s*\(Back to.*$/i, '').replace(/\s*\(Edit.*$/i, '').trim();
    var dm = title.match(/(\d{1,2}\w*-\w+)\s+to\s+(\d{1,2}\w*-\w+)/i);
    if (dm) dates = dm[1] + ' to ' + dm[2];
    var ym = title.match(/\/\s*(\d{4})\s*\//);
    if (ym && dates) dates = dates + ' ' + ym[1];
    var tm = title.match(/\/\s*(10 Day|3 Day|STP|SPL|20d|30d|45d|60d)\s*\//i);
    if (tm) courseType = tm[1];

    msg('Starting scrape...');
    (async function () {
      try {
        // Show All
        msg('Loading all entries...');
        var sel = document.querySelector('select[name$="_length"]');
        if (sel) {
          var hasAll = false;
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === '-1') { sel.value = '-1'; hasAll = true; break; }
          }
          if (!hasAll) { var o = document.createElement('option'); o.value = '-1'; o.text = 'All'; sel.appendChild(o); sel.value = '-1'; }
          sel.dispatchEvent(new Event('change'));
          await wait(2500);
        }
        var tbl = document.querySelector('table.dataTable') || document.querySelector('table');
        if (!tbl) { msg('No table found!'); return; }

        function getMainRows() {
          var all = tbl.querySelector('tbody').querySelectorAll('tr');
          var r = [];
          for (var k = 0; k < all.length; k++) {
            var cl = all[k].className;
            if (cl.indexOf('odd') > -1 || cl.indexOf('even') > -1) r.push(all[k]);
          }
          return r;
        }
        var rows = getMainRows();
        if (!rows.length) { msg('No applicants found'); return; }

        msg('Expanding all ' + rows.length + ' rows...');
        if (typeof jQuery !== 'undefined') {
          jQuery('table.dataTable tbody tr.odd td:first-child, table.dataTable tbody tr.even td:first-child').trigger('click');
        } else {
          rows.forEach(function (tr) { var td = tr.querySelector('td:first-child'); if (td) td.click(); });
        }
        var waitTime = Math.max(3000, Math.min(rows.length * 50, 8000));
        msg('Waiting for ' + rows.length + ' details to load...');
        await wait(waitTime);

        msg('Reading data...');
        var apps = [];
        rows = getMainRows();
        for (var i = 0; i < rows.length; i++) {
          var tr = rows[i];
          var cells = tr.querySelectorAll('td');
          var nm = '', st = '', ty = '', ag = '', groupCode = '', aid = '';
          var allLinks = tr.querySelectorAll('a[href]');
          for (var li = 0; li < allLinks.length; li++) {
            var href = allLinks[li].getAttribute('href') || '';
            var aidMatch = href.match(/\/app\/(\d+)/);
            if (aidMatch) { aid = aidMatch[1]; break; }
          }
          for (var c = 0; c < cells.length; c++) {
            var tx = cells[c].textContent.trim();
            if (tx.indexOf('(PDF)') > -1) {
              nm = tx.replace(/\(PDF\)/g, '').replace(/\s+/g, ' ').trim();
              if (!aid) {
                var cellLinks = cells[c].querySelectorAll('a[href]');
                for (var cl2 = 0; cl2 < cellLinks.length; cl2++) {
                  var ch = cellLinks[cl2].getAttribute('href') || '';
                  var cm = ch.match(/\/app\/(\d+)/);
                  if (cm) { aid = cm[1]; break; }
                }
              }
            }
            if (/^(Expected|Confirmed|Cancelled|Received|Attended|Left|WaitList|Review)/i.test(tx) && !cells[c].querySelector('select')) {
              st = tx.replace(/\n.*/s, '').trim();
              var gm = tx.match(/\(([A-Z]{2})\d+\)/);
              if (gm) groupCode = gm[1];
            }
            if (/^(Old|New)\n?(Male|Female)$/im.test(tx)) ty = tx.replace(/\n/g, ' ').trim();
            if (/^\d{1,3}$/.test(tx) && +tx > 5 && +tx < 120) ag = tx;
          }
          var phoneText = '';
          var nx = tr.nextElementSibling;
          if (nx && nx.classList.contains('no-padding')) {
            phoneText = nx.textContent || '';
            if (!aid) {
              var detailLinks = nx.querySelectorAll('a[href]');
              for (var dl = 0; dl < detailLinks.length; dl++) {
                var dh = detailLinks[dl].getAttribute('href') || '';
                var dm2 = dh.match(/\/app\/(\d+)/);
                if (dm2) { aid = dm2[1]; break; }
              }
            }
          }
          var mob = '', hom = '', ofc = '', eml = '';
          var m1 = phoneText.match(/M:\s*(\d{7,15})/);
          var m2 = phoneText.match(/H:\s*(\d{7,15})/);
          var m3 = phoneText.match(/O:\s*(\d{7,15})/);
          var m4 = phoneText.match(/Email:\s*([^\s,]+@[^\s,]+)/);
          if (m1) mob = m1[1];
          if (m2) hom = m2[1];
          if (m3) ofc = m3[1];
          if (m4) eml = m4[1];

          var group = groupCode;
          if (!group && ty) {
            if (/New.*Male/i.test(ty))   group = 'NM';
            else if (/Old.*Male/i.test(ty)) group = 'OM';
            else if (/New.*Female/i.test(ty)) group = 'NF';
            else if (/Old.*Female/i.test(ty)) group = 'OF';
          }
          if (nm) apps.push({ name: nm, mobile: mob, home: hom, office: ofc, email: eml, status: st, type: ty, age: ag, group: group, aid: aid });
        }

        if (typeof jQuery !== 'undefined') {
          jQuery('table.dataTable tbody tr.shown td:first-child').trigger('click');
        }
        showResults(apps, title, dates, courseType);
      } catch (e) {
        msg('Error: ' + e.message);
        console.error(e);
      }
    })();
  }

  function showResults(apps, title, dates, courseType) {
    var json = JSON.stringify(apps);
    var g = { NM: 0, OM: 0, SM: 0, NF: 0, OF: 0, SF: 0 };
    apps.forEach(function (a) { if (g[a.group] !== undefined) g[a.group]++; });
    var nExp = apps.filter(function (a) { return /Expected/i.test(a.status); }).length;
    var nConf = apps.filter(function (a) { return /Confirmed/i.test(a.status); }).length;
    var nPool = apps.filter(function (a) { return /^(WaitList|Review)/i.test(a.status); }).length;
    var withAid = apps.filter(function (a) { return a.aid; }).length;
    var cleanTitle = title.replace(/Status:.*?,?\s*/i, '').replace(/Gender:.*$/i, '').trim() || 'Dhamma Sudha Course';

    // Detect existing tracker session for this course (via session index in localStorage)
    var courseKey = '';
    var pathMatch = location.pathname.match(/\/search-course\/(\d+)\/(\d+)/);
    if (pathMatch) courseKey = pathMatch[1] + '/' + pathMatch[2];
    var existingSession = null;
    try {
      var idx = JSON.parse(localStorage.getItem('dipiTracker.sessionIndex') || '{}');
      if (courseKey && idx[courseKey]) existingSession = idx[courseKey];
    } catch (e) {}

    var primaryLabel = existingSession && existingSession.withProgress > 0
      ? '\u{1F4DE} Resume Calling (' + existingSession.withProgress + ' marked)'
      : '\u{1F4DE} Open Inline Call Tracker';

    setUI(
      '<div style="text-align:center;padding:16px 0">' +
      '<div style="font-size:24px;margin-bottom:6px">\u2705</div>' +
      '<div style="font-size:17px;font-weight:700">' + apps.length + ' applicants scraped</div>' +
      '<div style="font-size:12px;color:#94a3b8;margin-top:2px">' + cleanTitle + '</div>' +
      (dates ? '<div style="font-size:11px;color:#8aa8cc;margin-top:2px">\u{1F4C5} ' + dates + '</div>' : '') +
      '<div style="font-size:10px;color:#64748b;margin-top:4px">AIDs captured: ' + withAid + '/' + apps.length + '</div>' +
      '<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin:14px 0">' +
      bdg('Exp', nExp) + bdg('Conf', nConf) + bdg('🪑 Pool', nPool) +
      bdg('NM', g.NM) + bdg('OM', g.OM) + bdg('SM', g.SM) +
      bdg('NF', g.NF) + bdg('OF', g.OF) + bdg('SF', g.SF) +
      '</div>' +
      B('_ds-inline', '#3f65a7', primaryLabel) +
      B('_ds-cp',     'rgba(148,163,184,.12)', '\u{1F4CB} Copy Data', '#cbd5e1', '1px solid #475569') +
      B('_ds-csv',    'rgba(148,163,184,.12)', '\u{1F4CA} Download CSV', '#cbd5e1', '1px solid #475569') +
      B('_ds-aid',    'rgba(148,163,184,.12)', '\u{1F4E4} Export AID:Phone (for script)', '#cbd5e1', '1px solid #475569') +
      B('_ds-x',      'transparent', '\u2715 Close', '#94a3b8', '1px solid #475569') +
      '</div>'
    );

    // PRIMARY: load inline tracker
    document.getElementById('_ds-inline').onclick = function () {
      msg('Opening inline tracker...');
      loadInlineTracker(function () {
        close();
        window.DipiTracker.import(apps, cleanTitle, dates, courseType).catch(function (err) {
          alert('Inline tracker import failed: ' + err.message);
        });
      });
    };

    document.getElementById('_ds-cp').onclick = function () {
      navigator.clipboard.writeText(json).then(function () { alert('Copied ' + apps.length + ' applicants'); });
    };

    document.getElementById('_ds-csv').onclick = function () {
      var esc = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var csv = 'S.No,Name,AID,Mobile,Home,Office,Email,Status,Group,Type,Age\n';
      apps.forEach(function (a, i) { csv += (i + 1) + ',' + esc(a.name) + ',' + a.aid + ',' + a.mobile + ',' + a.home + ',' + a.office + ',' + esc(a.email) + ',' + esc(a.status) + ',' + a.group + ',' + esc(a.type) + ',' + a.age + '\n'; });
      var b = new Blob([csv], { type: 'text/csv' }); var u = URL.createObjectURL(b);
      var l = document.createElement('a'); l.href = u; l.download = 'dipi_' + cleanTitle.replace(/[^a-zA-Z0-9]/g, '_') + '.csv'; l.click();
    };

    document.getElementById('_ds-aid').onclick = function () {
      var lines = apps.filter(function (a) { return a.aid && a.mobile; }).map(function (a) { return a.aid + ':' + a.mobile; });
      var txt = lines.join('\n') + '\n';
      var b = new Blob([txt], { type: 'text/plain' }); var u = URL.createObjectURL(b);
      var l = document.createElement('a'); l.href = u; l.download = 'aid_mobilenumber.txt'; l.click();
      alert('Exported ' + lines.length + ' entries.\nUse with improved_aid.sh');
    };

    document.getElementById('_ds-x').onclick = close;
  }

  function bdg(l, n) {
    return n ? '<div style="background:rgba(148,163,184,.14);color:#a8b3c2;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600">' + l + ' ' + n + '</div>' : '';
  }

  function loadInlineTracker(cb) {
    if (window.DipiTracker) { cb(); return; }
    var s = document.createElement('script');
    s.src = TRACKER_BASE + '/tracker-inline.js?v=' + Date.now();
    s.onload = cb;
    s.onerror = function () { alert('Failed to load tracker-inline.js from ' + TRACKER_BASE); };
    document.head.appendChild(s);
  }
})();
