// ═══════════════════════════════════════════════════════════════
// DIPI Scraper v3 — Based on actual DIPI source HTML structure
// Drupal 7 site · jQuery DataTables · Bootstrap 3
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var CENTRE_ID = '63';
  var CENTRE_URL = '/centre/' + CENTRE_ID;
  var SEARCH_BASE = '/search-course/' + CENTRE_ID + '/';
  var STATUS_FILTER = 'Expected,Confirmed';
  var PWA_URL = window._DIPI_PWA_URL || '';

  // Cleanup previous instance
  var old = document.getElementById('_ds');
  if (old) old.remove();

  // ── UI Shell ──
  var overlay = document.createElement('div');
  overlay.id = '_ds';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch';
  document.body.appendChild(overlay);

  function setUI(html) {
    overlay.innerHTML = '<div style="width:100%;max-width:420px;padding:16px">' + html + '</div>';
  }
  function showStatus(msg) {
    setUI('<div style="text-align:center;padding:40px 0"><div style="font-size:28px;margin-bottom:10px">\u{1F9D8}</div><div style="font-size:14px;font-weight:600">' + msg + '</div></div>');
  }

  // ── Detect page ──
  var path = window.location.pathname;
  var isSearchPage = path.indexOf('/search-course/') > -1;
  var autoScrape = sessionStorage.getItem('_ds_auto');

  if (isSearchPage && autoScrape) {
    sessionStorage.removeItem('_ds_auto');
    runScraper();
  } else if (isSearchPage) {
    setUI(
      '<div style="text-align:center;padding:20px 0">' +
      '<div style="font-size:20px;margin-bottom:4px">\u{1F9D8}</div>' +
      '<div style="font-size:15px;font-weight:700;margin-bottom:16px">DIPI Scraper</div>' +
      '<button id="_ds-go" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F504} Scrape This Page</button>' +
      '<button id="_ds-pick" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:#475569;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F4CB} Pick Different Course</button>' +
      '<button id="_ds-x" style="display:block;width:100%;padding:12px;background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:10px;font-size:14px;cursor:pointer">\u2715 Cancel</button>' +
      '</div>'
    );
    document.getElementById('_ds-go').onclick = runScraper;
    document.getElementById('_ds-pick').onclick = showCoursePicker;
    document.getElementById('_ds-x').onclick = function() { overlay.remove(); };
  } else {
    showCoursePicker();
  }

  // ═════════════════════════════════════
  // PHASE 1: Course Picker
  // ═════════════════════════════════════
  function showCoursePicker() {
    showStatus('Loading courses...');

    fetch(CENTRE_URL, { credentials: 'same-origin' })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // ── Get upcoming course IDs from summary-block headings ──
        // Structure: div.summary-block > div.table-heading > a[href="/course/63/{id}"]
        var upcomingIds = {};
        var upcomingOrder = [];
        var headings = doc.querySelectorAll('div.summary-block div.table-heading a');
        for (var h = 0; h < headings.length; h++) {
          var href = headings[h].getAttribute('href') || '';
          var m = href.match(/\/course\/\d+\/(\d+)/);
          if (m) {
            upcomingIds[m[1]] = true;
            upcomingOrder.push(m[1]);
          }
        }

        // ── Get Expected + Confirmed counts from summary tables ──
        var courseCounts = {};
        var blocks = doc.querySelectorAll('div.summary-block');
        for (var b = 0; b < blocks.length; b++) {
          var headingLink = blocks[b].querySelector('div.table-heading a');
          if (!headingLink) continue;
          var idMatch = (headingLink.getAttribute('href') || '').match(/\/course\/\d+\/(\d+)/);
          if (!idMatch) continue;
          var cid = idMatch[1];

          // Find Expected and Confirmed rows in the summary table
          var countExp = 0, countConf = 0;
          var tds = blocks[b].querySelectorAll('tbody tr td:first-child a');
          for (var t = 0; t < tds.length; t++) {
            var text = tds[t].textContent.trim();
            var row = tds[t].closest('tr');
            if (!row) continue;
            // The "Total" column (bold) for both M and F
            var bolds = row.querySelectorAll('b a');
            var total = 0;
            for (var bb = 0; bb < bolds.length; bb++) {
              total += parseInt(bolds[bb].textContent) || 0;
            }
            if (text === 'Expected') countExp = total;
            if (text === 'Confirmed') countConf = total;
          }
          courseCounts[cid] = { expected: countExp, confirmed: countConf, total: countExp + countConf };
        }

        // ── Get ALL courses from select#edit-course dropdown ──
        var allCourses = [];
        var opts = doc.querySelectorAll('select#edit-course option');
        for (var o = 0; o < opts.length; o++) {
          var val = opts[o].value;
          var label = opts[o].textContent.trim();
          if (val && label) {
            allCourses.push({ id: val, title: label, upcoming: !!upcomingIds[val] });
          }
        }

        // Separate upcoming and other courses
        var upcoming = [];
        // Maintain order from summary blocks
        for (var u = 0; u < upcomingOrder.length; u++) {
          var uc = allCourses.find(function(c) { return c.id === upcomingOrder[u]; });
          if (uc) upcoming.push(uc);
        }
        var others = allCourses.filter(function(c) { return !c.upcoming; });

        if (allCourses.length === 0) {
          setUI(
            '<div style="text-align:center;padding:20px">' +
            '<div style="font-size:24px;margin-bottom:8px">\u26A0\uFE0F</div>' +
            '<div style="font-size:14px;margin-bottom:12px">No courses found. Are you logged in?</div>' +
            '<button id="_ds-x" style="padding:12px 24px;background:#475569;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer">\u2715 Close</button></div>'
          );
          document.getElementById('_ds-x').onclick = function() { overlay.remove(); };
          return;
        }

        // ── Build picker UI ──
        var pickerHtml = '<div style="text-align:center;margin-bottom:14px">' +
          '<div style="font-size:20px;margin-bottom:2px">\u{1F9D8}</div>' +
          '<div style="font-size:15px;font-weight:700">Select Course</div>' +
          '<div style="font-size:11px;color:#94a3b8;margin-top:2px">Fetches Expected + Confirmed applicants</div></div>';

        if (upcoming.length > 0) {
          pickerHtml += '<div style="font-size:10px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">\u{1F4C5} Upcoming Courses</div>';
          upcoming.forEach(function(c, idx) {
            var cnt = courseCounts[c.id];
            var badge = cnt ? '<div style="display:flex;gap:6px;margin-top:4px">' +
              '<span style="font-size:10px;background:#f59e0b22;color:#f59e0b;padding:2px 6px;border-radius:4px">Exp ' + cnt.expected + '</span>' +
              '<span style="font-size:10px;background:#22c55e22;color:#22c55e;padding:2px 6px;border-radius:4px">Conf ' + cnt.confirmed + '</span>' +
              '<span style="font-size:10px;background:#3b82f622;color:#3b82f6;padding:2px 6px;border-radius:4px">Total ' + cnt.total + '</span></div>' : '';
            pickerHtml += '<button class="_ds-c" data-cid="' + c.id + '" style="display:block;width:100%;text-align:left;padding:12px 14px;margin-bottom:6px;' +
              'background:' + (idx === 0 ? '#1e3a5f' : '#1e293b') + ';border:' + (idx === 0 ? '2px solid #3b82f6' : '1px solid #334155') + ';border-radius:10px;cursor:pointer;color:#fff">' +
              '<div style="font-size:13px;font-weight:600;line-height:1.3">' + c.title + '</div>' +
              (idx === 0 ? '<div style="font-size:9px;color:#60a5fa;margin-top:2px;font-weight:700">NEXT UPCOMING</div>' : '') +
              badge + '</button>';
          });
        }

        if (others.length > 0) {
          pickerHtml += '<details style="margin-top:12px"><summary style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;cursor:pointer;margin-bottom:6px">\u{1F4C1} All Courses (' + others.length + ')</summary><div style="margin-top:6px">';
          others.forEach(function(c) {
            pickerHtml += '<button class="_ds-c" data-cid="' + c.id + '" style="display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:4px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;cursor:pointer;color:#94a3b8;font-size:12px">' + c.title + '</button>';
          });
          pickerHtml += '</div></details>';
        }

        pickerHtml += '<button id="_ds-x" style="display:block;width:100%;padding:12px;margin-top:12px;background:transparent;color:#64748b;border:1px solid #334155;border-radius:10px;font-size:13px;cursor:pointer">\u2715 Cancel</button>';

        setUI(pickerHtml);

        // Bind
        var btns = document.querySelectorAll('._ds-c');
        for (var i = 0; i < btns.length; i++) {
          btns[i].onclick = function() { navigateToCourse(this.getAttribute('data-cid')); };
        }
        document.getElementById('_ds-x').onclick = function() { overlay.remove(); };
      })
      .catch(function(err) {
        setUI(
          '<div style="text-align:center;padding:20px">' +
          '<div style="font-size:24px;margin-bottom:8px">\u274C</div>' +
          '<div style="font-size:14px;margin-bottom:4px">Failed to load dashboard</div>' +
          '<div style="font-size:12px;color:#94a3b8;margin-bottom:12px">' + err.message + '</div>' +
          '<button id="_ds-x" style="padding:12px 24px;background:#475569;color:#fff;border:none;border-radius:10px;cursor:pointer">\u2715 Close</button></div>'
        );
        document.getElementById('_ds-x').onclick = function() { overlay.remove(); };
      });
  }

  function navigateToCourse(courseId) {
    sessionStorage.setItem('_ds_auto', '1');
    showStatus('Navigating to course...');
    window.location.href = SEARCH_BASE + courseId + '?s=' + encodeURIComponent(STATUS_FILTER) + '&t=&g=';
  }

  // ═════════════════════════════════════
  // PHASE 2: Scrape search results
  // ═════════════════════════════════════
  function runScraper() {
    // Get page title from the status line at top
    // Structure: "Status: Expected, Gender: FemaleOld (Back to Course) ..."
    // Or from the <h2> or page heading
    var pageTitle = '';
    var h2 = document.querySelector('h2');
    if (h2) pageTitle = h2.textContent.trim();
    // Better: try to get from the "Back to Course" link context or URL
    var backLink = document.querySelector('a[href^="/course/' + CENTRE_ID + '/"]');
    if (backLink) {
      pageTitle = backLink.textContent.trim() || pageTitle;
    }
    if (!pageTitle || pageTitle.length < 5) {
      pageTitle = document.title.replace(' | Dīpi', '').trim();
    }

    showStatus('Starting scrape...');

    (async function() {
      try {
        // Step 1: Show All entries
        // DataTable "Show X entries" is: select[name$="_length"]
        showStatus('Loading all entries...');
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

        // Step 2: Find main rows
        // DataTable: table.dataTable tbody tr (excluding .child and .detail-row)
        showStatus('Scanning table...');
        var tbl = document.querySelector('table.dataTable') || document.querySelector('#DataTables_Table_0') || document.querySelector('table');
        if (!tbl) { showStatus('Error: No table found!'); return; }

        var trs = tbl.querySelector('tbody').querySelectorAll('tr');
        var rows = [];
        for (var k = 0; k < trs.length; k++) {
          var tr = trs[k];
          if (tr.classList.contains('child') || tr.classList.contains('detail-row')) continue;
          if (!tr.querySelector('td')) continue;
          rows.push(tr);
        }

        if (rows.length === 0) {
          showStatus('No applicants found on this page');
          return;
        }

        showStatus('Found ' + rows.length + '. Expanding details...');
        var apps = [];

        // Step 3: Expand each row and scrape
        // Table columns: Detail | Applicant Name (PDF) | Edu/Occ/Comp/Desig + course info | Status | Type | Age | ChangeStatus | Action
        for (var i = 0; i < rows.length; i++) {
          var tr = rows[i];
          updateProgress(i + 1, rows.length);

          var cells = tr.querySelectorAll('td');
          var nm = '', st = '', ty = '', ag = '';

          for (var c = 0; c < cells.length; c++) {
            var tx = cells[c].textContent.trim();

            // Name cell: contains "(PDF)" text
            if (tx.indexOf('(PDF)') > -1) {
              nm = tx.replace(/\(PDF\)/g, '').replace(/\s+/g, ' ').trim();
            }
            // Status cell: "Expected (OF1)" or "Confirmed (NM5)"
            // Has format "Status\n(CODE)" - match but not inside a select
            if (/^(Expected|Confirmed|Cancelled|Applied|Attended|Left)/i.test(tx) && !cells[c].querySelector('select')) {
              st = tx.split('\n')[0].replace(/\(.*\)/, '').trim();
            }
            // Type cell: "Old Female", "New Male", "Old\nFemale"
            if (/^(Old|New)\s*(Male|Female)$/im.test(tx.replace(/\n/g, ' '))) {
              ty = tx.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            }
            // Age cell: pure number 1-120
            if (/^\d{1,3}$/.test(tx) && +tx > 5 && +tx < 120) {
              ag = tx;
            }
          }

          // Click the expand (+) button in first cell
          // The detail toggle is td:first-child or td.details-control
          var expandCell = tr.querySelector('td:first-child');
          var dt = '';
          if (expandCell) {
            expandCell.click();
            await wait(700);

            // Detail row appears as next sibling
            // Format: "Address / H: 9536074750 M: 9536216216 O:  Email: mail@example.com"
            var nx = tr.nextElementSibling;
            if (nx && !nx.querySelector('td.details-control') && nx !== rows[i + 1]) {
              dt = nx.textContent || '';
            }

            // Collapse
            expandCell.click();
            await wait(150);
          }

          // Parse phones from detail text
          // Pattern: "H: 9536074750 M: 9536216216 O:  Email: ..."
          var mob = '', hom = '', ofc = '', eml = '';
          var m1 = dt.match(/M:\s*(\d{7,15})/);
          var m2 = dt.match(/H:\s*(\d{7,15})/);
          var m3 = dt.match(/O:\s*(\d{7,15})/);
          var m4 = dt.match(/Email:\s*([^\s,]+@[^\s,]+)/);
          if (m1) mob = m1[1];
          if (m2) hom = m2[1];
          if (m3) ofc = m3[1];
          if (m4) eml = m4[1];

          if (nm) {
            apps.push({ name: nm, mobile: mob, home: hom, office: ofc, email: eml, status: st, type: ty, age: ag });
          }
        }

        showResults(apps, pageTitle);

      } catch (e) {
        showStatus('Error: ' + e.message);
        console.error(e);
      }
    })();
  }

  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function updateProgress(cur, total) {
    var pct = Math.round((cur / total) * 100);
    setUI(
      '<div style="text-align:center;padding:30px 0">' +
      '<div style="font-size:14px;font-weight:600;margin-bottom:10px">\u{1F9D8} Reading ' + cur + ' / ' + total + '</div>' +
      '<div style="background:#334155;border-radius:8px;height:8px;overflow:hidden;margin-bottom:6px"><div style="background:#3b82f6;height:100%;width:' + pct + '%;border-radius:8px;transition:width .3s"></div></div>' +
      '<div style="font-size:11px;color:#94a3b8">' + pct + '%</div></div>'
    );
  }

  function showResults(apps, title) {
    var json = JSON.stringify(apps);

    // Stats
    var nExp = 0, nConf = 0, nM = 0, nF = 0;
    apps.forEach(function(a) {
      if (/Expected/i.test(a.status)) nExp++;
      if (/Confirmed/i.test(a.status)) nConf++;
      if (/Male/i.test(a.type) && !/Female/i.test(a.type)) nM++;
      if (/Female/i.test(a.type)) nF++;
    });

    setUI(
      '<div style="text-align:center;padding:16px 0">' +
      '<div style="font-size:24px;margin-bottom:6px">\u2705</div>' +
      '<div style="font-size:17px;font-weight:700">' + apps.length + ' applicants scraped</div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-top:2px;margin-bottom:14px">' + title + '</div>' +

      '<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:18px">' +
      badge('Expected', nExp, '#f59e0b') + badge('Confirmed', nConf, '#22c55e') +
      badge('Male', nM, '#3b82f6') + badge('Female', nF, '#a855f7') + '</div>' +

      '<button id="_ds-tracker" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F4F1} Open in Call Tracker</button>' +
      '<button id="_ds-copy" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:#16a34a;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F4CB} Copy Data to Clipboard</button>' +
      '<button id="_ds-csv" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:#9333ea;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F4CA} Download CSV</button>' +
      '<button id="_ds-x" style="display:block;width:100%;padding:12px;background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:10px;font-size:14px;cursor:pointer">\u2715 Close</button>' +
      '</div>'
    );

    // Clean title for tracker
    var cleanTitle = title.replace(/_/g, ' ').replace(/Status:.*?,?\s*/i, '').replace(/Gender:.*$/i, '').trim();
    if (!cleanTitle || cleanTitle.length < 5) cleanTitle = 'Dhamma Sudha Course';

    document.getElementById('_ds-tracker').onclick = function() {
      var data = { apps: apps, title: cleanTitle };
      var enc = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      if (PWA_URL) {
        window.open(PWA_URL + '/index.html#dipi=' + enc, '_blank');
      } else {
        // No PWA URL configured — copy to clipboard instead
        navigator.clipboard.writeText(JSON.stringify(data)).then(function() {
          alert('PWA URL not set. Data copied to clipboard.\n\nOpen your Call Tracker app and use "Paste from DIPI".');
        });
      }
    };

    document.getElementById('_ds-copy').onclick = function() {
      navigator.clipboard.writeText(json).then(function() {
        alert('Copied ' + apps.length + ' applicants!\n\nOpen Call Tracker \u2192 Paste from DIPI');
      });
    };

    document.getElementById('_ds-csv').onclick = function() {
      var csv = 'S.No,Name,Mobile,Home,Office,Email,Status,Type,Age\n';
      apps.forEach(function(a, i) {
        csv += (i + 1) + ',"' + a.name + '",' + a.mobile + ',' + a.home + ',' + a.office + ',' + a.email + ',"' + a.status + '","' + a.type + '",' + a.age + '\n';
      });
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = 'dipi_' + cleanTitle.replace(/[^a-zA-Z0-9]/g, '_') + '.csv';
      link.click();
      URL.revokeObjectURL(url);
    };

    document.getElementById('_ds-x').onclick = function() { overlay.remove(); };
  }

  function badge(label, count, color) {
    return '<div style="background:' + color + '22;color:' + color + ';padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600">' + label + ' ' + count + '</div>';
  }

})();
