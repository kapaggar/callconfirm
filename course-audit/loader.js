// loader.js - GitHub Pages entry point for dipi.vridhamma.org course audit
// Hosted at: https://kapaggar.github.io/callconfirm/course-audit/loader.js
// Sibling: audit.js
//
// Changes vs previous version:
//  - Default UI: split-view iframe (page shrunk to 60vw, panel iframe at 40vw right).
//  - Toggle button switches to floating overlay if preferred. Mode is remembered.
//  - Section headers (Hard errors / Safety / Cross-course / Soft) at 16px vs 12px rows.
//  - activeCount now includes both Expected and Confirmed status.
//  - "Send to Claude" applies a noise filter:
//      * skip Pregnancy Details for males or when value starts with "No"
//      * skip values that are pure noise (happy/good/normal/single states/geo names/empty)
//      * skip rows where every sensitive field was filtered out

(async function () {
  'use strict';

  const HOST_OK = /(^|\.)vridhamma\.org$/i.test(location.hostname);
  if (!HOST_OK) {
    alert('Course Audit: not on vridhamma.org. Run on a /search-course/ page.');
    return;
  }

  // ---- 1. Load audit engine if not already loaded ----
  const SCRIPT_BASE = (function () {
    const cs = document.currentScript;
    if (cs && cs.src) return new URL('.', cs.src).toString();
    return 'https://kapaggar.github.io/callconfirm/course-audit/';
  })();

  if (!window.CourseAudit) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = SCRIPT_BASE + 'audit.js?v=' + Date.now();
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // ---- 2. Adapter: pull data from DataTables instance ----
  function extractFromDataTables() {
    const $ = window.jQuery || window.$;
    if (!$) throw new Error('jQuery not found on page');
    const $tbl = $('#table-applicants');
    if (!$tbl.length) throw new Error('#table-applicants not present on this page');
    if (!$.fn.DataTable.isDataTable($tbl)) throw new Error('DataTable not yet initialized; wait a few seconds and retry');
    return $tbl.DataTable().rows().data().toArray();
  }

  // ---- 3. Cleaners ----
  const stripHtml = (s) => {
    if (s == null) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = String(s);
    return tmp.textContent.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  };

  const cleanName = (s) => {
    if (s == null) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = String(s);
    const link = tmp.querySelector('a[href*="/app/"]');
    const base = link ? link.textContent : tmp.textContent;
    const sevak = /\(Sevak\)/i.test(String(s)) ? ' (Sevak)' : '';
    return base.replace(/\s+/g, ' ').trim() + sevak;
  };

  const resolveId = (r) => {
    if (r.aadhar)  return { type: 'Aadhar',   num: r.aadhar };
    if (r.pancard) return { type: 'Pan card', num: r.pancard };
    if (r.voterid) return { type: 'Voter ID', num: r.voterid };
    if (r.passport)return { type: 'Passport', num: r.passport };
    return { type: null, num: null };
  };

  const parseCourseStart = (s) => {
    if (!s) return null;
    const m = String(s).match(/(\d{4})\s*\/\s*(\d+)(?:st|nd|rd|th)?[-\s]+([A-Za-z]+)/);
    if (!m) return null;
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mo = months[m[3].slice(0,3).toLowerCase()];
    if (!mo) return null;
    return `${m[1]}-${String(mo).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
  };

  const mapRow = (r) => {
    const id = resolveId(r);
    return {
      Name: cleanName(r.name),
      Gender: r.gender || '',
      Age: r.age || '',
      Courses: '',
      PhoneMobile: r.contact_mobile || '',
      PhoneHome: r.contact_home || '',
      PhoneOffice: r.contact_office || '',
      Email: r.contact_email || '',
      Education: r.Education || '',
      Occupation: r.occupation || r.Occ || '',
      Company: r.company || r.Company || '',
      'Designation/Dept': [r.designation || r.Designation, r.Dept].filter(Boolean).join(' / '),
      Address: r.address || '',
      Pin: r.pin || '',
      City: r.city || '',
      State: r.state || '',
      Country: r.country || '',
      Accommodation: r.acc || '',
      'ID Type': id.type,
      'ID No': id.num,
      'Conf No': r.confno || '',
      'Physical Health': stripHtml(r.physical),
      'Mental Health': stripHtml(r.mental),
      Medication: stripHtml(r.medication),
      'Pregnancy Details': stripHtml(r.pregnant),
      'Other Meditation Techniques': stripHtml(r.othertechnique),
      'Emergency Name': stripHtml(r.emergency_name),
      'Emergency Relation': stripHtml(r.emergency_relation),
      'Emergency Contact No': r.emergency_num || '',
      Language: r.lang_discourse || '',
      Addiction: stripHtml(r.addiction),
      'Other Info': stripHtml(r.extra) || stripHtml(r.note),
      'Friend Family': r.friend_family || '',
      'ID Issued Date': r.id_issued_date || '',
      'ID Issued By': r.id_issued_by || '',
      DOB: r.dob || '',
      Nationality: r.nationality || '',
      Status: r.app_status || '',
      _aid: r.aid,
      _courseid: r.courseid,
      _centreid: r.centreid,
      _course_label: r.course,
    };
  };

  // ---- 4. Extract + map ----
  let raw;
  try { raw = extractFromDataTables(); }
  catch (e) { alert('Course Audit: ' + e.message); return; }
  if (!raw.length) { alert('Course Audit: table is empty.'); return; }

  const mapped = raw.map(mapRow);
  const courseLabel = mapped[0]._course_label || '';
  const courseStart = parseCourseStart(courseLabel) || '';
  const courseKey = `${mapped[0]._centreid || '?'}/${mapped[0]._courseid || '?'}`;
  const courseId = courseStart || courseKey;

  // ---- 5. Cross-course cache ----
  const CACHE_KEY = 'courseAudit.cache';
  const loadCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch { return []; } };
  const saveCache = (c) => {
    const arr = loadCache().filter(x => x.courseId !== c.courseId);
    arr.push(c);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(arr.slice(-12))); }
    catch (e) { console.warn('cache write failed', e); }
  };
  saveCache({ courseId, courseKey, courseLabel, ts: Date.now(), rows: mapped });

  // ---- 6. Run audit ----
  const findings = window.CourseAudit.run(mapped, {
    courseStart,
    courseId,
    allCourses: loadCache().map(c => ({ courseId: c.courseId, rows: c.rows })),
    minAge: 18,
    maxAge: 95,
  });

  // ---- 7. Noise filter (for Send to Claude) ----
  // Exact-match noise: lowercased, whitespace-collapsed, trimmed
  const NOISE_EXACT = new Set([
    '', 'no', 'na', 'n/a', 'none', 'nil', '-', '—', '.', '..', '...', '*',
    // single-word positive vibes
    'normal', 'fine', 'healthy', 'good', 'happy', 'cheerful', 'stable',
    'best', 'nice', 'cordial', 'ok', 'okay', 'cool', 'well', 'great',
    'satisfied', 'peaceful', 'positive', 'wonderful', 'sympathy',
    // common multi-word generic positive
    'very good', 'so good', 'all good', 'feeling good', 'feeling well',
    'happy and good', 'good and happy', 'happy and cheerful',
    'happy and satisfied', 'happy ,cheerful', 'happy , cheerful',
    'happy ,sad', 'happy, sad', 'happy and sad anxious stressed',
    'happy - everything is going fine', 'happy - everything is going fine.',
    'netural', 'neutral', 'fine and good', 'a bit tough',
    // single negative states alone (not actionable; multi-word disclosures pass through)
    'stressed', 'stresssed', 'stresssesd', 'confused', 'anxious', 'sad',
    'stressed,confused', 'confused state of mind',
    // NOTE: 'depressed' deliberately NOT in noise — clinical word, keep even alone
  ]);

  // Geographic noise — cities/states sometimes typed into Other Info
  const GEO_NOISE = new Set([
    'india',
    'delhi', 'new delhi', 'mumbai', 'bombay', 'bangalore', 'bengaluru',
    'noida', 'gurgaon', 'gurugram', 'kolkata', 'calcutta', 'chennai',
    'hyderabad', 'pune', 'ahmedabad', 'jaipur', 'lucknow', 'agra',
    'faridabad', 'ghaziabad', 'meerut', 'kanpur', 'varanasi',
    'uttar pradesh', 'up', 'haryana', 'punjab', 'rajasthan',
    'maharashtra', 'karnataka', 'tamil nadu', 'kerala', 'west bengal',
    'bihar', 'jharkhand', 'odisha', 'orissa', 'assam', 'telangana',
    'andhra pradesh', 'gujarat', 'madhya pradesh', 'chhattisgarh',
    'uttarakhand', 'himachal pradesh', 'jammu and kashmir', 'goa',
    'sikkim', 'tripura', 'manipur', 'nagaland', 'mizoram',
    'arunachal pradesh', 'meghalaya'
  ]);

  function isNoiseValue(v) {
    if (v == null) return true;
    const s = String(v).replace(/&nbsp;/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) return true;
    if (NOISE_EXACT.has(s)) return true;
    if (GEO_NOISE.has(s)) return true;
    return false;
  }

  function fieldIsMeaningful(field, value, row) {
    if (value == null) return false;
    if (field === 'Pregnancy Details') {
      if (String(row.Gender || '').toLowerCase() === 'male') return false;
      if (/^no\b/i.test(String(value).trim())) return false;
    }
    if (isNoiseValue(value)) return false;
    return true;
  }

  function buildClaudePrompt() {
    const sensFields = ['Physical Health','Mental Health','Medication','Pregnancy Details','Addiction','Other Info'];
    const ACTIVE = new Set(['expected', 'confirmed']);
    const judgmentRows = mapped
      .map((r,i) => ({ i, r }))
      .filter(({r}) => ACTIVE.has(String(r.Status).toLowerCase()))
      .map(({i,r}) => {
        const kept = sensFields.filter(f => fieldIsMeaningful(f, r[f], r));
        return { i, r, kept };
      })
      .filter(({kept}) => kept.length > 0);

    const lines = judgmentRows.map(({i,r,kept}) => {
      const fields = kept.map(f => `${f}: ${String(r[f]).replace(/\s+/g,' ').trim()}`).join(' | ');
      const sevak = /\(Sevak\)/.test(r.Name) ? ' [SEVAK]' : '';
      return `r${i} aid=${r._aid} ${r.Name.replace(' (Sevak)','')}${sevak} (${r.Gender}, age ${r.Age}) -- ${fields}`;
    }).join('\n');

    const text = `Vipassana 10-day course teacher review.
Course: ${courseLabel}.

The following ${judgmentRows.length} active applicants disclosed something in Physical Health, Mental Health, Medication, Pregnancy, Addiction, or Other Info. Generic positives ("happy", "good", "normal"), single-word negative states ("stressed", "confused"), geographic names, and "No" pregnancy for males have already been filtered out.

For each, give a one-line verdict using ONE of:
  PROCEED       -- no concern, normal disclosure
  TEACHER-CALL  -- needs assistant teacher to call before course
  DEFER         -- defer to a later course (recent surgery, third-trimester pregnancy, acute crisis)
  DECLINE       -- not suitable for a silent 10-day at this time

Be conservative on: active mental health symptoms with current crisis, surgery within 3 months, third-trimester pregnancy, severe addiction with concurrent depression, psychiatric medication changes within 30 days. Sevaks (servers) face a slightly higher bar since they have less structured course support.

${lines}`;

    return { text, count: judgmentRows.length };
  }

  // ---- 8. UI ----
  const MODE_KEY = 'courseAudit.mode';
  let mode = localStorage.getItem(MODE_KEY) || 'split'; // 'split' | 'float'

  function tearDown() {
    document.getElementById('course-audit-iframe')?.remove();
    document.getElementById('course-audit-panel')?.remove();
    const w = document.getElementById('ca-page-wrapper');
    if (w) {
      while (w.firstChild) document.body.insertBefore(w.firstChild, w);
      w.remove();
    }
  }
  tearDown();

  const ACTIVE = new Set(['expected', 'confirmed']);
  const activeCount = mapped.filter(r => ACTIVE.has(String(r.Status).toLowerCase())).length;

  const renderList = (arr) => {
    if (!arr.length) return '<em style="color:#888;font-size:12px">none</em>';
    return arr.map(f => {
      const extras = Object.keys(f)
        .filter(k => !['check','row','name'].includes(k))
        .map(k => `<code class="x">${k}=${typeof f[k]==='string'?f[k]:JSON.stringify(f[k])}</code>`)
        .join(' ');
      const aid = mapped[f.row]?._aid;
      const editLink = aid ? `<a href="/app/${aid}/edit" target="_top">edit</a>` : '';
      return `<div class="finding">
        <code>r${f.row}</code> ${editLink} <b>${f.name||''}</b><br>
        <span class="check">${f.check}</span> ${extras}
      </div>`;
    }).join('');
  };

  const cached = loadCache().map(c => `${c.courseId} (${c.rows.length})`).join(', ');

  const buildPanelHTML = () => `
    <div class="hdr">
      <div class="hdr-left">
        <div class="title">Course Audit</div>
        <div class="sub1">${courseLabel}</div>
        <div class="sub2">${courseKey} — ${mapped.length} rows, ${activeCount} active</div>
      </div>
      <div class="hdr-right">
        <button id="ca-claude">Send to Claude</button>
        <button id="ca-export">Export JSON</button>
        <button id="ca-mode" title="Toggle layout">⇆ ${mode==='split'?'Float':'Split'}</button>
        <button id="ca-clear-cache" title="Clear cross-course cache">Clear</button>
        <button id="ca-close">×</button>
      </div>
    </div>

    <details open>
      <summary><span class="sec sec-red">Hard errors</span> <span class="cnt">(${findings.hardErrors.length})</span></summary>
      ${renderList(findings.hardErrors)}
    </details>
    <details ${findings.safety.length?'open':''}>
      <summary><span class="sec sec-amber">Safety</span> <span class="cnt">(${findings.safety.length})</span></summary>
      ${renderList(findings.safety)}
    </details>
    <details ${findings.crossCourse.length?'open':''}>
      <summary><span class="sec sec-blue">Cross-course</span> <span class="cnt">(${findings.crossCourse.length})</span></summary>
      ${renderList(findings.crossCourse)}
    </details>
    <details>
      <summary><span class="sec sec-gray">Soft / advisory</span> <span class="cnt">(${findings.soft.length})</span></summary>
      ${renderList(findings.soft)}
    </details>
    <details>
      <summary><span class="sec-min">Sensitive field counts</span></summary>
      <pre>${JSON.stringify(findings.sensitiveCounts,null,2)}</pre>
    </details>
    <details>
      <summary><span class="sec-min">Cache (cross-course base)</span></summary>
      <div class="cache">${cached || '(empty)'}</div>
    </details>`;

  const PANEL_CSS = `
    html,body { color-scheme:light; }
    body { margin:0; padding:14px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:13px; color:#222; background:#fff; }
    button { cursor:pointer; border:1px solid #999; background:#f5f5f5; border-radius:3px; font-size:11px; padding:4px 8px; }
    button:hover { background:#e8e8e8; }
    code { font-family:ui-monospace,'SF Mono',Consolas,monospace; font-size:11px; }
    .hdr { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:14px; }
    .hdr-left { flex:1; min-width:0; }
    .title { font-size:17px; font-weight:600; }
    .sub1 { font-size:12px; color:#444; margin-top:3px; }
    .sub2 { font-size:11px; color:#888; margin-top:2px; }
    .hdr-right { display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; max-width:50%; }
    details { margin:4px 0; }
    summary { cursor:pointer; padding:6px 0; list-style:none; user-select:none; }
    summary::-webkit-details-marker { display:none; }
    summary::before { content:'▸ '; color:#666; font-size:11px; }
    details[open] > summary::before { content:'▾ '; }
    .sec { font-weight:700; font-size:16px; }
    .sec-min { font-weight:600; font-size:13px; color:#666; }
    .sec-red { color:#c33; }
    .sec-amber { color:#e80; }
    .sec-blue { color:#06c; }
    .sec-gray { color:#666; }
    .cnt { font-size:13px; color:#666; font-weight:normal; }
    .finding { margin:4px 0; padding:6px 8px; background:#f7f7f7; border-radius:4px; border-left:3px solid #c33; font-size:12px; line-height:1.4; }
    .finding code { color:#333; background:#eee; padding:0 4px; border-radius:2px; }
    .finding code.x { background:transparent; color:#555; }
    .finding a { color:#06c; text-decoration:none; margin-right:4px; }
    .finding .check { color:#666; font-size:11px; }
    pre { margin:6px 0; padding:8px; background:#f6f6f6; border-radius:4px; font-size:11px; overflow:auto; }
    .cache { font-size:11px; color:#666; margin:6px 0; }
  `;

  function wireHandlers(scope) {
    const $ = (id) => scope.getElementById(id);
    $('ca-close').onclick = () => tearDown();
    $('ca-clear-cache').onclick = () => {
      if (confirm('Clear cross-course cache?')) {
        localStorage.removeItem(CACHE_KEY);
        tearDown();
      }
    };
    $('ca-mode').onclick = () => {
      mode = (mode === 'split') ? 'float' : 'split';
      localStorage.setItem(MODE_KEY, mode);
      tearDown();
      buildUI();
    };
    $('ca-export').onclick = () => {
      const blob = new Blob([JSON.stringify({ courseId, courseLabel, findings }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `audit_${courseId}.json`;
      a.click();
    };
    $('ca-claude').onclick = async () => {
      const { text, count } = buildClaudePrompt();
      if (count === 0) { alert('No disclosures after noise filter. Nothing to send.'); return; }
      try {
        await navigator.clipboard.writeText(text);
        alert(`Copied prompt for ${count} applicants (filtered from raw).\n\nPaste into Claude.ai or Claude in Chrome.`);
      } catch (e) {
        const ta = scope.createElement('textarea');
        ta.value = text;
        ta.style.cssText='position:fixed;top:0;left:0;width:100%;height:200px;z-index:2147483647';
        scope.body.appendChild(ta);
        ta.select();
        alert(`Clipboard blocked. Manual copy from textarea at top of ${scope===document?'page':'panel'}.`);
      }
    };
  }

  function buildSplitUI() {
    // Wrap page content (except our injected nodes) to 60vw column
    const ourIds = new Set(['course-audit-iframe', 'course-audit-panel', 'ca-page-wrapper']);
    const wrapper = document.createElement('div');
    wrapper.id = 'ca-page-wrapper';
    wrapper.style.cssText = 'width:60vw; max-width:60vw; overflow-x:auto; box-sizing:border-box;';
    const kids = Array.from(document.body.children).filter(c => !ourIds.has(c.id));
    kids.forEach(k => wrapper.appendChild(k));
    document.body.insertBefore(wrapper, document.body.firstChild);

    // Iframe on right 40vw
    const iframe = document.createElement('iframe');
    iframe.id = 'course-audit-iframe';
    iframe.style.cssText = `position:fixed; top:0; right:0; width:40vw; height:100vh; border:0;
      border-left:2px solid #333; z-index:2147483647; background:#fff;
      box-shadow:-4px 0 24px rgba(0,0,0,.3); color-scheme:light;`;
    iframe.srcdoc = `<!DOCTYPE html><html><head>
<base target="_top">
<meta name="color-scheme" content="light">
<style>${PANEL_CSS}</style>
</head><body>${buildPanelHTML()}</body></html>`;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try { wireHandlers(iframe.contentDocument); }
      catch (e) { console.error('iframe handler wire failed', e); }
    };
  }

  function buildFloatUI() {
    const panel = document.createElement('div');
    panel.id = 'course-audit-panel';
    panel.style.cssText = `position:fixed; top:20px; right:20px; width:580px; max-height:88vh;
      background:#fff; color:#222; border:1px solid #333; border-radius:8px;
      box-shadow:0 4px 24px rgba(0,0,0,.3); z-index:2147483647; overflow:auto;
      color-scheme:light;`;
    // Inject style scoped via id selector
    const style = document.createElement('style');
    style.textContent = `#course-audit-panel { ${''} }
      #course-audit-panel * { box-sizing:border-box; }
      ${PANEL_CSS.replace(/(^|\})\s*body\s*\{/g, '$1 #course-audit-panel {')
                 .replace(/(^|\})\s*html,body\s*\{/g, '$1 #course-audit-panel {')}`;
    document.head.appendChild(style);
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);
    wireHandlers(document);
  }

  function buildUI() {
    if (mode === 'split') buildSplitUI();
    else buildFloatUI();
  }

  buildUI();
})();
