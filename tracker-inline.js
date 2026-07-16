// ═══════════════════════════════════════════════════════════════
// DIPI Inline Call Tracker
// Renders the calling dashboard as a full-screen overlay on
// dipi.vridhamma.org instead of navigating to the hosted PWA.
//
// API:
//   window.DipiTracker.open()                  — show last session
//   window.DipiTracker.import(apps, title, dates, courseType)
//                                              — create new session from scrape
//
// Storage: IndexedDB at the dipi.vridhamma.org origin (separate from PWA storage).
// ═══════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  if (root.DipiTracker) return; // idempotent

  const STATUSES = {
    pending:      { label: 'Pending',    icon: '⏳', color: '#94a3b8', bg: '#f1f5f9' },
    confirmed:    { label: 'Confirmed',  icon: '✅', color: '#3d8b62', bg: '#f0f6f2' },
    cancelled:    { label: 'Cancelled',  icon: '❌', color: '#b35f5f', bg: '#f8f0f0' },
    no_answer:    { label: 'No Answer',  icon: '📵', color: '#b07a4d', bg: '#f8f3ed' },
    callback:     { label: 'Callback',   icon: '🔄', color: '#4a72ad', bg: '#eff3f8' },
    tentative:    { label: 'Tentative',  icon: '🤔', color: '#7d639c', bg: '#f4f1f8' },
    left_message: { label: 'Left Msg',   icon: '💬', color: '#4a8298', bg: '#eff5f7' },
  };

  const DB_NAME = 'vcall_inline';
  const DB_VER = 1;
  let db = null;

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
      };
      r.onsuccess = () => { db = r.result; res(db); };
      r.onerror = () => rej(r.error);
    });
  }
  const dbPut = (store, val) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  const dbGet = (store, key) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const dbGetAll = (store) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  // ── State ──
  const state = {
    sessions: [],
    activeId: null,
    applicants: [],
    courseTitle: '',
    courseDates: '',
    courseType: '',
    filter: 'all',
    groupFilter: 'all',
    search: '',
    expandedId: null,
    showExport: false,
    toast: null,
    toastTimer: null,
  };

  function setState(patch) { Object.assign(state, patch); render(); }
  function showToast(msg) {
    clearTimeout(state.toastTimer);
    state.toast = msg;
    state.toastTimer = setTimeout(() => { state.toast = null; render(); }, 2500);
    render();
  }

  // ── DIPI letter system (same encryption as PWA) ──
  const DIPI_KEY_STR = '9bd6ed6b014206c76f7a7e6b49d535e9';
  const DIPI_IV_STR  = '60b79f716fb5172a';
  const DIPI_MSG_TYPE = 6421;
  const LETTER_BASE_URL = 'https://applicant.vridhamma.org/l.php?a=';

  async function computeAuthCode(aid, msgType) {
    msgType = msgType || DIPI_MSG_TYPE;
    const plaintext = aid + '-' + msgType;
    const enc = new TextEncoder();
    const keyBytes = enc.encode(DIPI_KEY_STR);
    const ivBytes = enc.encode(DIPI_IV_STR);
    const dataBytes = enc.encode(plaintext);
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: ivBytes }, cryptoKey, dataBytes);
    const b1 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    return btoa(b1);
  }
  // l.php sends no CORS headers, so a page fetch from dipi.vridhamma.org is
  // blocked by the browser. Privileged shells (extension background worker /
  // Tampermonkey GM_xmlhttpRequest) advertise a bridge via
  // <html data-dipi-letter-bridge="1"> and answer {__dipiLetter} postMessages.
  // Without a bridge (bookmarklet) the direct fetch is attempted anyway and
  // fails fast into the generic-template fallback.
  function fetchLetterHtml(url) {
    if (document.documentElement.dataset.dipiLetterBridge !== '1') {
      return fetch(url, { mode: 'cors' }).then(resp => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.text();
      });
    }
    return new Promise((resolve, reject) => {
      const id = 'lt' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('bridge timeout'));
      }, 25000);
      function onMsg(e) {
        const d = e.data;
        if (e.origin !== location.origin || !d || d.__dipiLetter !== 'res' || d.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (d.ok) resolve(d.text);
        else reject(new Error(d.error || 'bridge fetch failed'));
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ __dipiLetter: 'req', id, url }, location.origin);
    });
  }
  async function fetchPersonalizedMessage(aid) {
    if (!aid) return null;
    try {
      const authCode = await computeAuthCode(aid);
      const url = LETTER_BASE_URL + encodeURIComponent(authCode);
      const html = await fetchLetterHtml(url);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, head').forEach(el => el.remove());
      // DOMParser documents never render, so innerText yields no line breaks
      // (the letter is one big <p> full of <br />) — materialize <br> and
      // paragraph ends as newlines first, then read textContent.
      doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      doc.querySelectorAll('p').forEach(p => p.append('\n'));
      let text = (doc.body.textContent || '').replace(/\u00a0/g, ' ');
      text = text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n');
      text = text.replace(/\n{3,}/g, '\n\n').trim();
      // Drop the first 2 lines (Google-Maps link + blank) so the message
      // opens with the greeting — same intent as the original tail -n +3.
      const lines = text.split('\n');
      if (lines.length > 2) text = lines.slice(2).join('\n').trim();
      return text;
    } catch (e) {
      console.warn('Letter fetch failed:', e.message);
      return null;
    }
  }
  async function sendWhatsAppForApplicant(appId) {
    const a = state.applicants.find(x => x.id === appId);
    if (!a) return;
    const phone = (a.mobile || a.home || '').replace(/^\+/, '').replace(/\D/g, '');
    if (!phone) { showToast('No phone number'); return; }
    logAttempt(appId);
    if (a.aid) {
      showToast('Fetching letter for ' + a.name.split(' ')[0] + '...');
      const letter = await fetchPersonalizedMessage(a.aid);
      if (letter) {
        window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(letter), '_blank');
        showToast('Personalized message ready!');
        return;
      }
    }
    const fallback = 'नमस्ते ' + a.name.split(' ')[0] + ' जी, आपका विपश्यना ' + (state.courseType || '') + ' शिविर ' + (state.courseDates || '') + ' को धम्म सुधा में है। कृपया अपनी उपस्थिति की पुष्टि करें। धन्यवाद।';
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(fallback), '_blank');
    showToast(a.aid ? 'Letter fetch failed — sent generic' : 'No AID — sent generic');
  }

  // ── Dipi status change via /change-status/{aid}?s={status}&l=&c={custom} ──
  // GET request, returns {status:"OK"|"FAIL", msg, confno, newstatus}
  async function changeDipiStatus(aid, newStatus, customText) {
    if (!aid) return { ok: false, error: 'No AID' };
    const params = new URLSearchParams();
    params.set('s', newStatus);
    params.set('l', '');
    params.set('c', customText || '');
    const url = '/change-status/' + encodeURIComponent(aid) + '?' + params.toString();
    try {
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status };
      const data = await resp.json();
      if (data.status !== 'OK') return { ok: false, error: data.msg || 'Server returned ' + data.status };
      return { ok: true, confno: data.confno || '', newstatus: data.newstatus || newStatus };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Helpers ──
  function fmtPhone(num) {
    if (!num) return '';
    num = String(num).trim();
    if (num === '0' || num.toLowerCase() === 'na') return '';
    num = num.replace(/[^0-9+]/g, '');
    if (num.startsWith('+')) return num;
    if (num.length === 10) return '+91' + num;
    if (num.length === 12 && num.startsWith('91')) return '+' + num;
    return num; // too short / unusual — keep as-is rather than invent digits
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function timeAgo(iso) {
    if (!iso) return '';
    const d = Date.now() - new Date(iso).getTime();
    const m = Math.floor(d / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  // ── Reconfirmation countdown (T-minus) ──
  // Centres auto-cancel seats not reconfirmed ~2-3 weeks before start, so the
  // header shows days-to-start and days-to-deadline, and a priority sort
  // floats still-to-reach applicants to the top. Offset (T-N) is clickable
  // (7/14/21) and persisted; centres differ.
  const RECONFIRM_KEY = 'dipiTracker.reconfirmDays';
  const SORT_KEY = 'dipiTracker.prioritySort';
  const reconfirmDays = () => {
    const n = parseInt(localStorage.getItem(RECONFIRM_KEY) || '14', 10);
    return [7, 14, 21].includes(n) ? n : 14;
  };
  const prioritySortOn = () => localStorage.getItem(SORT_KEY) !== 'false'; // default on

  // Parse the course start from the scraper's dates string, e.g.
  // "30th-Jul to 2nd-Aug 2026" (year present when the scraper found one).
  // Returns a Date at local midnight or null. Without a year, dates more than
  // ~2 months past are assumed to be next year's course. (pure)
  function parseCourseStart(dates, now = new Date()) {
    const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
    const s = String(dates || '');
    // First day-month pair with a REAL month wins — titles like
    // "3 Day / 2026 / 30th-Jul…" must skip the "3 Day" pseudo-match.
    for (const m of s.matchAll(/(\d{1,2})(?:st|nd|rd|th)?[-\s]+([A-Za-z]{3})/g)) {
      const mon = MONTHS[m[2].toLowerCase()];
      if (mon === undefined) continue;
      const ym = s.match(/\b(20\d{2})\b/);
      let d = new Date(ym ? parseInt(ym[1], 10) : now.getFullYear(), mon, parseInt(m[1], 10));
      if (!ym && (now - d) > 60 * 86400000) d = new Date(d.getFullYear() + 1, mon, parseInt(m[1], 10));
      return isNaN(d) ? null : d;
    }
    return null;
  }

  // Countdown facts for the header chip. (pure)
  function deadlineInfo(start, offsetDays, now = new Date()) {
    if (!start) return null;
    const mid = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const daysToStart = Math.round((mid(start) - mid(now)) / 86400000);
    const daysToDeadline = daysToStart - offsetDays;
    return {
      daysToStart, daysToDeadline,
      level: daysToStart < 0 ? 'past'
        : daysToDeadline < 0 ? 'over'
        : daysToDeadline <= 3 ? 'urgent'
        : daysToDeadline <= 7 ? 'soon' : 'ok',
    };
  }

  // Call-priority rank: lower = call first. (pure)
  const PRIORITY = { pending: 0, callback: 1, no_answer: 2, tentative: 3, left_message: 4, confirmed: 5, cancelled: 6 };
  function priorityRank(a) {
    return PRIORITY[a.status] !== undefined ? PRIORITY[a.status] : 3;
  }

  // ── Wait-list backfill pool ──
  // Applicants scraped with dipi status WaitList or Review are the backfill
  // pool: kept OUT of the main calling queue and its stats (behind the 🪑 Pool
  // pill), and offered as candidates when a confirmed seat frees up.

  // Pool membership from the scraped dipi status. (pure)
  function isPool(a) {
    return /^(waitlist|review)/i.test(String((a && a.dipiStatus) || ''));
  }

  // Backfill candidates for a freed seat: pool members of the same group
  // (gender balance — NM can only replace NM etc.; no group on the cancelled
  // row matches anyone), excluding candidates already called off (cancelled),
  // ordered still-to-reach first then by name, capped. (pure)
  function backfillCandidates(applicants, cancelled, max = 3) {
    return (applicants || [])
      .filter(a => isPool(a) && a.status !== 'cancelled' &&
        (!cancelled.group || a.group === cancelled.group))
      .sort((a, b) => (priorityRank(a) - priorityRank(b)) ||
        (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }))
      .slice(0, max);
  }

  // ── Session index (synchronous lookup for scraper) ──
  // Mirrors a small summary of each session into localStorage keyed by
  // "centreid/courseid". Lets the scraper detect existing sessions for
  // the current course without loading the tracker.
  const SESSION_INDEX_KEY = 'dipiTracker.sessionIndex';
  function courseKeyFromLocation() {
    const m = location.pathname.match(/\/search-course\/(\d+)\/(\d+)/);
    return m ? m[1] + '/' + m[2] : '';
  }
  function writeSessionIndexEntry(courseKey, apps, sessionId) {
    if (!courseKey || !apps.length) return;
    let idx = {};
    try { idx = JSON.parse(localStorage.getItem(SESSION_INDEX_KEY) || '{}'); } catch {}
    const withProgress = apps.filter(a => a.status && a.status !== 'pending').length;
    idx[courseKey] = {
      sessionId,
      count: apps.length,
      withProgress,
      updatedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(idx)); } catch {}
  }

  // ── Import / load / save ──
  async function importApps(rawApps, title, dates, courseType) {
    const apps = rawApps.map((d, i) => ({
      id: i + '-' + Date.now(),
      name: (d.name || '').replace(/\s+/g, ' ').trim(),
      mobile: fmtPhone(d.mobile),
      home: fmtPhone(d.home),
      office: fmtPhone(d.office),
      email: d.email || '',
      gender: (d.type || '').includes('Female') ? 'Female' : (d.type || '').includes('Male') ? 'Male' : (d.gender || ''),
      age: d.age || '',
      city: d.city || '',
      group: d.group || '',
      aid: d.aid || '',
      dipiStatus: d.status || '',
      status: 'pending',
      attempts: 0,
      lastAttempt: null,
      notes: '',
    })).filter(a => a.name);
    apps.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

    const cleanTitle = title || 'DIPI Course ' + new Date().toLocaleDateString('en-IN');
    const courseKey = courseKeyFromLocation();
    const sid = 's-' + Date.now();
    // Try to find an existing session for the same course (by title) — merge instead of create
    const all = await dbGetAll('sessions');
    const existing = all.find(s => s.title === cleanTitle && s.dates === (dates || ''));
    if (existing) {
      // Merge: carry over status/notes/attempts where AID matches
      const byAid = {};
      existing.applicants.forEach(a => { if (a.aid) byAid[a.aid] = a; });
      apps.forEach(a => {
        if (a.aid && byAid[a.aid]) {
          const old = byAid[a.aid];
          a.status = old.status;
          a.attempts = old.attempts;
          a.lastAttempt = old.lastAttempt;
          a.notes = old.notes;
        }
      });
      existing.applicants = apps;
      existing.count = apps.length;
      existing.dates = dates || existing.dates;
      existing.courseType = courseType || existing.courseType;
      existing.updatedAt = new Date().toISOString();
      existing.courseKey = existing.courseKey || courseKey;
      await dbPut('sessions', existing);
      writeSessionIndexEntry(existing.courseKey, apps, existing.id);
      const fresh = await dbGetAll('sessions');
      setState({
        sessions: fresh, activeId: existing.id, applicants: apps,
        courseTitle: cleanTitle, courseDates: existing.dates, courseType: existing.courseType,
        filter: 'all', groupFilter: 'all', search: '', expandedId: null, showExport: false
      });
      showToast('Refreshed ' + apps.length + ' applicants');
      return;
    }
    const sess = { id: sid, title: cleanTitle, courseKey, createdAt: new Date().toISOString(),
                   count: apps.length, applicants: apps, dates: dates || '', courseType: courseType || '' };
    await dbPut('sessions', sess);
    writeSessionIndexEntry(courseKey, apps, sid);
    const fresh = await dbGetAll('sessions');
    setState({
      sessions: fresh, activeId: sid, applicants: apps,
      courseTitle: cleanTitle, courseDates: dates || '', courseType: courseType || '',
      filter: 'all', groupFilter: 'all', search: '', expandedId: null, showExport: false
    });
    showToast('Imported ' + apps.length + ' applicants');
  }

  async function loadSession(sid) {
    const s = await dbGet('sessions', sid);
    if (s) setState({
      activeId: sid, applicants: s.applicants || [],
      courseTitle: s.title || '', courseDates: s.dates || '', courseType: s.courseType || '',
      filter: 'all', groupFilter: 'all', search: '', expandedId: null, showExport: false
    });
  }
  async function saveApplicants() {
    const s = await dbGet('sessions', state.activeId);
    if (s) {
      s.applicants = state.applicants;
      s.updatedAt = new Date().toISOString();
      await dbPut('sessions', s);
      writeSessionIndexEntry(s.courseKey || courseKeyFromLocation(), state.applicants, state.activeId);
    }
  }
  function updateApp(id, patch) {
    state.applicants = state.applicants.map(a => a.id === id ? { ...a, ...patch } : a);
    render(); saveApplicants();
  }
  function markStatus(id, status) {
    const a = state.applicants.find(x => x.id === id);
    if (!a || !STATUSES[status]) return;
    const inc = ['no_answer', 'left_message'].includes(status);
    updateApp(id, { status, attempts: inc ? (a.attempts || 0) + 1 : a.attempts, lastAttempt: new Date().toISOString() });
    showToast(a.name.split(' ')[0] + ' → ' + STATUSES[status].label);
  }
  function logAttempt(id) {
    const a = state.applicants.find(x => x.id === id);
    if (!a) return;
    updateApp(id, { attempts: (a.attempts || 0) + 1, lastAttempt: new Date().toISOString() });
  }

  // ── Exports ──
  function exportWhatsApp() {
    const A = state.applicants, stats = {};
    A.forEach(a => { stats[a.status] = (stats[a.status] || 0) + 1; });
    const g = {}; Object.keys(STATUSES).forEach(s => g[s] = []);
    A.forEach(a => g[a.status]?.push(a));
    let t = '📋 *' + state.courseTitle + '*\n📊 *Call Results Summary*\n━━━━━━━━━━━━━━━━━━\n\n';
    Object.entries(STATUSES).forEach(([k, v]) => {
      if (g[k]?.length) {
        t += v.icon + ' *' + v.label + '* (' + g[k].length + ')\n';
        g[k].forEach((a, i) => { t += ' ' + (i + 1) + '. ' + a.name + ' — ' + a.mobile + '\n'; });
        t += '\n';
      }
    });
    t += '━━━━━━━━━━━━━━━━━━\nTotal: ' + A.length + ' | ✅ ' + (stats.confirmed || 0) + ' | ❌ ' + (stats.cancelled || 0) + ' | ⏳ ' + (stats.pending || 0);
    navigator.clipboard.writeText(t);
    showToast('Copied WhatsApp summary!');
    setState({ showExport: false });
  }
  function exportCSV() {
    const head = 'S.No,Name,AID,Group,Mobile,Home,Status,Attempts,LastAttempt,Notes\n';
    const lines = state.applicants.map((a, i) => {
      const esc = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
      return [
        i + 1, esc(a.name), a.aid || '', a.group || '',
        a.mobile, a.home, STATUSES[a.status]?.label || a.status,
        a.attempts, a.lastAttempt ? new Date(a.lastAttempt).toLocaleString('en-IN') : '',
        esc(a.notes)
      ].join(',');
    }).join('\n');
    const blob = new Blob([head + lines + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.courseTitle.replace(/[^a-zA-Z0-9]/g, '_') + '_results.csv';
    a.click();
    showToast('CSV downloaded');
    setState({ showExport: false });
  }
  function exportPDF() {
    const A = state.applicants, stats = {};
    A.forEach(a => { stats[a.status] = (stats[a.status] || 0) + 1; });
    const rows = A.map((a, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8f9fa'}">
      <td style="text-align:center;padding:6px 4px;border:1px solid #ccc">${i + 1}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;font-weight:500">${escHtml(a.name)}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;font-family:monospace;font-size:11px">${a.mobile}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;font-family:monospace;font-size:11px">${a.home}</td>
      <td style="text-align:center;padding:6px 4px;border:1px solid #ccc;font-weight:600;color:${STATUSES[a.status]?.color || '#666'}">${STATUSES[a.status]?.label || a.status}</td>
      <td style="text-align:center;padding:6px 4px;border:1px solid #ccc">${a.attempts}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;font-size:10px;color:#666">${escHtml(a.notes || '')}</td></tr>`).join('');
    const w = window.open('', '_blank');
    if (!w) { showToast('Popup blocked — allow popups to print'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(state.courseTitle)}</title><style>
      @page{margin:10mm}body{font-family:-apple-system,sans-serif;font-size:12px;margin:0;padding:10px}
      h1{font-size:16px;text-align:center;margin:0 0 4px}.sub{text-align:center;color:#666;margin-bottom:10px;font-size:11px}
      table{width:100%;border-collapse:collapse}th{background:#2c3e50;color:#fff;padding:7px 4px;border:1px solid #2c3e50;font-size:11px}
      </style></head><body><h1>${escHtml(state.courseTitle)}</h1>
      <div class="sub">✅ ${stats.confirmed || 0} Confirmed | ❌ ${stats.cancelled || 0} Cancelled | ⏳ ${stats.pending || 0} Pending | Total: ${A.length}</div>
      <table><tr><th>#</th><th>Name</th><th>Mobile</th><th>Home</th><th>Status</th><th>Att.</th><th>Notes</th></tr>${rows}</table>
      <script>setTimeout(()=>window.print(),300)<\/script></body></html>`);
    w.document.close();
    setState({ showExport: false });
  }
  function exportAIDPhone() {
    const lines = state.applicants
      .filter(a => a.aid && a.mobile)
      .map(a => a.aid + ':' + a.mobile.replace(/^\+91/, ''));
    if (!lines.length) { showToast('No AIDs to export'); setState({ showExport: false }); return; }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aid_mobilenumber.txt';
    a.click();
    showToast('Exported ' + lines.length + ' pairs');
    setState({ showExport: false });
  }

  // ── Session backup / restore ──
  // All call progress lives in this browser's IndexedDB; a profile wipe or a
  // machine switch mid-course loses it, and a half-done calling session can't
  // be handed to another volunteer. Backup = versioned JSON of one session
  // (contains applicant PII — handle like the CSV exports). Restore merges
  // into an existing session per applicant: newest lastAttempt wins, ties go
  // to the record with progress, notes are never dropped, attempts take max.

  // null when valid, else a human-readable rejection. (pure)
  function validateBackup(p) {
    if (!p || p.kind !== 'dipiTracker.session') return 'Not a tracker session backup';
    if (p.v !== 1) return 'Unsupported backup version: ' + (p.v === undefined ? '?' : p.v);
    const s = p.session;
    if (!s || !s.title || !Array.isArray(s.applicants)) return 'Backup is missing session data';
    return null;
  }

  // Merge incoming applicants into existing ones. Match by AID, else
  // name+mobile. Returns { merged, stats:{ updated, added } }. (pure)
  function mergeSessions(existing, incoming) {
    const ts = (a) => (a && a.lastAttempt && Date.parse(a.lastAttempt)) || 0;
    const hasProgress = (a) => (a.status && a.status !== 'pending') || ((a.attempts | 0) > 0) || !!(a.notes && a.notes.trim());
    const keyOf = (a) => a.aid ? 'a:' + a.aid : 'n:' + (a.name || '').toLowerCase() + '|' + (a.mobile || '');
    const map = new Map((existing.applicants || []).map(a => [keyOf(a), a]));
    let updated = 0, added = 0;
    for (const inc of (incoming.applicants || [])) {
      const cur = map.get(keyOf(inc));
      if (!cur) { map.set(keyOf(inc), inc); added++; continue; }
      const incWins = ts(inc) > ts(cur) || (ts(inc) === ts(cur) && !hasProgress(cur) && hasProgress(inc));
      const winner = incWins ? inc : cur, loser = incWins ? cur : inc;
      const out = { ...winner };
      if ((!out.notes || !out.notes.trim()) && loser.notes && loser.notes.trim()) out.notes = loser.notes;
      out.attempts = Math.max(winner.attempts | 0, loser.attempts | 0);
      if (incWins) updated++;
      map.set(keyOf(inc), out);
    }
    const merged = [...map.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
    return { merged, stats: { updated, added } };
  }

  async function exportBackup() {
    const sess = await dbGet('sessions', state.activeId);
    if (!sess) { showToast('No active session to back up'); setState({ showExport: false }); return; }
    const payload = { kind: 'dipiTracker.session', v: 1, exportedAt: new Date().toISOString(), session: sess };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'session_' + (sess.title || 'course').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60) +
      '_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    showToast('Backup saved — contains applicant data, share only with course admins');
    setState({ showExport: false });
  }

  function pickBackupFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      f.text()
        .then(txt => importBackup(JSON.parse(txt)))
        .catch(e => showToast('Import failed: ' + e.message));
    };
    inp.click();
  }

  async function importBackup(payload) {
    const bad = validateBackup(payload);
    if (bad) { showToast(bad); return; }
    if (!db) await openDB();
    const incoming = payload.session;
    const all = await dbGetAll('sessions');
    const existing = all.find(s => s.id === incoming.id) ||
      all.find(s => s.title === incoming.title && (s.dates || '') === (incoming.dates || '')) ||
      (incoming.courseKey ? all.find(s => s.courseKey === incoming.courseKey) : null);
    if (existing) {
      const { merged, stats } = mergeSessions(existing, incoming);
      existing.applicants = merged;
      existing.count = merged.length;
      existing.dates = existing.dates || incoming.dates || '';
      existing.courseType = existing.courseType || incoming.courseType || '';
      existing.courseKey = existing.courseKey || incoming.courseKey || '';
      existing.updatedAt = new Date().toISOString();
      await dbPut('sessions', existing);
      writeSessionIndexEntry(existing.courseKey, merged, existing.id);
      state.sessions = await dbGetAll('sessions');
      await loadSession(existing.id);
      showToast('Merged backup into "' + existing.title + '" — ' + stats.updated + ' updated, ' + stats.added + ' added');
    } else {
      if (all.some(s => s.id === incoming.id)) incoming.id = 's-' + Date.now(); // stale id from another course
      incoming.count = incoming.applicants.length;
      await dbPut('sessions', incoming);
      writeSessionIndexEntry(incoming.courseKey || '', incoming.applicants, incoming.id);
      state.sessions = await dbGetAll('sessions');
      await loadSession(incoming.id);
      showToast('Imported "' + incoming.title + '" — ' + incoming.applicants.length + ' applicants');
    }
  }

  // ── Overlay shell ──
  const OVERLAY_ID = 'dipi-tracker-overlay';

  function ensureOverlay() {
    let ov = document.getElementById(OVERLAY_ID);
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    ov.style.cssText = `
      position:fixed; inset:0; z-index:2147483646;
      background:#f1f5f9; overflow-y:auto; -webkit-overflow-scrolling:touch;
      color-scheme:light;
    `;
    // Inject styles
    const style = document.createElement('style');
    style.id = 'dipi-tracker-style';
    style.textContent = `
      #${OVERLAY_ID} { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1e293b; }
      #${OVERLAY_ID} * { box-sizing:border-box; }
      #${OVERLAY_ID} button, #${OVERLAY_ID} input, #${OVERLAY_ID} textarea { font-family:inherit; }
      #${OVERLAY_ID} .dt-header { background:linear-gradient(135deg,#1e293b,#334155); color:#fff; padding:14px 16px 10px; position:sticky; top:0; z-index:5; box-shadow:0 2px 12px rgba(0,0,0,.15); }
      #${OVERLAY_ID} .dt-header-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      #${OVERLAY_ID} .dt-header h1 { font-size:15px; font-weight:700; line-height:1.2; margin:0; }
      #${OVERLAY_ID} .dt-header .sub { font-size:11px; color:#94a3b8; margin-top:2px; }
      #${OVERLAY_ID} .dt-header-btns { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
      #${OVERLAY_ID} .dt-btn { border:1px solid transparent; border-radius:8px; padding:7px 12px; font-size:12px; font-weight:600; cursor:pointer; }
      #${OVERLAY_ID} .dt-btn-blue { background:#3f65a7; color:#fff; }
      #${OVERLAY_ID} .dt-btn-gray { background:rgba(148,163,184,.12); border-color:#475569; color:#cbd5e1; }
      #${OVERLAY_ID} .dt-btn-red  { background:transparent; border-color:#5f4444; color:#cf8d8d; }
      #${OVERLAY_ID} .dt-tminus { display:inline-block; margin-top:8px; padding:5px 10px; border-radius:6px;
        font-size:11px; font-weight:600; cursor:pointer; user-select:none;
        background:rgba(148,163,184,.12); border:1px solid #475569; color:#cbd5e1; }
      #${OVERLAY_ID} .dt-tminus.soon   { border-color:#8a6d3b; color:#d9b97a; background:rgba(185,135,61,.12); }
      #${OVERLAY_ID} .dt-tminus.urgent { border-color:#8a4b4b; color:#e0a0a0; background:rgba(179,95,95,.14); }
      #${OVERLAY_ID} .dt-tminus.over   { border-color:#8a4b4b; color:#e8b4b4; background:rgba(179,95,95,.22); }
      #${OVERLAY_ID} .dt-tminus.past   { border-color:#475569; color:#8b96a5; background:transparent; }
      #${OVERLAY_ID} .dt-sort-pill { border:1px dashed #64748b; }
      #${OVERLAY_ID} .dt-stats { display:flex; gap:6px; margin-top:10px; overflow-x:auto; padding-bottom:2px; }
      #${OVERLAY_ID} .dt-pill { padding:4px 10px; border-radius:20px; border:none; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap; }
      #${OVERLAY_ID} .dt-pill.active { background:rgba(255,255,255,.18); color:#e8edf3; }
      #${OVERLAY_ID} .dt-pill:not(.active) { background:rgba(255,255,255,.06); color:#94a3b8; }
      #${OVERLAY_ID} .dt-search { margin-top:8px; }
      #${OVERLAY_ID} .dt-search input { width:100%; padding:8px 12px; border-radius:8px; border:none; background:#475569; color:#fff; font-size:13px; outline:none; }
      #${OVERLAY_ID} .dt-search input::placeholder { color:#94a3b8; }
      #${OVERLAY_ID} .dt-export-dd { margin-top:10px; background:#fff; border-radius:10px; padding:4px; box-shadow:0 4px 20px rgba(0,0,0,.2); }
      #${OVERLAY_ID} .dt-export-dd button { display:block; width:100%; text-align:left; padding:10px 14px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; color:#1e293b; border-radius:8px; }
      #${OVERLAY_ID} .dt-export-dd button:active { background:#f1f5f9; }
      #${OVERLAY_ID} .dt-list { padding:10px 12px; }
      #${OVERLAY_ID} .dt-card { background:#fff; border-radius:12px; margin-bottom:8px; border:1px solid #e2e8f0; box-shadow:0 1px 3px rgba(0,0,0,.04); overflow:hidden; }
      #${OVERLAY_ID} .dt-card-main { padding:10px 14px; cursor:pointer; display:flex; align-items:center; gap:10px; }
      #${OVERLAY_ID} .dt-card-icon { width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
      #${OVERLAY_ID} .dt-card-info { flex:1; min-width:0; }
      #${OVERLAY_ID} .dt-card-name { font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #${OVERLAY_ID} .dt-card-meta { font-size:11px; color:#94a3b8; margin-top:1px; }
      #${OVERLAY_ID} .dt-card-badge { font-size:10px; font-weight:700; padding:3px 8px; border-radius:6px; flex-shrink:0; text-transform:uppercase; letter-spacing:.5px; }
      #${OVERLAY_ID} .dt-card-expanded { padding:0 14px 12px; border-top:1px solid #f1f5f9; }
      #${OVERLAY_ID} .dt-phone-btns { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
      #${OVERLAY_ID} .dt-phone-btn { display:inline-flex; align-items:center; gap:6px; border-radius:8px; padding:8px 14px; text-decoration:none; font-weight:600; font-size:13px; border:none; cursor:pointer; }
      #${OVERLAY_ID} .dt-phone-mobile { background:#f0fdf4; border:1px solid #bbf7d0; color:#15803d; }
      #${OVERLAY_ID} .dt-phone-home   { background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8; }
      #${OVERLAY_ID} .dt-phone-wa     { background:#dcfce7; border:1px solid #86efac; color:#15803d; }
      #${OVERLAY_ID} .dt-status-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:10px; }
      #${OVERLAY_ID} .dt-backfill { margin-top:10px; padding:8px 10px; background:#f4f1f8; border:1px solid #ddd6e8; border-radius:8px; }
      #${OVERLAY_ID} .dt-backfill-title { font-size:11px; font-weight:700; color:#7d639c; margin-bottom:6px; }
      #${OVERLAY_ID} .dt-backfill-cand { display:block; width:100%; text-align:left; padding:6px 8px; margin-bottom:4px; border:1px solid #e2e8f0; background:#fff; border-radius:6px; font-size:12px; color:#334155; cursor:pointer; }
      #${OVERLAY_ID} .dt-backfill-cand:active { background:#f1f5f9; }
      #${OVERLAY_ID} .dt-backfill-none { font-size:11px; color:#94a3b8; }
      #${OVERLAY_ID} .dt-dipi-status { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:10px; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; }
      #${OVERLAY_ID} .dt-dipi-label { font-size:11px; color:#64748b; flex:1; min-width:120px; }
      #${OVERLAY_ID} .dt-dipi-label b { color:#1e293b; }
      #${OVERLAY_ID} .dt-dipi-sel { font-size:12px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#1e293b; max-width:160px; }
      #${OVERLAY_ID} .dt-dipi-custom { font-size:12px; padding:4px 8px; border:1px solid #cbd5e1; border-radius:6px; width:120px; }
      #${OVERLAY_ID} .dt-dipi-update { font-size:12px; font-weight:600; padding:4px 12px; border-radius:6px; border:none; background:#3f65a7; color:#fff; cursor:pointer; }
      #${OVERLAY_ID} .dt-dipi-update:disabled { background:#94a3b8; cursor:not-allowed; }
      #${OVERLAY_ID} .dt-dipi-edit { font-size:14px; text-decoration:none; padding:2px 6px; }
      #${OVERLAY_ID} .dt-status-btn { padding:9px 6px; border-radius:8px; cursor:pointer; font-size:11px; font-weight:600; line-height:1.2; text-align:center; }
      #${OVERLAY_ID} .dt-notes { width:100%; margin-top:10px; padding:8px 10px; border-radius:8px; border:1px solid #e2e8f0; font-size:12px; resize:vertical; min-height:36px; background:#f8fafc; outline:none; color:#334155; }
      #${OVERLAY_ID} .dt-reset-btn { margin-top:6px; padding:6px 12px; border-radius:6px; border:1px solid #e2e8f0; background:#f8fafc; font-size:11px; color:#94a3b8; cursor:pointer; }
      #${OVERLAY_ID} .dt-empty { text-align:center; padding:40px; color:#94a3b8; }
      #${OVERLAY_ID} .dt-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#1e293b; color:#fff; padding:10px 20px; border-radius:10px; font-size:13px; font-weight:500; box-shadow:0 4px 20px rgba(0,0,0,.25); z-index:2147483647; white-space:nowrap; }
      #${OVERLAY_ID} .dt-empty-screen { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; }
      #${OVERLAY_ID} .dt-empty-screen h1 { font-size:22px; font-weight:700; margin:0 0 4px; }
      #${OVERLAY_ID} .dt-empty-screen .sub { color:#64748b; margin:0 0 28px; font-size:14px; }
      #${OVERLAY_ID} .dt-session-btn { display:block; width:100%; text-align:left; padding:12px 16px; border:1px solid #e2e8f0; border-radius:10px; margin-bottom:8px; background:#fff; cursor:pointer; max-width:360px; }
      #${OVERLAY_ID} .dt-session-btn .title { font-weight:600; font-size:13px; color:#1e293b; }
      #${OVERLAY_ID} .dt-session-btn .meta { font-size:11px; color:#94a3b8; margin-top:2px; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(ov);
    return ov;
  }

  function render() {
    const ov = ensureOverlay();
    const { activeId, applicants: A, courseTitle, filter, search, expandedId, showExport, toast } = state;
    // innerHTML replacement destroys the focused search box; remember it so typing isn't interrupted
    const searchHadFocus = document.activeElement && document.activeElement.id === 'dt-search-box';
    const searchCaret = searchHadFocus ? document.activeElement.selectionStart : 0;

    if (!activeId || A.length === 0) {
      ov.innerHTML = `
        <div class="dt-empty-screen">
          <div style="font-size:48px;margin-bottom:8px">🧘</div>
          <h1>Call Tracker</h1>
          <p class="sub">No active session</p>
          ${state.sessions.length ? `
            <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Previous Sessions</div>
            ${state.sessions.map(s => `<button class="dt-session-btn" data-sid="${s.id}">
              <div class="title">${escHtml(s.title)}</div>
              <div class="meta">${s.count} applicants · ${new Date(s.createdAt).toLocaleDateString('en-IN')}</div>
            </button>`).join('')}
          ` : '<div style="color:#94a3b8;font-size:13px">Run the scraper to start a session</div>'}
          <button class="dt-btn dt-btn-gray" id="dt-import-backup" style="margin-top:16px" title="Restore a session_*.json backup exported on another machine or profile">📂 Import session backup</button>
          <button class="dt-btn dt-btn-red" id="dt-close" style="margin-top:12px">Close Tracker</button>
        </div>`;
      ov.querySelectorAll('[data-sid]').forEach(b => b.addEventListener('click', () => loadSession(b.dataset.sid)));
      ov.querySelector('#dt-import-backup')?.addEventListener('click', pickBackupFile);
      ov.querySelector('#dt-close')?.addEventListener('click', closeTracker);
      return;
    }

    // Wait-list/Review rows are the backfill pool — out of the main queue
    // and its stats, behind the 🪑 pill.
    const mainA = A.filter(a => !isPool(a));
    const poolA = A.filter(isPool);
    const stats = {};
    mainA.forEach(a => { stats[a.status] = (stats[a.status] || 0) + 1; });
    const pending = mainA.filter(a => ['pending', 'no_answer', 'callback'].includes(a.status)).length;
    const { groupFilter, courseDates, courseType } = state;

    const GROUPS = { NM:'New ♂', OM:'Old ♂', SM:'Seva ♂', NF:'New ♀', OF:'Old ♀', SF:'Seva ♀' };
    const groupStats = {};
    A.forEach(a => { if (a.group) groupStats[a.group] = (groupStats[a.group] || 0) + 1; });

    const filtered = (filter === 'pool' ? poolA : mainA).filter(a => {
      if (filter !== 'all' && filter !== 'pool' && a.status !== filter) return false;
      if (groupFilter !== 'all' && a.group !== groupFilter) return false;
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    // Priority sort: still-to-reach first (pending → callback → no-answer …),
    // alphabetical within a rank (A is already name-sorted, sort is stable).
    if (prioritySortOn()) filtered.sort((a, b) => priorityRank(a) - priorityRank(b));

    // Reconfirmation countdown chip
    const rDays = reconfirmDays();
    const cd = deadlineInfo(parseCourseStart(courseDates || courseTitle), rDays);
    const tminusHTML = cd ? (() => {
      const txt = cd.daysToStart < 0 ? 'Course started ' + (-cd.daysToStart) + 'd ago'
        : cd.daysToStart === 0 ? '🏁 Course starts TODAY · ' + pending + ' to reach'
        : 'Starts in ' + cd.daysToStart + 'd · reconfirm deadline (T-' + rDays + ') ' +
          (cd.daysToDeadline > 0 ? 'in ' + cd.daysToDeadline + 'd'
            : cd.daysToDeadline === 0 ? 'TODAY' : (-cd.daysToDeadline) + 'd overdue') +
          ' · ' + pending + ' to reach';
      return `<div class="dt-tminus ${cd.level}" id="dt-tminus" title="Centres auto-cancel seats not reconfirmed ~2–3 weeks before start. Click to switch the deadline offset (7/14/21 days).">⏳ ${txt}</div>`;
    })() : '';

    const statPills = [`<button class="dt-pill ${filter==='all'?'active':''}" data-flt="all">All ${mainA.length}</button>`];
    Object.entries(STATUSES).forEach(([k,v]) => {
      if (stats[k] > 0) statPills.push(`<button class="dt-pill ${filter===k?'active':''}" data-flt="${k}">${v.icon} ${stats[k]}</button>`);
    });
    if (poolA.length) statPills.push(`<button class="dt-pill ${filter==='pool'?'active':''}" data-flt="pool" title="Wait-list / Review applicants — backfill candidates for freed seats">🪑 ${poolA.length}</button>`);

    const groupPills = [`<button class="dt-pill ${groupFilter==='all'?'active':''}" data-grp="all">All</button>`];
    Object.entries(GROUPS).forEach(([k,label]) => {
      if (groupStats[k] > 0) groupPills.push(`<button class="dt-pill ${groupFilter===k?'active':''}" data-grp="${k}">${label} ${groupStats[k]}</button>`);
    });

    const cards = filtered.map((a, idx) => {
      const st = STATUSES[a.status];
      const isExp = expandedId === a.id;
      let exp = '';
      if (isExp) {
        const phoneBtns = [];
        if (a.mobile) phoneBtns.push(`<a href="tel:${a.mobile}" class="dt-phone-btn dt-phone-mobile" data-call="${a.id}">📱 ${a.mobile}</a>`);
        if (a.home && a.home !== a.mobile) phoneBtns.push(`<a href="tel:${a.home}" class="dt-phone-btn dt-phone-home" data-call="${a.id}">🏠 ${a.home}</a>`);
        const waPhone = (a.mobile || a.home || '').replace(/^\+/, '');
        if (waPhone) phoneBtns.push(`<button class="dt-phone-btn dt-phone-wa" data-wa="${a.id}">💬 WhatsApp${a.aid ? ' ✉' : ''}</button>`);

        // Inline dipi status changer: select + Update button.
        // Hits GET /change-status/{aid}?s={status}&l=&c= which dipi's own UI also uses.
        const DIPI_STATUS_OPTIONS = ['Confirmed','Cancelled','Clarification','Duplicate','PreConfirmation','Regret','Rejected','Review','WaitList','Custom'];
        const curDipi = (a.dipiStatus || '').replace(/\s*\(.*\)\s*$/, '').trim(); // strip "(SM4)" suffix
        let dipiBlock = '';
        if (a.aid) {
          const opts = DIPI_STATUS_OPTIONS.map(s =>
            `<option value="${s}"${s === curDipi ? ' selected' : ''}>${s}</option>`
          ).join('');
          dipiBlock = `<div class="dt-dipi-status" data-dipi="${a.id}">
            <span class="dt-dipi-label">Dipi: <b>${escHtml(a.dipiStatus || '?')}</b></span>
            <select class="dt-dipi-sel" data-dipi-sel="${a.id}">${opts}</select>
            <input class="dt-dipi-custom" data-dipi-custom="${a.id}" type="text" placeholder="Custom reason" style="display:none">
            <button class="dt-dipi-update" data-dipi-update="${a.id}">Update</button>
            <a href="/app/${a.aid}/edit" target="_blank" class="dt-dipi-edit" title="Open full edit on dipi">📝</a>
          </div>`;
        }

        const statusBtns = Object.entries(STATUSES).filter(([k]) => k !== 'pending').map(([k,v]) =>
          `<button class="dt-status-btn" data-mark="${a.id}|${k}" style="border:${a.status===k?'2px solid '+v.color:'1px solid #e2e8f0'};background:${a.status===k?v.bg:'#fff'};color:${a.status===k?v.color:'#64748b'}">${v.icon}<br>${v.label}</button>`
        ).join('');

        // Freed seat → same-group wait-list/review candidates to call next
        let backfill = '';
        if (a.status === 'cancelled' && !isPool(a)) {
          const cands = backfillCandidates(A, a);
          backfill = `<div class="dt-backfill">
            <div class="dt-backfill-title">🪑 Seat freed — backfill candidates${a.group ? ' (group ' + escHtml(a.group) + ')' : ''}</div>
            ${cands.length ? cands.map(c =>
              `<button class="dt-backfill-cand" data-bf="${c.id}" title="Open this candidate in the pool view">${STATUSES[c.status]?.icon || ''} ${escHtml(c.name)} · ${escHtml((c.dipiStatus || '').replace(/\s*\(.*\)\s*$/, ''))}${c.mobile ? ' · ' + escHtml(c.mobile) : ''}</button>`
            ).join('') : '<div class="dt-backfill-none">No wait-list/review candidates' + (a.group ? ' in group ' + escHtml(a.group) : '') + ' — check the 🪑 pool pill</div>'}
          </div>`;
        }

        exp = `<div class="dt-card-expanded">
          <div class="dt-phone-btns">${phoneBtns.join('')}</div>
          ${dipiBlock}
          <div class="dt-status-grid">${statusBtns}</div>
          ${backfill}
          <textarea class="dt-notes" placeholder="Add a note..." data-note="${a.id}">${escHtml(a.notes || '')}</textarea>
          ${a.status !== 'pending' ? `<button class="dt-reset-btn" data-mark="${a.id}|pending">↩ Reset to Pending</button>` : ''}
        </div>`;
      }
      return `<div class="dt-card" style="border-color:${a.status==='pending'?'#e2e8f0':st.color+'33'}">
        <div class="dt-card-main" data-toggle="${a.id}">
          <div class="dt-card-icon" style="background:${st.bg}">${st.icon}</div>
          <div class="dt-card-info">
            <div class="dt-card-name">${idx+1}. ${escHtml(a.name)}</div>
            <div class="dt-card-meta">${a.group?escHtml(a.group)+' · ':''}${a.dipiStatus?escHtml(a.dipiStatus)+' · ':''}${a.city?escHtml(a.city)+' · ':''}${a.attempts>0?a.attempts+' attempt'+(a.attempts>1?'s':'')+' · '+timeAgo(a.lastAttempt):'No attempts yet'}</div>
          </div>
          <div class="dt-card-badge" style="color:${st.color};background:${st.bg}">${st.label}</div>
        </div>${exp}</div>`;
    }).join('');

    ov.innerHTML = `
      <div class="dt-header">
        <div class="dt-header-top">
          <div style="min-width:0;flex:1">
            <h1>🧘 ${escHtml(courseDates || courseTitle)}</h1>
            <div class="sub">${mainA.length} applicants · ${pending} remaining${poolA.length?' · '+poolA.length+' in pool':''}${courseType?' · '+courseType:''}</div>
          </div>
          <div class="dt-header-btns">
            <button class="dt-btn dt-btn-blue" id="dt-export-btn">📤 Export</button>
            <button class="dt-btn dt-btn-gray" id="dt-rescrape">🔄 Re-scrape</button>
            <button class="dt-btn dt-btn-red" id="dt-close">✕ Close</button>
          </div>
        </div>
        ${showExport ? `<div class="dt-export-dd">
          <button id="dt-exp-wa">📋 Copy for WhatsApp</button>
          <button id="dt-exp-csv">📊 Download CSV</button>
          <button id="dt-exp-pdf">🖨️ Print / PDF</button>
          <button id="dt-exp-aid">📤 AID:Phone for script</button>
          <button id="dt-exp-backup">💾 Backup session (JSON)</button>
          <button id="dt-exp-restore">📂 Import backup…</button>
        </div>` : ''}
        ${tminusHTML}
        ${Object.keys(groupStats).length ? `<div style="display:flex;gap:4px;margin-top:8px;overflow-x:auto;padding-bottom:2px">${groupPills.join('')}</div>` : ''}
        <div class="dt-stats"><button class="dt-pill dt-sort-pill" id="dt-sort-pill" title="Toggle list order: priority floats still-to-reach applicants (pending / callback / no-answer) to the top">${prioritySortOn() ? '⏳ Priority' : 'A–Z'}</button>${statPills.join('')}</div>
        <div class="dt-search"><input type="text" placeholder="🔍 Search by name..." value="${escHtml(search)}" id="dt-search-box"></div>
      </div>
      <div class="dt-list">${cards.length ? cards : '<div class="dt-empty"><div style="font-size:32px">🔍</div><div style="margin-top:8px">No applicants match this filter</div></div>'}</div>
      ${toast ? `<div class="dt-toast">${escHtml(toast)}</div>` : ''}`;

    // Event bindings
    ov.querySelector('#dt-export-btn')?.addEventListener('click', () => setState({ showExport: !state.showExport }));
    ov.querySelector('#dt-exp-wa')?.addEventListener('click', exportWhatsApp);
    ov.querySelector('#dt-exp-csv')?.addEventListener('click', exportCSV);
    ov.querySelector('#dt-exp-pdf')?.addEventListener('click', exportPDF);
    ov.querySelector('#dt-exp-aid')?.addEventListener('click', exportAIDPhone);
    ov.querySelector('#dt-exp-backup')?.addEventListener('click', exportBackup);
    ov.querySelector('#dt-exp-restore')?.addEventListener('click', () => { setState({ showExport: false }); pickBackupFile(); });
    ov.querySelector('#dt-close')?.addEventListener('click', closeTracker);
    ov.querySelector('#dt-rescrape')?.addEventListener('click', () => {
      closeTracker();
      if (window.DipiScraper && window.DipiScraper.run) window.DipiScraper.run();
      else showToast('Run scraper bookmarklet again');
    });
    ov.querySelector('#dt-tminus')?.addEventListener('click', () => {
      const next = { 7: 14, 14: 21, 21: 7 }[reconfirmDays()];
      localStorage.setItem(RECONFIRM_KEY, String(next));
      render();
      showToast('Reconfirm deadline set to T-' + next);
    });
    ov.querySelector('#dt-sort-pill')?.addEventListener('click', () => {
      localStorage.setItem(SORT_KEY, prioritySortOn() ? 'false' : 'true');
      render();
    });
    ov.querySelector('#dt-search-box')?.addEventListener('input', e => { state.search = e.target.value; render(); });
    ov.querySelectorAll('[data-flt]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.flt;
      setState({ filter: state.filter === f && f !== 'all' ? 'all' : f });
    }));
    ov.querySelectorAll('[data-grp]').forEach(b => b.addEventListener('click', () => {
      const g = b.dataset.grp;
      setState({ groupFilter: state.groupFilter === g && g !== 'all' ? 'all' : g });
    }));
    ov.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
      setState({ expandedId: state.expandedId === b.dataset.toggle ? null : b.dataset.toggle });
    }));
    ov.querySelectorAll('[data-bf]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      setState({ filter: 'pool', groupFilter: 'all', search: '', expandedId: b.dataset.bf });
    }));
    ov.querySelectorAll('[data-call]').forEach(b => b.addEventListener('click', () => logAttempt(b.dataset.call)));
    ov.querySelectorAll('[data-wa]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      sendWhatsAppForApplicant(b.dataset.wa);
    }));
    ov.querySelectorAll('[data-mark]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const [id, st] = b.dataset.mark.split('|');
      markStatus(id, st);
    }));
    ov.querySelectorAll('[data-note]').forEach(el => {
      el.addEventListener('input', () => {
        const a = state.applicants.find(x => x.id === el.dataset.note);
        if (a) { a.notes = el.value; saveApplicants(); }
      });
      el.addEventListener('click', e => e.stopPropagation());
    });

    // Dipi status changer
    ov.querySelectorAll('[data-dipi-sel]').forEach(sel => {
      const id = sel.dataset.dipiSel;
      const customInput = ov.querySelector(`[data-dipi-custom="${id}"]`);
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', () => {
        if (customInput) customInput.style.display = sel.value === 'Custom' ? 'inline-block' : 'none';
      });
    });
    ov.querySelectorAll('[data-dipi-custom]').forEach(inp => {
      inp.addEventListener('click', e => e.stopPropagation());
    });
    ov.querySelectorAll('[data-dipi-update]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.dipiUpdate;
        const a = state.applicants.find(x => x.id === id);
        if (!a || !a.aid) return;
        const sel = ov.querySelector(`[data-dipi-sel="${id}"]`);
        const customInput = ov.querySelector(`[data-dipi-custom="${id}"]`);
        const newStatus = sel.value;
        const customText = (customInput && customInput.value || '').trim();
        if (newStatus === 'Custom' && !customText) {
          showToast('Enter custom reason text');
          return;
        }
        btn.disabled = true;
        const oldLabel = btn.textContent;
        btn.textContent = '...';
        try {
          const result = await changeDipiStatus(a.aid, newStatus, customText);
          if (result.ok) {
            const confDisplay = result.confno ? ` (${result.confno})` : '';
            a.dipiStatus = newStatus + confDisplay;
            if (result.confno) a.confno = result.confno;
            await saveApplicants();
            showToast(a.name.split(' ')[0] + ' → dipi: ' + newStatus + (result.confno ? ' / ' + result.confno : ''));
            render();
          } else {
            btn.disabled = false;
            btn.textContent = oldLabel;
            showToast('Failed: ' + (result.error || 'unknown'));
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = oldLabel;
          showToast('Network error: ' + err.message);
        }
      });
    });

    if (searchHadFocus) {
      const sb = ov.querySelector('#dt-search-box');
      if (sb) { sb.focus(); try { sb.setSelectionRange(searchCaret, searchCaret); } catch (e) {} }
    }
  }

  function closeTracker() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById('dipi-tracker-style')?.remove();
  }

  async function open(opts = {}) {
    if (!db) await openDB();
    const all = await dbGetAll('sessions');
    state.sessions = all;
    // Load latest if available
    if (all.length && !state.activeId) {
      const last = all[all.length - 1];
      state.activeId = last.id;
      state.applicants = last.applicants || [];
      state.courseTitle = last.title || '';
      state.courseDates = last.dates || '';
      state.courseType = last.courseType || '';
    }
    render();
  }

  async function importPublic(apps, title, dates, courseType) {
    if (!db) await openDB();
    await importApps(apps, title, dates, courseType);
  }

  root.DipiTracker = {
    open, import: importPublic, close: closeTracker,
    _internal: { parseCourseStart, deadlineInfo, priorityRank, validateBackup, mergeSessions, isPool, backfillCandidates }, // pure, for tests
  };
})(typeof window !== 'undefined' ? window : globalThis);
