// ═══════════════════════════════════════════════════════════════
// DIPI Scraper v5
// - Batch expand via jQuery trigger (5s vs 80s)
// - Group codes: NM/OM/SM/NF/OF/SF parsed from status "(NM76)"
// - Course dates passed to tracker
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var CID = '63';
  var CENTRE_URL = '/centre/' + CID;
  var SEARCH_BASE = '/search-course/' + CID + '/';
  var STATUS_FILTER = 'Expected,Confirmed';
  var PWA = window._DIPI_PWA_URL || '';

  var old = document.getElementById('_ds');
  if (old) old.remove();

  var ov = document.createElement('div');
  ov.id = '_ds';
  ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch';
  document.body.appendChild(ov);

  function setUI(h) { ov.innerHTML = '<div style="width:100%;max-width:420px;padding:16px">' + h + '</div>'; }
  function msg(m) { setUI('<div style="text-align:center;padding:40px 0"><div style="font-size:28px;margin-bottom:10px">\u{1F9D8}</div><div style="font-size:14px;font-weight:600">' + m + '</div></div>'); }
  function close() { ov.remove(); }
  function B(id, bg, label, fg, bdr) {
    return '<button id="' + id + '" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:' + bg + ';color:' + (fg || '#fff') + ';border:' + (bdr || 'none') + ';border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">' + label + '</button>';
  }
  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  var path = window.location.pathname;
  var isSearch = path.indexOf('/search-course/') > -1;
  var auto = sessionStorage.getItem('_ds_auto');

  if (isSearch && auto) { sessionStorage.removeItem('_ds_auto'); runScraper(); }
  else if (isSearch) {
    setUI('<div style="text-align:center;padding:20px 0"><div style="font-size:20px;margin-bottom:4px">\u{1F9D8}</div><div style="font-size:15px;font-weight:700;margin-bottom:16px">DIPI Scraper</div>' +
      B('_ds-go', '#3b82f6', '\u{1F504} Scrape This Page') + B('_ds-pk', '#475569', '\u{1F4CB} Pick Different Course') + B('_ds-x', 'transparent', '\u2715 Cancel', '#94a3b8', '1px solid #475569') + '</div>');
    document.getElementById('_ds-go').onclick = runScraper;
    document.getElementById('_ds-pk').onclick = pickCourse;
    document.getElementById('_ds-x').onclick = close;
  } else { pickCourse(); }

  // ═════════════════════════════════════
  // PHASE 1: Course Picker
  // ═════════════════════════════════════
  function pickCourse() {
    msg('Loading courses...');
    fetch(CENTRE_URL, { credentials: 'same-origin' }).then(function(r) { return r.text(); }).then(function(html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');

      var upIds = {}, upOrder = [];
      doc.querySelectorAll('div.summary-block div.table-heading a').forEach(function(a) {
        var m = (a.getAttribute('href') || '').match(/\/course\/\d+\/(\d+)/);
        if (m && !upIds[m[1]]) { upIds[m[1]] = true; upOrder.push(m[1]); }
      });

      var counts = {};
      doc.querySelectorAll('div.summary-block').forEach(function(bl) {
        var lk = bl.querySelector('div.table-heading a');
        if (!lk) return;
        var m = (lk.getAttribute('href') || '').match(/\/course\/\d+\/(\d+)/);
        if (!m) return;
        var exp = 0, conf = 0;
        bl.querySelectorAll('tbody tr').forEach(function(tr) {
          var lb = (tr.querySelector('td:first-child a') || {}).textContent || '';
          var tot = 0;
          tr.querySelectorAll('b a').forEach(function(ba) { tot += parseInt(ba.textContent) || 0; });
          if (lb.trim() === 'Expected') exp = tot;
          if (lb.trim() === 'Confirmed') conf = tot;
        });
        counts[m[1]] = { exp: exp, conf: conf };
      });

      var all = [];
      doc.querySelectorAll('select#edit-course option').forEach(function(o) {
        if (o.value && o.textContent.trim()) all.push({ id: o.value, title: o.textContent.trim(), up: !!upIds[o.value] });
      });

      var upcoming = upOrder.map(function(id) { return all.find(function(c) { return c.id === id; }); }).filter(Boolean);
      var others = all.filter(function(c) { return !c.up; });

      if (!all.length) {
        setUI('<div style="text-align:center;padding:20px"><div style="font-size:24px;margin-bottom:8px">\u26A0\uFE0F</div><div>No courses found. Logged in?</div>' + B('_ds-x', '#475569', '\u2715 Close') + '</div>');
        document.getElementById('_ds-x').onclick = close; return;
      }

      var h = '<div style="text-align:center;margin-bottom:14px"><div style="font-size:20px;margin-bottom:2px">\u{1F9D8}</div><div style="font-size:15px;font-weight:700">Select Course</div><div style="font-size:11px;color:#94a3b8;margin-top:2px">Expected + Confirmed</div></div>';

      if (upcoming.length) {
        h += '<div style="font-size:10px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">\u{1F4C5} Upcoming</div>';
        upcoming.forEach(function(c, i) {
          var cn = counts[c.id];
          var bg = cn ? '<div style="display:flex;gap:6px;margin-top:4px"><span style="font-size:10px;background:#f59e0b22;color:#f59e0b;padding:2px 6px;border-radius:4px">Exp ' + cn.exp + '</span><span style="font-size:10px;background:#22c55e22;color:#22c55e;padding:2px 6px;border-radius:4px">Conf ' + cn.conf + '</span><span style="font-size:10px;background:#3b82f622;color:#3b82f6;padding:2px 6px;border-radius:4px">\u03A3 ' + (cn.exp + cn.conf) + '</span></div>' : '';
          h += '<button class="_ds-c" data-id="' + c.id + '" style="display:block;width:100%;text-align:left;padding:12px 14px;margin-bottom:6px;background:' + (i === 0 ? '#1e3a5f' : '#1e293b') + ';border:' + (i === 0 ? '2px solid #3b82f6' : '1px solid #334155') + ';border-radius:10px;cursor:pointer;color:#fff"><div style="font-size:13px;font-weight:600;line-height:1.3">' + c.title + '</div>' + (i === 0 ? '<div style="font-size:9px;color:#60a5fa;margin-top:2px;font-weight:700">NEXT UPCOMING</div>' : '') + bg + '</button>';
        });
      }
      if (others.length) {
        h += '<details style="margin-top:12px"><summary style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;cursor:pointer">\u{1F4C1} All (' + others.length + ')</summary><div style="margin-top:6px">';
        others.forEach(function(c) { h += '<button class="_ds-c" data-id="' + c.id + '" style="display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:4px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;cursor:pointer;color:#94a3b8;font-size:12px">' + c.title + '</button>'; });
        h += '</div></details>';
      }
      h += '<button id="_ds-x" style="display:block;width:100%;padding:12px;margin-top:12px;background:transparent;color:#64748b;border:1px solid #334155;border-radius:10px;font-size:13px;cursor:pointer">\u2715 Cancel</button>';
      setUI(h);
      document.querySelectorAll('._ds-c').forEach(function(b) { b.onclick = function() { goTo(this.dataset.id); }; });
      document.getElementById('_ds-x').onclick = close;
    }).catch(function(e) {
      setUI('<div style="text-align:center;padding:20px"><div style="font-size:24px;margin-bottom:8px">\u274C</div><div>' + e.message + '</div>' + B('_ds-x', '#475569', '\u2715 Close') + '</div>');
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
    // Extract course title and dates
    var title = '', dates = '';
    var backLink = document.querySelector('a[href^="/course/' + CID + '/"]');
    if (backLink) title = backLink.textContent.trim();
    if (!title) title = (document.querySelector('h2') || {}).textContent || '';
    title = title.replace(/\s*\(Back to.*$/i, '').replace(/\s*\(Edit.*$/i, '').trim();

    // Parse dates from title: "Dhamma Sudha / 10 Day / 2026 / 15th-Apr to 26th-Apr"
    var dm = title.match(/(\d{1,2}\w*-\w+)\s+to\s+(\d{1,2}\w*-\w+)/i);
    if (dm) dates = dm[1] + ' to ' + dm[2];
    var ym = title.match(/\/\s*(\d{4})\s*\//);
    if (ym && dates) dates = dates + ' ' + ym[1];

    // Course type
    var courseType = '';
    var tm = title.match(/\/\s*(10 Day|3 Day|STP|SPL|20d|30d|45d|60d)\s*\//i);
    if (tm) courseType = tm[1];

    msg('Starting scrape...');

    (async function() {
      try {
        // Step 1: Show All
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

        // Step 2: Count main rows
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

        // Step 3: BATCH EXPAND — click all at once via jQuery
        msg('Expanding all ' + rows.length + ' rows...');

        // Check if jQuery is available (DIPI uses it)
        if (typeof jQuery !== 'undefined') {
          jQuery('table.dataTable tbody tr.odd td:first-child, table.dataTable tbody tr.even td:first-child').trigger('click');
        } else {
          // Fallback: click each first-child td
          rows.forEach(function(tr) {
            var td = tr.querySelector('td:first-child');
            if (td) td.click();
          });
        }

        // Wait for all details to render
        // 115 rows need a bit more time than 10
        var waitTime = Math.max(3000, Math.min(rows.length * 50, 8000));
        msg('Waiting for ' + rows.length + ' details to load...');
        await wait(waitTime);

        // Step 4: Scrape everything in one pass
        msg('Reading data...');
        var apps = [];
        rows = getMainRows(); // re-query in case DOM changed

        for (var i = 0; i < rows.length; i++) {
          var tr = rows[i];
          var cells = tr.querySelectorAll('td');
          var nm = '', st = '', ty = '', ag = '', groupCode = '';

          for (var c = 0; c < cells.length; c++) {
            var tx = cells[c].textContent.trim();

            if (tx.indexOf('(PDF)') > -1) {
              nm = tx.replace(/\(PDF\)/g, '').replace(/\s+/g, ' ').trim();
            }
            // Status: "Confirmed\n(NM76)" → status="Confirmed", group="NM"
            if (/^(Expected|Confirmed|Cancelled|Received|Attended|Left)/i.test(tx) && !cells[c].querySelector('select')) {
              st = tx.replace(/\n.*/s, '').trim();
              var gm = tx.match(/\(([A-Z]{2})\d+\)/);
              if (gm) groupCode = gm[1]; // NM, OM, SM, NF, OF, SF
            }
            if (/^(Old|New)\n?(Male|Female)$/im.test(tx)) {
              ty = tx.replace(/\n/g, ' ').trim();
            }
            if (/^\d{1,3}$/.test(tx) && +tx > 5 && +tx < 120) {
              ag = tx;
            }
          }

          // Detail row: tr.no-padding immediately after
          var phoneText = '';
          var nx = tr.nextElementSibling;
          if (nx && nx.classList.contains('no-padding')) {
            phoneText = nx.textContent || '';
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

          // Derive group from code or type
          var group = groupCode; // NM, OM, SM, NF, OF, SF
          if (!group && ty) {
            // Fallback from type text
            if (/New.*Male/i.test(ty)) group = 'NM';
            else if (/Old.*Male/i.test(ty)) group = 'OM';
            else if (/New.*Female/i.test(ty)) group = 'NF';
            else if (/Old.*Female/i.test(ty)) group = 'OF';
          }

          if (nm) {
            apps.push({ name: nm, mobile: mob, home: hom, office: ofc, email: eml, status: st, type: ty, age: ag, group: group });
          }
        }

        // Step 5: Collapse all back
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
    var g = { NM: 0, OM: 0, SM: 0, NF: 0, OF: 0, SF: 0, other: 0 };
    apps.forEach(function(a) { if (g[a.group] !== undefined) g[a.group]++; else g.other++; });
    var nExp = apps.filter(function(a) { return /Expected/i.test(a.status); }).length;
    var nConf = apps.filter(function(a) { return /Confirmed/i.test(a.status); }).length;

    var cleanTitle = title.replace(/Status:.*?,?\s*/i, '').replace(/Gender:.*$/i, '').trim() || 'Dhamma Sudha Course';

    setUI(
      '<div style="text-align:center;padding:16px 0">' +
      '<div style="font-size:24px;margin-bottom:6px">\u2705</div>' +
      '<div style="font-size:17px;font-weight:700">' + apps.length + ' applicants scraped</div>' +
      '<div style="font-size:12px;color:#94a3b8;margin-top:2px">' + cleanTitle + '</div>' +
      (dates ? '<div style="font-size:11px;color:#60a5fa;margin-top:2px">\u{1F4C5} ' + dates + '</div>' : '') +
      '<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;margin:14px 0">' +
      bdg('Exp', nExp, '#f59e0b') + bdg('Conf', nConf, '#22c55e') +
      bdg('NM', g.NM, '#3b82f6') + bdg('OM', g.OM, '#0ea5e9') + bdg('SM', g.SM, '#06b6d4') +
      bdg('NF', g.NF, '#a855f7') + bdg('OF', g.OF, '#d946ef') + bdg('SF', g.SF, '#ec4899') +
      '</div>' +
      B('_ds-t', '#3b82f6', '\u{1F4F1} Open in Call Tracker') +
      B('_ds-cp', '#16a34a', '\u{1F4CB} Copy Data') +
      B('_ds-csv', '#9333ea', '\u{1F4CA} Download CSV') +
      B('_ds-x', 'transparent', '\u2715 Close', '#94a3b8', '1px solid #475569') +
      '</div>'
    );

    document.getElementById('_ds-t').onclick = function() {
      var data = { apps: apps, title: cleanTitle, dates: dates, courseType: courseType };
      var enc = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      if (PWA) { window.open(PWA + '/index.html#dipi=' + enc, '_blank'); }
      else { navigator.clipboard.writeText(JSON.stringify(data)).then(function() { alert('PWA URL not set.\nData copied \u2014 open Tracker \u2192 Paste'); }); }
    };
    document.getElementById('_ds-cp').onclick = function() { navigator.clipboard.writeText(json).then(function() { alert('Copied ' + apps.length + '!\nTracker \u2192 Paste from DIPI'); }); };
    document.getElementById('_ds-csv').onclick = function() {
      var csv = 'S.No,Name,Mobile,Home,Office,Email,Status,Group,Type,Age\n';
      apps.forEach(function(a, i) { csv += (i + 1) + ',"' + a.name + '",' + a.mobile + ',' + a.home + ',' + a.office + ',' + a.email + ',"' + a.status + '",' + a.group + ',"' + a.type + '",' + a.age + '\n'; });
      var b = new Blob([csv], { type: 'text/csv' }); var u = URL.createObjectURL(b);
      var l = document.createElement('a'); l.href = u; l.download = 'dipi_' + cleanTitle.replace(/[^a-zA-Z0-9]/g, '_') + '.csv'; l.click();
    };
    document.getElementById('_ds-x').onclick = close;
  }

  function bdg(l, n, c) { return n ? '<div style="background:' + c + '22;color:' + c + ';padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600">' + l + ' ' + n + '</div>' : ''; }

})();
