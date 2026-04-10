// ═══════════════════════════════════════════════════════════════
// DIPI Scraper v2 — Hosted script loaded by bookmarklet
// Handles: Course picker → Navigate → Scrape → Open Tracker
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── Config ──
  var CENTRE_ID = '63';
  var CENTRE_URL = '/centre/' + CENTRE_ID;
  var SEARCH_BASE = '/search-course/' + CENTRE_ID + '/';
  var STATUS_FILTER = 'Expected,Confirmed';
  // PWA URL is injected by setup.html into the bookmarklet loader
  var PWA_URL = window._DIPI_PWA_URL || '';

  // ── Cleanup previous instance ──
  var old = document.getElementById('_dipi-scraper');
  if (old) old.remove();

  // ── UI Shell ──
  var overlay = document.createElement('div');
  overlay.id = '_dipi-scraper';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch';
  document.body.appendChild(overlay);

  function setUI(html) { overlay.innerHTML = '<div style="width:100%;max-width:420px;padding:20px">' + html + '</div>'; }
  function showStatus(msg) { setUI('<div style="text-align:center;padding:40px 0"><div style="font-size:32px;margin-bottom:12px">\u{1F9D8}</div><div style="font-size:15px;font-weight:600">' + msg + '</div></div>'); }
  function closeOverlay() { overlay.remove(); }

  // ── Detect current page ──
  var path = window.location.pathname;
  var isSearchPage = path.indexOf('/search-course/') > -1;
  var hasAutoFlag = sessionStorage.getItem('_dipi_autoscrape');

  if (isSearchPage && hasAutoFlag) {
    // Phase 2: Auto-scrape the search results page
    sessionStorage.removeItem('_dipi_autoscrape');
    runScraper();
  } else if (isSearchPage) {
    // On search page but no flag — ask what to do
    setUI(
      '<div style="text-align:center;padding:20px 0">' +
      '<div style="font-size:24px;margin-bottom:8px">\u{1F9D8}</div>' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:16px">DIPI Scraper</div>' +
      '<button id="_ds-scrape" style="display:block;width:100%;padding:14px;margin-bottom:10px;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F504} Scrape This Page</button>' +
      '<button id="_ds-pick" style="display:block;width:100%;padding:14px;margin-bottom:10px;background:#475569;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F4CB} Pick Different Course</button>' +
      '<button id="_ds-close" style="display:block;width:100%;padding:12px;background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:10px;font-size:14px;cursor:pointer">\u2715 Cancel</button>' +
      '</div>'
    );
    document.getElementById('_ds-scrape').onclick = runScraper;
    document.getElementById('_ds-pick').onclick = showCoursePicker;
    document.getElementById('_ds-close').onclick = closeOverlay;
  } else {
    // Phase 1: Show course picker
    showCoursePicker();
  }

  // ═══════════════════════════════════════════
  // PHASE 1: Fetch courses and show picker
  // ═══════════════════════════════════════════
  function showCoursePicker() {
    showStatus('Loading courses...');

    fetch(CENTRE_URL, { credentials: 'same-origin' })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        // Find "Upcoming Courses" section
        // Look for course summary tables or course links
        var courses = [];

        // Strategy 1: Find links to /search-course/ or /course/ pages
        var links = doc.querySelectorAll('a[href]');
        var seenIds = {};
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href');
          if (!href) continue;

          // Match course detail links like /course/63/66875 or similar
          var m = href.match(/\/course\/\d+\/(\d+)/);
          if (m && !seenIds[m[1]]) {
            seenIds[m[1]] = true;
            var text = links[i].textContent.trim();
            if (text && text.length > 5) {
              courses.push({ id: m[1], title: text, href: href });
            }
          }
        }

        // Strategy 2: Parse course headers from upcoming section
        if (courses.length === 0) {
          // Look for text like "Dhamma Sudha / 10 Day / 2026 / ..."
          var allText = doc.body.innerHTML;
          var headerPattern = /Dhamma\s+Sudha\s*\/[^<]+/gi;
          var matches = allText.match(headerPattern);
          if (matches) {
            // Try to find associated course IDs from nearby links
            var allLinks = doc.querySelectorAll('a[href*="search-course"], a[href*="/course/"]');
            for (var j = 0; j < allLinks.length; j++) {
              var h = allLinks[j].getAttribute('href');
              var cm = h.match(/\/(\d{4,6})/g);
              if (cm && cm.length >= 2) {
                var cid = cm[cm.length - 1].replace('/', '');
                if (!seenIds[cid]) {
                  seenIds[cid] = true;
                  courses.push({ id: cid, title: allLinks[j].textContent.trim() || h, href: h });
                }
              }
            }
          }
        }

        // Strategy 3: Look for course IDs in form actions, onclick handlers, etc.
        if (courses.length === 0) {
          var forms = doc.querySelectorAll('form[action*="course"], [onclick*="course"]');
          // Also try to find course data in script tags
          var scripts = doc.querySelectorAll('script');
          for (var s = 0; s < scripts.length; s++) {
            var sc = scripts[s].textContent;
            var courseMatches = sc.match(/course[_\-]?id['":\s]*(\d{4,6})/gi);
            if (courseMatches) {
              courseMatches.forEach(function(cm) {
                var idm = cm.match(/(\d{4,6})/);
                if (idm && !seenIds[idm[1]]) {
                  seenIds[idm[1]] = true;
                  courses.push({ id: idm[1], title: 'Course ' + idm[1], href: '' });
                }
              });
            }
          }
        }

        // Strategy 4: Parse the visible tables for course titles and find associated IDs
        // The dashboard has tables with course names as headers
        var h4s = doc.querySelectorAll('h4, h3, h5, strong, b');
        for (var hh = 0; hh < h4s.length; hh++) {
          var ht = h4s[hh].textContent.trim();
          if (ht.match(/Dhamma.*\d{4}.*\w+-\w+/i) || ht.match(/\d+\s*Day.*\d{4}/i)) {
            // Found a course title, look for nearby links
            var parent = h4s[hh].closest('div') || h4s[hh].parentElement;
            if (parent) {
              var nearbyLinks = parent.querySelectorAll('a[href*="course"]');
              for (var nl = 0; nl < nearbyLinks.length; nl++) {
                var nlh = nearbyLinks[nl].getAttribute('href');
                var nlm = nlh.match(/(\d{4,6})/g);
                if (nlm) {
                  var nid = nlm[nlm.length - 1];
                  if (!seenIds[nid] && nid.length >= 4) {
                    seenIds[nid] = true;
                    courses.push({ id: nid, title: ht, href: nlh });
                  }
                }
              }
            }
          }
        }

        // Deduplicate and clean titles
        var seen = {};
        courses = courses.filter(function(c) {
          if (seen[c.id]) return false;
          seen[c.id] = true;
          c.title = c.title.replace(/\s+/g, ' ').trim();
          return c.title.length > 3;
        });

        if (courses.length === 0) {
          setUI(
            '<div style="text-align:center;padding:20px 0">' +
            '<div style="font-size:28px;margin-bottom:12px">\u26A0\uFE0F</div>' +
            '<div style="font-size:15px;font-weight:600;margin-bottom:8px">No courses found</div>' +
            '<div style="font-size:13px;color:#94a3b8;margin-bottom:16px">Make sure you\'re logged into DIPI. Try navigating to the centre dashboard first.</div>' +
            '<div style="font-size:12px;color:#64748b;margin-bottom:16px">Current page: ' + window.location.pathname + '</div>' +
            '<input id="_ds-manual" type="text" placeholder="Enter course ID manually (e.g. 66875)" style="width:100%;padding:10px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:#fff;font-size:14px;margin-bottom:10px">' +
            '<button id="_ds-mgo" style="display:block;width:100%;padding:12px;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Go to Course</button>' +
            '<button id="_ds-close" style="display:block;width:100%;padding:12px;margin-top:8px;background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:10px;font-size:14px;cursor:pointer">\u2715 Cancel</button>' +
            '</div>'
          );
          document.getElementById('_ds-mgo').onclick = function() {
            var cid = document.getElementById('_ds-manual').value.trim();
            if (cid) navigateToCourse(cid);
          };
          document.getElementById('_ds-close').onclick = closeOverlay;
          return;
        }

        // Show picker
        var pickerHtml = '<div style="text-align:center;margin-bottom:16px">' +
          '<div style="font-size:24px;margin-bottom:4px">\u{1F9D8}</div>' +
          '<div style="font-size:16px;font-weight:700">Select Course</div>' +
          '<div style="font-size:12px;color:#94a3b8;margin-top:2px">Will fetch Expected + Confirmed applicants</div></div>';

        courses.forEach(function(c, idx) {
          var isFirst = idx === 0;
          pickerHtml += '<button class="_ds-course" data-cid="' + c.id + '" style="display:block;width:100%;text-align:left;padding:14px 16px;margin-bottom:8px;' +
            'background:' + (isFirst ? '#1e3a5f' : '#1e293b') + ';border:' + (isFirst ? '2px solid #3b82f6' : '1px solid #334155') + ';border-radius:12px;cursor:pointer;color:#fff">' +
            '<div style="font-size:13px;font-weight:600;line-height:1.3">' + c.title + '</div>' +
            (isFirst ? '<div style="font-size:10px;color:#60a5fa;margin-top:4px;font-weight:600">NEXT UPCOMING</div>' : '') +
            '<div style="font-size:10px;color:#64748b;margin-top:2px">ID: ' + c.id + '</div></button>';
        });

        pickerHtml += '<button id="_ds-close" style="display:block;width:100%;padding:12px;margin-top:4px;background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:10px;font-size:14px;cursor:pointer">\u2715 Cancel</button>';

        setUI(pickerHtml);

        // Bind course buttons
        var btns = document.querySelectorAll('._ds-course');
        for (var b = 0; b < btns.length; b++) {
          btns[b].onclick = function() { navigateToCourse(this.getAttribute('data-cid')); };
        }
        document.getElementById('_ds-close').onclick = closeOverlay;
      })
      .catch(function(err) {
        setUI(
          '<div style="text-align:center;padding:20px">' +
          '<div style="font-size:28px;margin-bottom:12px">\u274C</div>' +
          '<div style="font-size:15px;margin-bottom:8px">Failed to load courses</div>' +
          '<div style="font-size:12px;color:#94a3b8;margin-bottom:12px">' + err.message + '</div>' +
          '<div style="font-size:12px;color:#94a3b8;margin-bottom:16px">Are you logged into DIPI?</div>' +
          '<button id="_ds-close" style="padding:12px 24px;background:#475569;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer">\u2715 Close</button></div>'
        );
        document.getElementById('_ds-close').onclick = closeOverlay;
      });
  }

  function navigateToCourse(courseId) {
    sessionStorage.setItem('_dipi_autoscrape', '1');
    var url = SEARCH_BASE + courseId + '?s=' + encodeURIComponent(STATUS_FILTER) + '&t=&g=';
    showStatus('Navigating to course...');
    window.location.href = url;
  }

  // ═══════════════════════════════════════════
  // PHASE 2: Scrape the search results page
  // ═══════════════════════════════════════════
  function runScraper() {
    showStatus('Starting scrape...');

    // Extract course title from page
    var pageTitle = '';
    var h2 = document.querySelector('h2, h1');
    if (h2) pageTitle = h2.textContent.trim();
    if (!pageTitle) {
      // Try to get from breadcrumb or URL
      var urlMatch = window.location.pathname.match(/\/(\d+)\?/);
      pageTitle = 'Course ' + (urlMatch ? urlMatch[1] : 'Unknown');
    }

    (async function() {
      try {
        // Step 1: Show All entries
        showStatus('Loading all entries...');
        var sel = document.querySelector('select[name$="_length"]');
        if (sel) {
          var found = false;
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === '-1') { sel.value = '-1'; found = true; break; }
          }
          if (!found) {
            var opt = document.createElement('option');
            opt.value = '-1'; opt.text = 'All';
            sel.appendChild(opt); sel.value = '-1';
          }
          sel.dispatchEvent(new Event('change'));
          await wait(2500);
        }

        // Step 2: Find all main rows
        showStatus('Scanning table...');
        var tbl = document.querySelector('table.dataTable') || document.querySelector('table');
        if (!tbl) { showStatus('Error: No table found!'); return; }

        var trs = tbl.querySelector('tbody').querySelectorAll('tr');
        var rows = [];
        for (var k = 0; k < trs.length; k++) {
          var tr = trs[k];
          if (!tr.classList.contains('child') && !tr.classList.contains('detail-row') && tr.querySelector('td')) {
            rows.push(tr);
          }
        }

        showStatus('Found ' + rows.length + ' applicants. Expanding details...');
        var apps = [];

        // Step 3: Expand each row and scrape
        for (var i = 0; i < rows.length; i++) {
          var tr = rows[i];
          updateProgress(i + 1, rows.length);

          // Parse main row cells
          var cells = tr.querySelectorAll('td');
          var nm = '', st = '', ty = '', ag = '';

          for (var c = 0; c < cells.length; c++) {
            var tx = cells[c].textContent.trim();
            if (tx.indexOf('(PDF)') > -1) nm = tx.replace('(PDF)', '').replace(/\s+/g, ' ').trim();
            if (/Expected|Confirmed|Cancelled|Applied/i.test(tx) && !cells[c].querySelector('select')) st = tx;
            if (/^(Old|New)\s*(Male|Female)$/i.test(tx)) ty = tx;
            if (/^\d{1,3}$/.test(tx) && +tx > 5 && +tx < 120) ag = tx;
          }

          // Click expand button
          var btn = tr.querySelector('td:first-child');
          var dt = '';
          if (btn) {
            btn.click();
            await wait(700);
            var nx = tr.nextElementSibling;
            if (nx) dt = nx.textContent || '';
            btn.click();
            await wait(150);
          }

          // Parse phone numbers from expanded detail
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

        // Step 4: Show results
        showResults(apps, pageTitle);

      } catch (e) {
        showStatus('Error: ' + e.message);
      }
    })();
  }

  function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function updateProgress(current, total) {
    var pct = Math.round((current / total) * 100);
    setUI(
      '<div style="text-align:center;padding:30px 0">' +
      '<div style="font-size:15px;font-weight:600;margin-bottom:12px">\u{1F9D8} Reading ' + current + ' / ' + total + '</div>' +
      '<div style="background:#334155;border-radius:8px;height:8px;overflow:hidden;margin-bottom:8px"><div style="background:#3b82f6;height:100%;width:' + pct + '%;border-radius:8px;transition:width .3s"></div></div>' +
      '<div style="font-size:12px;color:#94a3b8">' + pct + '% complete</div></div>'
    );
  }

  function showResults(apps, title) {
    var json = JSON.stringify(apps);
    var enc = btoa(unescape(encodeURIComponent(json)));

    setUI(
      '<div style="text-align:center;padding:20px 0">' +
      '<div style="font-size:28px;margin-bottom:8px">\u2705</div>' +
      '<div style="font-size:18px;font-weight:700;margin-bottom:4px">' + apps.length + ' applicants scraped!</div>' +
      '<div style="font-size:12px;color:#94a3b8;margin-bottom:20px">' + title + '</div>' +

      // Stats
      '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:20px;flex-wrap:wrap">' +
      statBadge('Expected', apps.filter(function(a) { return /Expected/i.test(a.status); }).length, '#ea580c') +
      statBadge('Confirmed', apps.filter(function(a) { return /Confirmed/i.test(a.status); }).length, '#16a34a') +
      statBadge('Male', apps.filter(function(a) { return /Male/i.test(a.type); }).length, '#3b82f6') +
      statBadge('Female', apps.filter(function(a) { return /Female/i.test(a.type); }).length, '#a855f7') +
      '</div>' +

      // Action buttons
      '<button id="_ds-tracker" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:#3b82f6;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F4F1} Open in Call Tracker</button>' +
      '<button id="_ds-copy" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:#16a34a;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F4CB} Copy Data to Clipboard</button>' +
      '<button id="_ds-csv" style="display:block;width:100%;padding:14px;margin-bottom:8px;background:#9333ea;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">\u{1F4CA} Download CSV</button>' +
      '<button id="_ds-close" style="display:block;width:100%;padding:12px;background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:10px;font-size:14px;cursor:pointer">\u2715 Close</button>' +
      '</div>'
    );

    // Open in Tracker
    document.getElementById('_ds-tracker').onclick = function() {
      if (!PWA_URL) {
        alert('PWA URL not configured. Use "Copy Data" instead, then paste in the Call Tracker app.');
        return;
      }
      // Try to clean the title for the tracker
      var cleanTitle = title.replace(/_/g, ' ').replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1');
      var data = { apps: apps, title: cleanTitle };
      var dataEnc = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      window.open(PWA_URL + '/index.html#dipi=' + dataEnc, '_blank');
    };

    // Copy to clipboard
    document.getElementById('_ds-copy').onclick = function() {
      navigator.clipboard.writeText(json).then(function() {
        alert('Copied ' + apps.length + ' applicants!\n\nOpen Call Tracker \u2192 Paste from DIPI');
      });
    };

    // Download CSV
    document.getElementById('_ds-csv').onclick = function() {
      var csv = 'S.No,Name,Mobile,Home,Office,Email,Status,Type,Age\n';
      apps.forEach(function(a, i) {
        csv += (i + 1) + ',"' + a.name + '",' + a.mobile + ',' + a.home + ',' + a.office + ',' + a.email + ',"' + a.status + '","' + a.type + '",' + a.age + '\n';
      });
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = 'dipi_export.csv'; link.click();
      URL.revokeObjectURL(url);
    };

    document.getElementById('_ds-close').onclick = closeOverlay;
  }

  function statBadge(label, count, color) {
    return '<div style="background:' + color + '22;color:' + color + ';padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600">' + label + ' ' + count + '</div>';
  }

})();
