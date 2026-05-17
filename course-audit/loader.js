// loader.js - GitHub Pages entry point for dipi.vridhamma.org course audit
// Pulls in audit.js (rule engine), extracts attendees from the DataTables instance,
// runs audit, renders overlay panel, caches data for cross-course checks.
//
// Host at: https://YOUR-USER.github.io/course-audit/loader.js
// Sibling: audit.js

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
    return 'https://YOUR-USER.github.io/course-audit/';
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
    const dt = $tbl.DataTable();
    return dt.rows().data().toArray();
  }

  // ---- 3. Helpers to clean dipi.vridhamma.org row format ----
  const stripHtml = (s) => {
    if (s == null) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = String(s);
    return tmp.textContent.replace(/\s+/g, ' ').trim();
  };

  // dipi stores name as: <div id="..."><a href="/app/{aid}/edit">Full Name</a></div>&nbsp;(<a>PDF</a>) (Sevak)
  const cleanName = (s) => {
    if (s == null) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = String(s);
    const link = tmp.querySelector('a[href*="/app/"]');
    const base = link ? link.textContent : tmp.textContent;
    const sevak = /\(Sevak\)/i.test(String(s)) ? ' (Sevak)' : '';
    return base.replace(/\s+/g, ' ').trim() + sevak;
  };

  // ID Type / ID No: dipi has separate columns; only one is set
  const resolveId = (r) => {
    if (r.aadhar)  return { type: 'Aadhar',   num: r.aadhar };
    if (r.pancard) return { type: 'Pan card', num: r.pancard };
    if (r.voterid) return { type: 'Voter ID', num: r.voterid };
    if (r.passport)return { type: 'Passport', num: r.passport };
    return { type: null, num: null };
  };

  // "10 Day / 2026 / 20th-May to 31st-May" -> "2026-05-20"
  const parseCourseStart = (s) => {
    if (!s) return null;
    const m = String(s).match(/(\d{4})\s*\/\s*(\d+)(?:st|nd|rd|th)?[-\s]+([A-Za-z]+)/);
    if (!m) return null;
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mo = months[m[3].slice(0,3).toLowerCase()];
    if (!mo) return null;
    return `${m[1]}-${String(mo).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
  };

  // Map a dipi row -> the column names that audit.js expects (matching the xlsx export)
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
      'Physical Health': r.physical || '',
      'Mental Health': r.mental || '',
      Medication: r.medication || '',
      'Pregnancy Details': r.pregnant || '',
      'Other Meditation Techniques': r.othertechnique || '',
      'Emergency Name': stripHtml(r.emergency_name),
      'Emergency Relation': stripHtml(r.emergency_relation),
      'Emergency Contact No': r.emergency_num || '',
      Language: r.lang_discourse || '',
      Addiction: r.addiction || '',
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
  catch (e) {
    alert('Course Audit: ' + e.message);
    return;
  }
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

  // ---- 7. Overlay panel ----
  document.getElementById('course-audit-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'course-audit-panel';
  panel.style.cssText = `
    position:fixed; top:20px; right:20px; width:520px; max-height:85vh;
    background:#fff; border:1px solid #333; border-radius:8px;
    box-shadow:0 4px 24px rgba(0,0,0,.25); z-index:2147483647;
    font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#222;
    overflow:auto; padding:14px;`;

  const renderList = (arr) => {
    if (!arr.length) return '<em style="color:#888">none</em>';
    return arr.map(f => {
      const extras = Object.keys(f)
        .filter(k => !['check','row','name'].includes(k))
        .map(k => `<code style="color:#555">${k}=${typeof f[k]==='string'?f[k]:JSON.stringify(f[k])}</code>`)
        .join(' ');
      const aid = mapped[f.row]?._aid;
      const editLink = aid ? `<a href="/app/${aid}/edit" target="_blank" style="color:#06c">edit</a>` : '';
      return `<div style="margin:4px 0;padding:6px 8px;background:#f7f7f7;border-radius:4px;border-left:3px solid #c33">
        <code>r${f.row}</code> ${editLink} <b>${f.name||''}</b><br>
        <small style="color:#666">${f.check}</small> ${extras}
      </div>`;
    }).join('');
  };

  const activeCount = mapped.filter(r => String(r.Status).toLowerCase() === 'expected').length;
  const cached = loadCache().map(c => `${c.courseId} (${c.rows.length})`).join(', ');

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <b style="font-size:14px">Course Audit</b><br>
        <small style="color:#666">${courseLabel} (${courseKey}) — ${mapped.length} rows, ${activeCount} active</small>
      </div>
      <div>
        <button id="ca-claude" style="margin-right:4px">Send to Claude</button>
        <button id="ca-export" style="margin-right:4px">Export JSON</button>
        <button id="ca-clear-cache" style="margin-right:4px" title="Clear cross-course cache">Clear</button>
        <button id="ca-close">×</button>
      </div>
    </div>
    <details open><summary><b style="color:#c33">Hard errors</b> (${findings.hardErrors.length})</summary>${renderList(findings.hardErrors)}</details>
    <details ${findings.safety.length?'open':''}><summary><b style="color:#e80">Safety</b> (${findings.safety.length})</summary>${renderList(findings.safety)}</details>
    <details ${findings.crossCourse.length?'open':''}><summary><b style="color:#06c">Cross-course</b> (${findings.crossCourse.length})</summary>${renderList(findings.crossCourse)}</details>
    <details><summary>Soft / advisory (${findings.soft.length})</summary>${renderList(findings.soft)}</details>
    <details><summary>Sensitive field counts</summary>
      <pre style="margin:6px 0;padding:6px;background:#f6f6f6;border-radius:4px">${JSON.stringify(findings.sensitiveCounts,null,2)}</pre>
    </details>
    <details><summary>Cache (cross-course base)</summary>
      <div style="font-size:11px;color:#666;margin:6px 0">${cached || '(empty)'}</div>
    </details>`;

  document.body.appendChild(panel);
  panel.querySelector('#ca-close').onclick = () => panel.remove();
  panel.querySelector('#ca-clear-cache').onclick = () => {
    if (confirm('Clear cross-course cache?')) { localStorage.removeItem(CACHE_KEY); panel.remove(); }
  };
  panel.querySelector('#ca-export').onclick = () => {
    const blob = new Blob([JSON.stringify({ courseId, courseLabel, findings }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit_${courseId}.json`;
    a.click();
  };
  panel.querySelector('#ca-claude').onclick = async () => {
    const sensFields = ['Physical Health','Mental Health','Medication','Pregnancy Details','Addiction','Other Info'];
    const judgmentRows = mapped
      .map((r,i) => ({ i, r }))
      .filter(({r}) => String(r.Status).toLowerCase() === 'expected')
      .filter(({r}) => sensFields.some(f => r[f] && !['','no','na','none','-'].includes(String(r[f]).trim().toLowerCase())));

    const lines = judgmentRows.map(({i,r}) => {
      const fields = sensFields.filter(f => r[f] && String(r[f]).trim()).map(f => `${f}: ${r[f]}`).join(' | ');
      return `r${i} aid=${r._aid} ${r.Name} (${r.Gender}, age ${r.Age}) -- ${fields}`;
    }).join('\n');

    const prompt = `Vipassana 10-day course teacher review.
Course: ${courseLabel}.
Below are active (Expected) applicants who disclosed something in Physical Health / Mental Health / Medication / Pregnancy / Addiction / Other Info.

For each, give a one-line judgment: PROCEED / TEACHER-CALL / DEFER-TO-NEXT-COURSE / DECLINE, with the reason. Be conservative on active mental health symptoms, recent surgery, third-trimester pregnancy, and severe addictions.

${lines}`;

    try {
      await navigator.clipboard.writeText(prompt);
      alert(`Copied prompt for ${judgmentRows.length} applicants.\n\nPaste into Claude.ai or Claude in Chrome.`);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = prompt; ta.style.cssText='position:fixed;top:0;left:0;width:100%;height:200px;z-index:2147483647';
      document.body.appendChild(ta); ta.select();
      alert('Clipboard blocked. Manual copy from the textarea now at top of page.');
    }
  };
})();
