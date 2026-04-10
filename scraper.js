// ═══════════════════════════════════════════════════════════════
// DIPI Scraper v4 — Verified against live DIPI DOM structure
//
// Main rows:     tr.odd / tr.even (DataTable alternating classes)
// Expanded flag: tr.odd.shown / tr.even.shown
// Detail row:    tr.no-padding (single td colspan, address + phones)
// Phone format:  "... / H: 9536074750 M: 9536216216 O:  Email: ..."
// Course select: select#edit-course option[value]
// Upcoming:      div.summary-block div.table-heading a[href^="/course/63/"]
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var CENTRE_ID = '63';
  var CENTRE_URL = '/centre/' + CENTRE_ID;
  var SEARCH_BASE = '/search-course/' + CENTRE_ID + '/';
  var STATUS_FILTER = 'Expected,Confirmed';
  var PWA_URL = window._DIPI_PWA_URL || '';

  // Cleanup
  var old = document.getElementById('_ds');
  if (old) old.remove();

  // UI
  var ov = document.createElement('div');
  ov.id = '_ds';
  ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch';
  document.body.appendChild(ov);

  function setUI(h) { ov.innerHTML = '<div style="width:100%;max-width:420px;padding:16px">' + h + '</div>'; }
  function showMsg(m) { setUI('<div style="text-align:center;padding:40px 0"><div style="font-size:28px;margin-bottom:10px">\u{1F9D8}</div><div style="font-size:14px;font-weight:600">' + m + '</div></div>'); }
  function close() { ov.remove(); }

  // Detect page
  var path = window.location.pathname;
  var isSearch = path.indexOf('/search-course/') > -1;
  var auto = sessionStorage.getItem('_ds_auto');

  if (isSearch && auto) {
    sessionStorage.removeItem('_ds_auto');
    runScraper();
  } else if (isSearch) {
    setUI(
      '<div style="text-align:center;padding:20px 0">' +
      '<div style="font-size:20px;margin-bottom:4px">\u{1F9D8}</div>' +
      '<div style="font-size:15px;font-weight:700;margin-bottom:16px">DIPI Scraper</div>' +
      btn('_ds-go', '#3b82f6', '\u{1F504} Scrape This Page') +
      btn('_ds-pick', '#475569', '\u{1F4CB} Pick Different Course') +
      btn('_ds-x', 'transparent', '\u2715 Cancel', '#94a3b8', '1px solid #475569') +
      '</div>'
    );
    document.getElementById('_ds-go').onclick = runScraper;
    document.getElementById('_ds-pick').onclick = pickCourse;
    document.getElementById('_ds-x').onclick = close;
  } else {
    pickCourse();
  }

  function btn(id, bg, label, color, border) {
    return '<button id="' + id + '" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:' + bg + ';color:' + (color || '#fff') + ';border:' + (border || 'none') + ';border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">' + label + '</button>';
  }

  // ═════════════════════════════════════
  // PHASE 1: Course Picker
  // ═════════════════════════════════════
  function pickCourse() {
    showMsg('Loading courses...');

    fetch(CENTRE_URL, { credentials: 'same-origin' })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');

        // Upcoming IDs from: div.summary-block > div.table-heading > a[href="/course/63/{id}"]
        var upIds = {};
        var upOrder = [];
        doc.querySelectorAll('div.summary-block div.table-heading a').forEach(function(a) {
          var m = (a.getAttribute('href') || '').match(/\/course\/\d+\/(\d+)/);
          if (m && !upIds[m[1]]) { upIds[m[1]] = true; upOrder.push(m[1]); }
        });

        // Counts from summary tables
        var counts = {};
        doc.querySelectorAll('div.summary-block').forEach(function(block) {
          var link = block.querySelector('div.table-heading a');
          if (!link) return;
          var m = (link.getAttribute('href') || '').match(/\/course\/\d+\/(\d+)/);
          if (!m) return;
          var exp = 0, conf = 0;
          block.querySelectorAll('tbody tr').forEach(function(tr) {
            var label = (tr.querySelector('td:first-child a') || {}).textContent || '';
            var tot = 0;
            tr.querySelectorAll('b a').forEach(function(ba) { tot += parseInt(ba.textContent) || 0; });
            if (label.trim() === 'Expected') exp = tot;
            if (label.trim() === 'Confirmed') conf = tot;
          });
          counts[m[1]] = { exp: exp, conf: conf };
        });

        // All courses from: select#edit-course option
        var all = [];
        doc.querySelectorAll('select#edit-course option').forEach(function(opt) {
          if (opt.value && opt.textContent.trim()) {
            all.push({ id: opt.value, title: opt.textContent.trim(), up: !!upIds[opt.value] });
          }
        });

        var upcoming = upOrder.map(function(id) { return all.find(function(c) { return c.id === id; }); }).filter(Boolean);
        var others = all.filter(function(c) { return !c.up; });

        if (all.length === 0) {
          setUI('<div style="text-align:center;padding:20px"><div style="font-size:24px;margin-bottom:8px">\u26A0\uFE0F</div><div style="font-size:14px;margin-bottom:12px">No courses found. Are you logged in?</div>' + btn('_ds-x', '#475569', '\u2715 Close') + '</div>');
          document.getElementById('_ds-x').onclick = close;
          return;
        }

        // Build UI
        var h = '<div style="text-align:center;margin-bottom:14px"><div style="font-size:20px;margin-bottom:2px">\u{1F9D8}</div><div style="font-size:15px;font-weight:700">Select Course</div><div style="font-size:11px;color:#94a3b8;margin-top:2px">Expected + Confirmed</div></div>';

        if (upcoming.length) {
          h += '<div style="font-size:10px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">\u{1F4C5} Upcoming</div>';
          upcoming.forEach(function(c, i) {
            var cnt = counts[c.id];
            var badges = cnt ? '<div style="display:flex;gap:6px;margin-top:4px">' +
              '<span style="font-size:10px;background:#f59e0b22;color:#f59e0b;padding:2px 6px;border-radius:4px">Exp ' + cnt.exp + '</span>' +
              '<span style="font-size:10px;background:#22c55e22;color:#22c55e;padding:2px 6px;border-radius:4px">Conf ' + cnt.conf + '</span>' +
              '<span style="font-size:10px;background:#3b82f622;color:#3b82f6;padding:2px 6px;border-radius:4px">\u03A3 ' + (cnt.exp + cnt.conf) + '</span></div>' : '';
            h += '<button class="_ds-c" data-id="' + c.id + '" style="display:block;width:100%;text-align:left;padding:12px 14px;margin-bottom:6px;background:' + (i === 0 ? '#1e3a5f' : '#1e293b') + ';border:' + (i === 0 ? '2px solid #3b82f6' : '1px solid #334155') + ';border-radius:10px;cursor:pointer;color:#fff">' +
              '<div style="font-size:13px;font-weight:600;line-height:1.3">' + c.title + '</div>' +
              (i === 0 ? '<div style="font-size:9px;color:#60a5fa;margin-top:2px;font-weight:700">NEXT UPCOMING</div>' : '') +
              badges + '</button>';
          });
        }

        if (others.length) {
          h += '<details style="margin-top:12px"><summary style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;cursor:pointer">\u{1F4C1} All Courses (' + others.length + ')</summary><div style="margin-top:6px">';
          others.forEach(function(c) {
            h += '<button class="_ds-c" data-id="' + c.id + '" style="display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:4px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;cursor:pointer;color:#94a3b8;font-size:12px">' + c.title + '</button>';
          });
          h += '</div></details>';
        }

        h += '<button id="_ds-x" style="display:block;width:100%;padding:12px;margin-top:12px;background:transparent;color:#64748b;border:1px solid #334155;border-radius:10px;font-size:13px;cursor:pointer">\u2715 Cancel</button>';
        setUI(h);

        document.querySelectorAll('._ds-c').forEach(function(b) {
          b.onclick = function() { goToCourse(this.dataset.id); };
        });
        document.getElementById('_ds-x').onclick = close;
      })
      .catch(function(e) {
        setUI('<div style="text-align:center;padding:20px"><div style="font-size:24px;margin-bottom:8px">\u274C</div><div style="font-size:14px;margin-bottom:4px">Failed: ' + e.message + '</div><div style="font-size:12px;color:#94a3b8;margin-bottom:12px">Are you logged in?</div>' + btn('_ds-x', '#475569', '\u2715 Close') + '</div>');
        document.getElementById('_ds-x').onclick = close;
      });
  }

  function goToCourse(id) {
    sessionStorage.setItem('_ds_auto', '1');
    showMsg('Navigating...');
    window.location.href = SEARCH_BASE + id + '?s=' + encodeURIComponent(STATUS_FILTER) + '&t=&g=';
  }

  // ═════════════════════════════════════
  // PHASE 2: Scrape Search Results
  // ═════════════════════════════════════
  function runScraper() {
    // Get title
    var title = '';
    var backLink = document.querySelector('a[href*="Back to Course"], a[href^="/course/' + CENTRE_ID + '/"]');
    if (backLink) title = backLink.textContent.trim();
    if (!title) title = (document.querySelector('h2') || {}).textContent || '';
    title = title.replace(/\s*\(Back to.*$/i, '').replace(/\s*\(Edit.*$/i, '').trim();
    if (!title || title.length < 5) title = document.title.replace(' | Dīpi', '').trim();

    showMsg('Starting...');

    (async function() {
      try {
        // Show All entries
        showMsg('Loading all entries...');
        var sel = document.querySelector('select[name$="_length"]');
        if (sel) {
          var hasAll = false;
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === '-1') { sel.value = '-1'; hasAll = true; break; }
          }
          if (!hasAll) {
            var opt = document.createElement('option');
            opt.value = '-1'; opt.text = 'All';
            sel.appendChild(opt); sel.value = '-1';
          }
          sel.dispatchEvent(new Event('change'));
          await wait(2500);
        }

        // ── Find main data rows ──
        // VERIFIED: main rows have class "odd" or "even" (DataTable alternating)
        // Detail rows have class "no-padding"
        // Sub-content rows have empty className
        var tbl = document.querySelector('table.dataTable') || document.querySelector('table');
        if (!tbl) { showMsg('No table found!'); return; }

        var allTr = tbl.querySelector('tbody').querySelectorAll('tr');
        var rows = [];
        for (var k = 0; k < allTr.length; k++) {
          var cl = allTr[k].className;
          // Main rows always have "odd" or "even" in className
          if (cl.indexOf('odd') > -1 || cl.indexOf('even') > -1) {
            rows.push(allTr[k]);
          }
        }

        if (rows.length === 0) { showMsg('No applicants found'); return; }
        showMsg('Found ' + rows.length + ' applicants...');

        var apps = [];

        for (var i = 0; i < rows.length; i++) {
          var tr = rows[i];
          progress(i + 1, rows.length);

          // ── Parse main row cells ──
          // Columns: Detail | Name (PDF) | Edu/Occ/Comp/Desig + course | Status | Type | Age | ChangeStatus | Action
          var cells = tr.querySelectorAll('td');
          var nm = '', st = '', ty = '', ag = '';

          for (var c = 0; c < cells.length; c++) {
            var tx = cells[c].textContent.trim();

            // Name: contains "(PDF)"
            if (tx.indexOf('(PDF)') > -1) {
              nm = tx.replace(/\(PDF\)/g, '').replace(/\s+/g, ' ').trim();
            }
            // Status: "Expected\n(OF1)" or "Confirmed\n(NM76)"
            if (/^(Expected|Confirmed|Cancelled|Received|Attended|Left)/i.test(tx) && !cells[c].querySelector('select')) {
              st = tx.replace(/\n.*/s, '').trim(); // take only first line before (code)
            }
            // Type: "Old\nFemale" or "New\nMale"
            if (/^(Old|New)\n?(Male|Female)$/im.test(tx)) {
              ty = tx.replace(/\n/g, ' ').trim();
            }
            // Age: 2-3 digit number
            if (/^\d{1,3}$/.test(tx) && +tx > 5 && +tx < 120) {
              ag = tx;
            }
          }

          // ── Expand row to get phone numbers ──
          // Click first td (the + icon). Row gets "shown" class added.
          var expandTd = tr.querySelector('td:first-child');
          var phoneText = '';

          if (expandTd) {
            expandTd.click();
            await wait(700);

            // VERIFIED: detail row is next sibling with class "no-padding"
            var nx = tr.nextElementSibling;
            if (nx && nx.classList.contains('no-padding')) {
              phoneText = nx.textContent || '';
            }

            // Collapse
            expandTd.click();
            await wait(150);
          }

          // ── Parse phone numbers ──
          // Format: "Address / H: 9536074750 M: 9536216216 O:  Email: foo@bar.com"
          var mob = '', hom = '', ofc = '', eml = '';
          var m1 = phoneText.match(/M:\s*(\d{7,15})/);
          var m2 = phoneText.match(/H:\s*(\d{7,15})/);
          var m3 = phoneText.match(/O:\s*(\d{7,15})/);
          var m4 = phoneText.match(/Email:\s*([^\s,]+@[^\s,]+)/);
          if (m1) mob = m1[1];
          if (m2) hom = m2[1];
          if (m3) ofc = m3[1];
          if (m4) eml = m4[1];

          if (nm) {
            apps.push({ name: nm, mobile: mob, home: hom, office: ofc, email: eml, status: st, type: ty, age: ag });
          }
        }

        showResults(apps, title);

      } catch (e) {
        showMsg('Error: ' + e.message);
        console.error(e);
      }
    })();
  }

  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function progress(cur, tot) {
    var pct = Math.round((cur / tot) * 100);
    setUI('<div style="text-align:center;padding:30px 0"><div style="font-size:14px;font-weight:600;margin-bottom:10px">\u{1F9D8} Reading ' + cur + ' / ' + tot + '</div><div style="background:#334155;border-radius:8px;height:8px;overflow:hidden;margin-bottom:6px"><div style="background:#3b82f6;height:100%;width:' + pct + '%;border-radius:8px;transition:width .3s"></div></div><div style="font-size:11px;color:#94a3b8">' + pct + '%</div></div>');
  }

  function showResults(apps, title) {
    var json = JSON.stringify(apps);
    var nExp = 0, nConf = 0, nM = 0, nF = 0;
    apps.forEach(function(a) {
      if (/Expected/i.test(a.status)) nExp++;
      if (/Confirmed/i.test(a.status)) nConf++;
      if (/Male/i.test(a.type) && !/Female/i.test(a.type)) nM++;
      if (/Female/i.test(a.type)) nF++;
    });

    var cleanTitle = title.replace(/Status:.*?,?\s*/i, '').replace(/Gender:.*$/i, '').trim();
    if (!cleanTitle || cleanTitle.length < 5) cleanTitle = 'Dhamma Sudha Course';

    setUI(
      '<div style="text-align:center;padding:16px 0">' +
      '<div style="font-size:24px;margin-bottom:6px">\u2705</div>' +
      '<div style="font-size:17px;font-weight:700">' + apps.length + ' applicants scraped</div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-top:2px;margin-bottom:14px">' + cleanTitle + '</div>' +
      '<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:18px">' +
      bdg('Expected', nExp, '#f59e0b') + bdg('Confirmed', nConf, '#22c55e') + bdg('Male', nM, '#3b82f6') + bdg('Female', nF, '#a855f7') + '</div>' +
      btn('_ds-t', '#3b82f6', '\u{1F4F1} Open in Call Tracker') +
      btn('_ds-cp', '#16a34a', '\u{1F4CB} Copy Data') +
      btn('_ds-csv', '#9333ea', '\u{1F4CA} Download CSV') +
      btn('_ds-x', 'transparent', '\u2715 Close', '#94a3b8', '1px solid #475569') +
      '</div>'
    );

    document.getElementById('_ds-t').onclick = function() {
      var data = { apps: apps, title: cleanTitle };
      var enc = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      if (PWA_URL) {
        window.open(PWA_URL + '/index.html#dipi=' + enc, '_blank');
      } else {
        navigator.clipboard.writeText(JSON.stringify(data)).then(function() {
          alert('PWA URL not set.\nData copied \u2014 open Call Tracker \u2192 Paste from DIPI');
        });
      }
    };

    document.getElementById('_ds-cp').onclick = function() {
      navigator.clipboard.writeText(json).then(function() {
        alert('Copied ' + apps.length + ' applicants!\nOpen Call Tracker \u2192 Paste from DIPI');
      });
    };

    document.getElementById('_ds-csv').onclick = function() {
      var csv = 'S.No,Name,Mobile,Home,Office,Email,Status,Type,Age\n';
      apps.forEach(function(a, i) {
        csv += (i + 1) + ',"' + a.name + '",' + a.mobile + ',' + a.home + ',' + a.office + ',' + a.email + ',"' + a.status + '","' + a.type + '",' + a.age + '\n';
      });
      var b = new Blob([csv], { type: 'text/csv' });
      var u = URL.createObjectURL(b);
      var l = document.createElement('a');
      l.href = u; l.download = 'dipi_' + cleanTitle.replace(/[^a-zA-Z0-9]/g, '_') + '.csv'; l.click();
      URL.revokeObjectURL(u);
    };

    document.getElementById('_ds-x').onclick = close;
  }

  function bdg(label, n, color) {
    return '<div style="background:' + color + '22;color:' + color + ';padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600">' + label + ' ' + n + '</div>';
  }

})();
