// loader.js - GitHub Pages entry point for dipi.vridhamma.org course audit
// Hosted at: https://kapaggar.github.io/callconfirm/course-audit/loader.js
//
// New in this revision:
//   - "Send to WhatsApp" button with recipient management
//   - Click-to-chat path (wa.me URL) opens WhatsApp Web/desktop pre-filled
//   - Saved recipients and recent-numbers list, both in localStorage
//   - Summary format: counts + top issues per category (Option A)

(async function () {
  'use strict';

  const HOST_OK = /(^|\.)vridhamma\.org$/i.test(location.hostname);
  if (!HOST_OK) {
    alert('Course Audit: not on vridhamma.org. Run on a /search-course/ page.');
    return;
  }

  // ---- 1. Load audit engine ----
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

  // ---- 2. Adapter: pull data from DataTables ----
  function extractFromDataTables() {
    const $ = window.jQuery || window.$;
    if (!$) throw new Error('jQuery not found on page');
    const $tbl = $('#table-applicants');
    if (!$tbl.length) throw new Error('#table-applicants not present on this page');
    if (!$.fn.DataTable.isDataTable($tbl)) throw new Error('DataTable not yet initialized; wait and retry');
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
  const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
  const looksLikePan = (v) => PAN_SHAPE.test(String(v == null ? '' : v).replace(/\s+/g, ''));
  const resolveId = (r) => {
    // dipi's edit form has a single Identifier (document_id) field + Document Type
    // dropdown; a PAN sometimes lands in the aadhar column when type = Pancard.
    // Classify by content so a PAN value is never audited under Aadhar rules.
    if (r.aadhar && looksLikePan(r.aadhar)) return { type: 'Pan card', num: r.aadhar };
    if (r.aadhar)   return { type: 'Aadhar',   num: r.aadhar };
    if (r.pancard)  return { type: 'Pan card', num: r.pancard };
    if (r.voterid)  return { type: 'Voter ID', num: r.voterid };
    if (r.passport) return { type: 'Passport', num: r.passport };
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
      'Aadhar Raw': looksLikePan(r.aadhar) ? '' : (r.aadhar || ''),
      'PAN Raw': r.pancard || (looksLikePan(r.aadhar) ? r.aadhar : ''),
      'Voter ID Raw': r.voterid || '',
      'Passport Raw': r.passport || '',
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
  const courseUrl = `${location.origin}/search-course/${mapped[0]._centreid}/${mapped[0]._courseid}`;

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

  // ---- 7. Noise filter (Send to Claude) ----
  const NOISE_EXACT = new Set([
    '', 'no', 'na', 'n/a', 'none', 'nil', '-', '—', '.', '..', '...', '*',
    'normal', 'fine', 'healthy', 'good', 'happy', 'cheerful', 'stable',
    'best', 'nice', 'cordial', 'ok', 'okay', 'cool', 'well', 'great',
    'satisfied', 'peaceful', 'positive', 'wonderful', 'sympathy',
    'very good', 'so good', 'all good', 'feeling good', 'feeling well',
    'happy and good', 'good and happy', 'happy and cheerful',
    'happy and satisfied', 'happy ,cheerful', 'happy , cheerful',
    'happy ,sad', 'happy, sad', 'happy and sad anxious stressed',
    'happy - everything is going fine', 'happy - everything is going fine.',
    'netural', 'neutral', 'fine and good', 'a bit tough',
    'stressed', 'stresssed', 'stresssesd', 'confused', 'anxious', 'sad',
    'stressed,confused', 'confused state of mind',
  ]);
  const GEO_NOISE = new Set([
    'india', 'delhi', 'new delhi', 'mumbai', 'bombay', 'bangalore', 'bengaluru',
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
    const rows = mapped
      .map((r,i) => ({ i, r }))
      .filter(({r}) => ACTIVE.has(String(r.Status).toLowerCase()))
      .map(({i,r}) => ({ i, r, kept: sensFields.filter(f => fieldIsMeaningful(f, r[f], r)) }))
      .filter(({kept}) => kept.length > 0);

    // Sort key: Conf No prefix group (SM/SF/OM/OF/NM/NF) then by name
    const groupOrder = ['SM','OM','NM','SF','OF','NF']; // males first, then females, sevak→old→new
    const groupOf = (confNo) => {
      const c = String(confNo || '').trim().toUpperCase();
      const m = c.match(/^([A-Z]{2})/);
      return (m && groupOrder.includes(m[1])) ? m[1] : 'ZZ';
    };
    const numOf = (confNo) => {
      const m = String(confNo || '').match(/\d+/);
      return m ? parseInt(m[0], 10) : 9999;
    };

    // Two big buckets: male (SM, OM, NM) and female (SF, OF, NF)
    const maleRows = [];
    const femaleRows = [];
    rows.forEach(rec => {
      const g = String(rec.r.Gender || '').toLowerCase();
      const target = (g === 'female') ? femaleRows : maleRows;
      target.push(rec);
    });

    const sortRows = (arr) => arr.sort((a,b) => {
      const ga = groupOrder.indexOf(groupOf(a.r['Conf No']));
      const gb = groupOrder.indexOf(groupOf(b.r['Conf No']));
      if (ga !== gb) return (ga<0?99:ga) - (gb<0?99:gb);
      // within same group, sort by Conf No number then name
      const na = numOf(a.r['Conf No']);
      const nb = numOf(b.r['Conf No']);
      if (na !== nb) return na - nb;
      return String(a.r.Name).localeCompare(String(b.r.Name));
    });
    sortRows(maleRows);
    sortRows(femaleRows);

    // Compute name column width per bucket for nice alignment
    const fmtLine = (rec, nameWidth) => {
      const conf = String(rec.r['Conf No'] || '').trim();
      const sevak = /\(Sevak\)/.test(rec.r.Name) ? ' [SEVAK]' : '';
      const nameClean = rec.r.Name.replace(' (Sevak)', '');
      const fields = rec.kept.map(f => `${f}: ${String(rec.r[f]).replace(/\s+/g,' ').trim()}`).join(' | ');
      const namePart = `${nameClean}${sevak}`.padEnd(nameWidth);
      const confPart = conf.padEnd(5);
      return `${confPart} ${namePart} (${rec.r.Gender}, age ${rec.r.Age}) -- ${fields}`;
    };

    const buildSection = (label, recs) => {
      if (!recs.length) return '';
      const nameWidth = Math.max(0, ...recs.map(r => r.r.Name.replace(' (Sevak)','').length + (/\(Sevak\)/.test(r.r.Name) ? 7 : 0))) ;
      return [label, ...recs.map(r => fmtLine(r, Math.min(nameWidth, 30)))].join('\n');
    };

    const sections = [];
    if (maleRows.length)   sections.push(buildSection(`Males (${maleRows.length}):`, maleRows));
    if (femaleRows.length) sections.push(buildSection(`Females (${femaleRows.length}):`, femaleRows));

    const text = `Vipassana 10-day course teacher review.
Course: ${courseLabel}.

The following ${rows.length} active applicants disclosed something in Physical Health, Mental Health, Medication, Pregnancy, Addiction, or Other Info. Generic positives, single-word negative states, geographic names, and "No" pregnancy for males are filtered out.

For each, give a one-line verdict using ONE of:
  PROCEED       -- no concern
  TEACHER-CALL  -- needs assistant teacher call before course
  DEFER         -- defer to a later course (recent surgery, third-trimester pregnancy, acute crisis)
  DECLINE       -- not suitable for a silent 10-day at this time

Be conservative on: active mental health symptoms with current crisis, surgery within 3 months, third-trimester pregnancy, severe addiction with concurrent depression, psychiatric medication changes within 30 days. Sevaks face a slightly higher bar.

${sections.join('\n\n')}`;
    return { text, count: rows.length };
  }

  // ---- 8. WhatsApp summary builder ----
  const WA_RECIPIENTS_KEY = 'courseAudit.whatsapp.recipients'; // [{label, e164}]
  const WA_RECENT_KEY     = 'courseAudit.whatsapp.recent';     // [e164, ...] last 5
  const loadJSON = (k, fb=[]) => { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch { return fb; } };
  const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  function shortCheck(f) {
    switch (f.check) {
      case 'missing_field':            return `missing ${f.field}`;
      case 'phone_short':              return 'phone too short';
      case 'phone_prefix_invalid':     return 'invalid phone prefix';
      case 'email_missing':            return 'missing email';
      case 'email_malformed':          return 'malformed email';
      case 'aadhar_masked':            return 'Aadhar masked';
      case 'aadhar_length':            return 'Aadhar wrong length';
      case 'id_missing':               return 'ID Type or ID No missing';
      case 'pan_missing':              return 'PAN missing';
      case 'pan_invalid':              return 'PAN invalid format';
      case 'id_type_concatenated':     return 'ID Type concat';
      case 'id_type_unknown':          return 'ID Type unknown';
      case 'id_type_mismatch':         return `${f.idType} field holds a ${f.looksLike}`;
      case 'age_dob_mismatch':         return `age vs DOB (listed ${f.listedAge}, calc ${f.calcAge})`;
      case 'age_under_min':            return `age ${f.age} under 18`;
      case 'age_over_max':             return `age ${f.age} over 95`;
      case 'conf_gender_mismatch':     return `Conf ${f.confNo} vs ${f.gender}`;
      case 'conf_no_duplicate':        return `duplicate Conf ${f.confNo}`;
      case 'within_file_duplicate':    return `${f.matchBy} dup rows ${(f.rows||[]).join(',')}`;
      case 'status_unknown':           return `unknown Status: ${f.value}`;
      case 'emergency_eq_self':        return 'emergency = own mobile';
      case 'emergency_partial':        return `emergency partial (name=${f.hasName?'Y':'N'}, phone=${f.hasPhone?'Y':'N'})`;
      case 'shared_mobile':            return `shared mobile rows ${(f.rows||[]).join(',')}`;
      case 'shared_email_unrelated':   return 'shared email, unrelated surnames';
      case 'name_title_prefix':        return `title "${f.prefix}" in name`;
      case 'cross_course_duplicate': {
        const where = (f.alsoIn || []).map(x => x.courseId).join(', ');
        const bys = new Set();
        (f.alsoIn || []).forEach(x => (x.matchBy || []).forEach(b => bys.add(b)));
        return `also in ${where} (by ${[...bys].join(', ')})`;
      }
      default: return f.check;
    }
  }

  function buildWhatsAppSummary({ maxPerSection = 3 } = {}) {
    const ACTIVE = new Set(['expected', 'confirmed']);
    const activeCount = mapped.filter(r => ACTIVE.has(String(r.Status).toLowerCase())).length;
    const lines = [];
    lines.push(`Audit: ${courseLabel}`);
    lines.push(`${courseKey} — ${mapped.length} rows, ${activeCount} active`);
    lines.push('');
    lines.push(`Issues: ${findings.hardErrors.length} hard | ${findings.safety.length} safety | ${findings.crossCourse.length} cross-course`);
    if (findings.hardErrors.length) {
      lines.push('');
      lines.push('Top hard errors:');
      findings.hardErrors.slice(0, maxPerSection).forEach(f => {
        lines.push(`• r${f.row} ${f.name || ''} — ${shortCheck(f)}`);
      });
      if (findings.hardErrors.length > maxPerSection) {
        lines.push(`  …+${findings.hardErrors.length - maxPerSection} more`);
      }
    }
    if (findings.crossCourse.length) {
      lines.push('');
      lines.push('Cross-course:');
      findings.crossCourse.slice(0, maxPerSection).forEach(f => {
        lines.push(`• r${f.row} ${f.name || ''} — ${shortCheck(f)}`);
      });
      if (findings.crossCourse.length > maxPerSection) {
        lines.push(`  …+${findings.crossCourse.length - maxPerSection} more`);
      }
    }
    if (findings.safety.length) {
      lines.push('');
      lines.push(`Safety: ${findings.safety.length} flag(s) — see audit panel`);
    }
    // sensitive counts
    const sens = findings.sensitiveCounts || {};
    const sensSummary = Object.entries(sens).filter(([,v]) => v>0).map(([k,v]) => `${k}: ${v}`).join(', ');
    if (sensSummary) {
      lines.push('');
      lines.push(`Sensitive: ${sensSummary}`);
    }
    lines.push('');
    lines.push(`View: ${courseUrl}`);
    return lines.join('\n');
  }

  function normalizeE164(cc, num) {
    const digits = String(num || '').replace(/\D/g, '');
    const code = String(cc || '').replace(/\D/g, '');
    if (!digits || !code) return null;
    const full = code + digits;
    if (full.length < 7 || full.length > 15) return null;
    // India sanity: 12 digits starting 91[6-9]
    if (code === '91' && !(digits.length === 10 && /^[6-9]/.test(digits))) return null;
    return full; // no leading +
  }

  function pushRecent(e164) {
    const list = loadJSON(WA_RECENT_KEY, []);
    const dedup = [e164, ...list.filter(x => x !== e164)];
    saveJSON(WA_RECENT_KEY, dedup.slice(0, 5));
  }
  function getSaved() { return loadJSON(WA_RECIPIENTS_KEY, []); }
  function setSaved(arr) { saveJSON(WA_RECIPIENTS_KEY, arr); }
  function maskNumber(e164) {
    if (!e164) return '';
    const s = String(e164);
    if (s.length <= 6) return s;
    return s.slice(0,2) + '…' + s.slice(-4);
  }

  function openWhatsAppFor(e164, text) {
    const url = `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ---- 9. UI ----
  const MODE_KEY = 'courseAudit.mode';
  let mode = localStorage.getItem(MODE_KEY) || 'split';

  function tearDown() {
    document.getElementById('course-audit-iframe')?.remove();
    document.getElementById('course-audit-panel')?.remove();
    const w = document.getElementById('ca-page-wrapper');
    if (w) { while (w.firstChild) document.body.insertBefore(w.firstChild, w); w.remove(); }
  }
  tearDown();

  const ACTIVE = new Set(['expected', 'confirmed']);
  const activeCount = mapped.filter(r => ACTIVE.has(String(r.Status).toLowerCase())).length;

  // Map check name -> CSS class for contrast color coding
  const CHECK_CLASS = {
    // ID issues — magenta/purple, highest contrast for the new ID checks
    id_missing:           'f-id-missing',
    pan_missing:          'f-id-missing',
    pan_invalid:          'f-id-alt',
    id_type_concatenated: 'f-id-alt',
    id_type_unknown:      'f-id-alt',
    id_type_mismatch:     'f-id-alt',
    aadhar_masked:        'f-id-alt',
    aadhar_length:        'f-id-alt',
    // Phone — orange
    phone_short:          'f-phone',
    phone_prefix_invalid: 'f-phone',
    // Email — teal
    email_missing:        'f-email',
    email_malformed:      'f-email',
    // Duplicates — yellow
    within_file_duplicate:    'f-dup',
    conf_no_duplicate:        'f-dup',
    cross_course_duplicate:   'f-dup',
    // Demographic / age — light blue
    age_dob_mismatch: 'f-age',
    age_under_min:    'f-age',
    age_over_max:     'f-age',
    // Safety — red (matches default)
    emergency_eq_self:  'f-safety',
    emergency_partial:  'f-safety',
    // Soft — gray
    shared_mobile:           'f-soft',
    shared_email_unrelated:  'f-soft',
    name_title_prefix:       'f-missing',
    // Status / misc
    status_unknown:           'f-status',
    conf_gender_mismatch:     'f-status',
    missing_field:            'f-missing',
  };

  // Build human-readable description per finding
  function describe(f) {
    const nameList = (arr) => {
      if (!arr || !arr.length) return '';
      if (arr.length === 1) return arr[0];
      if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
      return `${arr.slice(0,-1).join(', ')} and ${arr.slice(-1)[0]}`;
    };
    switch (f.check) {
      case 'missing_field':
        return `${f.field} is missing`;
      case 'phone_short':
        return `Phone is only ${f.len} digit${f.len===1?'':'s'} (less than 10): ${f.value}`;
      case 'phone_prefix_invalid':
        return `Phone does not start with 6-9: ${f.value}`;
      case 'email_missing':
        return `Email is missing`;
      case 'email_malformed':
        return `Email is malformed: ${f.value}`;
      case 'aadhar_masked':
        return `Aadhar is masked (export issue): ${f.value}`;
      case 'aadhar_length':
        return `Aadhar is ${f.len} digit${f.len===1?'':'s'}, expected 12: ${f.value}`;
      case 'id_missing':
        return `ID Type or ID No is missing`;
      case 'pan_missing':
        return `PAN is missing (required for donation receipt)`;
      case 'pan_invalid':
        return `PAN format is invalid: "${f.value}" (expected 5 letters + 4 digits + 1 letter)`;
      case 'id_type_concatenated':
        return `ID Type field has multiple values concatenated: "${f.value}"`;
      case 'id_type_unknown':
        return `ID Type is unrecognized: "${f.value}"`;
      case 'id_type_mismatch':
        return `ID Type is ${f.idType} but the value looks like a ${f.looksLike}: ${f.value} — fix the Document Type on the form`;
      case 'age_dob_mismatch':
        return `Age says ${f.listedAge} but DOB calculates to ${f.calcAge} (DOB ${f.dob})`;
      case 'age_under_min':
        return `Age ${f.age} is under 18 (DOB ${f.dob})`;
      case 'age_over_max':
        return `Age ${f.age} is over 95 (DOB ${f.dob})`;
      case 'conf_gender_mismatch':
        return `Conf No ${f.confNo} implies the other gender from "${f.gender}"`;
      case 'conf_no_duplicate':
        return `Conf No ${f.confNo} is used on rows ${(f.rows||[]).join(', ')}`;
      case 'within_file_duplicate': {
        if (f.matchBy === 'name+dob') {
          const parts = String(f.key||'').split('|');
          const dob = parts[1] || '?';
          return `${nameList(f.names)} have the same name and DOB (${dob})`;
        }
        const by = f.matchBy;
        return `${nameList(f.names)} share the same ${by}: ${f.key}`;
      }
      case 'status_unknown':
        return `Status value is unrecognized: "${f.value}"`;
      case 'emergency_eq_self':
        return `Emergency contact number is the same as own mobile`;
      case 'emergency_partial':
        return `Emergency contact is incomplete (name ${f.hasName?'present':'missing'}, phone ${f.hasPhone?'present':'missing'})`;
      case 'shared_mobile':
        return `${nameList(f.names)} share mobile number ${f.phone} (likely family)`;
      case 'shared_email_unrelated':
        return `${nameList(f.names)} share email ${f.email} but have unrelated surnames`;
      case 'name_title_prefix':
        return `Name starts with title "${f.prefix}" — remove it from "${f.value}"`;
      case 'cross_course_duplicate': {
        // alsoIn: [{courseId, name, status, confNo, matchBy:[...]}, ...]
        const parts = (f.alsoIn||[]).map(x => {
          const tags = (x.matchBy||[]).join(', ');
          const sc = [x.confNo, x.status].filter(Boolean).join(' / ');
          return `${x.courseId}${sc ? ' ('+sc+')' : ''} [by ${tags}]`;
        });
        return `Also active in: ${parts.join('; ')}`;
      }
      default:
        return f.check;
    }
  }

  const renderList = (arr) => {
    if (!arr.length) return '<em style="color:#888;font-size:12px">none</em>';
    return arr.map(f => {
      const aid = mapped[f.row]?._aid;
      const editLink = aid ? `<a href="/app/${aid}/edit" target="_top">edit</a>` : '';
      const cls = CHECK_CLASS[f.check] || '';
      return `<div class="finding ${cls}">
        ${editLink} <b>${f.name||''}</b><br>
        <span class="desc">${describe(f)}</span>
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
        <button id="ca-claude">For Teachers Review</button>
        <button id="ca-whatsapp" class="wa">Send to WhatsApp</button>
        <button id="ca-export">Export JSON</button>
        <button id="ca-mode" title="Toggle layout">⇆ ${mode==='split'?'Float':'Split'}</button>
        <button id="ca-clear-cache" title="Clear cross-course cache">Clear</button>
        <button id="ca-close">×</button>
      </div>
    </div>
    <details open><summary><span class="sec sec-red">Hard errors</span> <span class="cnt">(${findings.hardErrors.length})</span></summary>${renderList(findings.hardErrors)}</details>
    <details ${findings.safety.length?'open':''}><summary><span class="sec sec-amber">Safety</span> <span class="cnt">(${findings.safety.length})</span></summary>${renderList(findings.safety)}</details>
    <details ${findings.crossCourse.length?'open':''}><summary><span class="sec sec-blue">Cross-course</span> <span class="cnt">(${findings.crossCourse.length})</span></summary>${renderList(findings.crossCourse)}</details>
    <details><summary><span class="sec sec-gray">Soft / advisory</span> <span class="cnt">(${findings.soft.length})</span></summary>${renderList(findings.soft)}</details>
    <details><summary><span class="sec-min">Sensitive field counts</span></summary><pre>${JSON.stringify(findings.sensitiveCounts,null,2)}</pre></details>
    <details><summary><span class="sec-min">Cache</span></summary><div class="cache">${cached || '(empty)'}</div></details>

    <!-- WhatsApp modal (hidden via CSS until .wa-shown is added) -->
    <div id="ca-wa-modal" class="wa-modal">
      <div class="wa-card">
        <div class="wa-title">Send course summary via WhatsApp</div>
        <div class="wa-hint">Opens WhatsApp Web/desktop pre-filled. You confirm and send.</div>

        <div class="wa-section" id="wa-saved-section" hidden>
          <label class="wa-label">Saved</label>
          <div id="wa-saved" class="wa-recipients"></div>
        </div>

        <div class="wa-section" id="wa-recent-section" hidden>
          <label class="wa-label">Recent</label>
          <div id="wa-recent" class="wa-recipients"></div>
        </div>

        <div class="wa-section">
          <label class="wa-label">New number</label>
          <div class="wa-phone-row">
            <select id="wa-cc">
              <option value="91" selected>+91 India</option>
              <option value="1">+1 US/CA</option>
              <option value="44">+44 UK</option>
              <option value="61">+61 Australia</option>
              <option value="65">+65 Singapore</option>
              <option value="971">+971 UAE</option>
              <option value="49">+49 Germany</option>
              <option value="33">+33 France</option>
              <option value="81">+81 Japan</option>
              <option value="977">+977 Nepal</option>
            </select>
            <input id="wa-num" type="tel" placeholder="98765 43210" autocomplete="off">
          </div>
          <div class="wa-save-row">
            <label><input id="wa-save" type="checkbox"> Save as</label>
            <input id="wa-label" type="text" placeholder="e.g. Tyler" disabled>
          </div>
          <div id="wa-err" class="wa-err" hidden></div>
        </div>

        <div class="wa-section">
          <label class="wa-label">Preview <span id="wa-charcount" class="wa-meta"></span></label>
          <pre id="wa-preview" class="wa-preview"></pre>
        </div>

        <div class="wa-actions">
          <button id="wa-cancel">Cancel</button>
          <button id="wa-send" class="primary">Open WhatsApp</button>
        </div>
      </div>
    </div>`;

  const PANEL_CSS = `
    html,body { color-scheme:light; }
    body { margin:0; padding:14px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:13px; color:#222; background:#fff; }
    button { cursor:pointer; border:1px solid #999; background:#f5f5f5; border-radius:3px; font-size:11px; padding:4px 8px; }
    button:hover { background:#e8e8e8; }
    button.wa { background:#25D366; color:#fff; border-color:#1ea854; }
    button.wa:hover { background:#1ea854; }
    button.primary { background:#06c; color:#fff; border-color:#04a; }
    button.primary:hover { background:#04a; }
    code { font-family:ui-monospace,'SF Mono',Consolas,monospace; font-size:11px; }
    .hdr { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:14px; }
    .hdr-left { flex:1; min-width:0; }
    .title { font-size:17px; font-weight:600; }
    .sub1 { font-size:12px; color:#444; margin-top:3px; }
    .sub2 { font-size:11px; color:#888; margin-top:2px; }
    .hdr-right { display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; max-width:55%; }
    details { margin:4px 0; }
    summary { cursor:pointer; padding:6px 0; list-style:none; user-select:none; }
    summary::-webkit-details-marker { display:none; }
    summary::before { content:'▸ '; color:#666; font-size:11px; }
    details[open] > summary::before { content:'▾ '; }
    .sec { font-weight:700; font-size:16px; }
    .sec-min { font-weight:600; font-size:13px; color:#666; }
    .sec-red { color:#c33; } .sec-amber { color:#e80; } .sec-blue { color:#06c; } .sec-gray { color:#666; }
    .cnt { font-size:13px; color:#666; font-weight:normal; }
    .finding { margin:4px 0; padding:6px 8px; background:#f7f7f7; border-radius:4px; border-left:3px solid #c33; font-size:12px; line-height:1.4; }
    .finding b { font-size:13px; }
    .finding .desc { color:#333; font-size:12px; }
    .finding.f-id-missing { background:#ffe0f0; border-left:5px solid #d0009f; }
    .finding.f-id-missing .desc { color:#9c0070; font-weight:600; }
    .finding.f-id-alt     { background:#fbe5ff; border-left:5px solid #9c27b0; }
    .finding.f-id-alt     .desc { color:#6a1b8a; font-weight:600; }
    .finding.f-phone      { background:#fff1de; border-left:3px solid #f57c00; }
    .finding.f-phone      .desc { color:#a04d00; }
    .finding.f-email      { background:#defaf6; border-left:3px solid #009688; }
    .finding.f-email      .desc { color:#00695c; }
    .finding.f-dup        { background:#fff8d8; border-left:3px solid #ddae00; }
    .finding.f-dup        .desc { color:#8a6500; }
    .finding.f-age        { background:#dff0ff; border-left:3px solid #0288d1; }
    .finding.f-age        .desc { color:#01579b; }
    .finding.f-safety     { background:#ffe5e5; border-left:3px solid #d32f2f; }
    .finding.f-safety     .desc { color:#b71c1c; }
    .finding.f-soft       { background:#f0f0f0; border-left:3px solid #999; }
    .finding.f-soft       .desc { color:#555; }
    .finding.f-status     { background:#ece7ff; border-left:3px solid #5e35b1; }
    .finding.f-status     .desc { color:#311b92; }
    .finding.f-missing    { background:#ffeded; border-left:3px solid #c33; }
    .finding.f-missing    .desc { color:#b71c1c; }
    .finding code { color:#333; background:#eee; padding:0 4px; border-radius:2px; }
    .finding code.x { background:transparent; color:#555; }
    .finding a { color:#06c; text-decoration:none; margin-right:4px; }
    .finding .check { color:#666; font-size:11px; }
    pre { margin:6px 0; padding:8px; background:#f6f6f6; border-radius:4px; font-size:11px; overflow:auto; }
    .cache { font-size:11px; color:#666; margin:6px 0; }

    /* WhatsApp modal */
    .wa-modal { display:none; position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:2147483647; align-items:center; justify-content:center; }
    .wa-modal.wa-shown { display:flex; }
    .wa-section[hidden] { display:none; }
    .wa-err[hidden] { display:none; }
    .wa-card { background:#fff; border-radius:8px; box-shadow:0 8px 32px rgba(0,0,0,.3); padding:18px; width:min(440px, 92%); max-height:90vh; overflow:auto; }
    .wa-title { font-size:16px; font-weight:600; margin-bottom:4px; }
    .wa-hint { font-size:11px; color:#666; margin-bottom:12px; }
    .wa-section { margin-bottom:12px; }
    .wa-label { display:block; font-size:11px; color:#666; font-weight:600; margin-bottom:4px; text-transform:uppercase; letter-spacing:.5px; }
    .wa-recipients { display:flex; flex-wrap:wrap; gap:4px; }
    .wa-recipients .chip { padding:4px 8px; background:#eef; border:1px solid #ccd; border-radius:14px; font-size:11px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
    .wa-recipients .chip:hover { background:#dde; }
    .wa-recipients .chip .del { color:#c33; font-weight:700; padding-left:4px; }
    .wa-phone-row { display:flex; gap:6px; }
    .wa-phone-row select { padding:6px; border:1px solid #999; border-radius:3px; font-size:12px; background:#fff; }
    .wa-phone-row input { flex:1; padding:6px 8px; border:1px solid #999; border-radius:3px; font-size:13px; font-family:ui-monospace,monospace; }
    .wa-save-row { margin-top:6px; display:flex; align-items:center; gap:8px; font-size:12px; color:#555; }
    .wa-save-row input[type=text] { padding:4px 6px; border:1px solid #999; border-radius:3px; font-size:12px; flex:1; }
    .wa-save-row input[type=text]:disabled { background:#f5f5f5; color:#999; }
    .wa-err { color:#c33; font-size:11px; margin-top:6px; }
    .wa-preview { background:#f6f6f6; padding:10px; border-radius:4px; font-size:11px; font-family:ui-monospace,monospace; max-height:200px; overflow:auto; white-space:pre-wrap; word-break:break-word; }
    .wa-meta { font-size:10px; color:#888; font-weight:normal; text-transform:none; letter-spacing:0; margin-left:6px; }
    .wa-actions { display:flex; justify-content:flex-end; gap:6px; margin-top:6px; }
    .wa-actions button { font-size:12px; padding:6px 14px; }
  `;

  // ---- 10. WhatsApp modal wiring ----
  function wireWhatsAppModal(scope) {
    const $ = (id) => scope.getElementById(id);
    const modal     = $('ca-wa-modal');
    const savedBox  = $('wa-saved');
    const savedSec  = $('wa-saved-section');
    const recentBox = $('wa-recent');
    const recentSec = $('wa-recent-section');
    const ccSel     = $('wa-cc');
    const numIn     = $('wa-num');
    const saveChk   = $('wa-save');
    const labelIn   = $('wa-label');
    const errBox    = $('wa-err');
    const preview   = $('wa-preview');
    const charcount = $('wa-charcount');
    const summary   = buildWhatsAppSummary();

    function renderRecipients() {
      const saved = getSaved();
      if (saved.length) {
        savedBox.innerHTML = saved.map((r,i) =>
          `<span class="chip" data-e164="${r.e164}" data-i="${i}">${r.label || maskNumber(r.e164)} <span class="del" data-del="${i}" title="Remove">×</span></span>`
        ).join('');
        savedSec.hidden = false;
      } else { savedSec.hidden = true; }

      const recent = loadJSON(WA_RECENT_KEY, []).filter(e => !saved.some(s => s.e164 === e));
      if (recent.length) {
        recentBox.innerHTML = recent.map(e => `<span class="chip" data-e164="${e}">${maskNumber(e)}</span>`).join('');
        recentSec.hidden = false;
      } else { recentSec.hidden = true; }
    }

    function openModal() {
      modal.classList.add('wa-shown');
      preview.textContent = summary;
      const url = `https://wa.me/0?text=${encodeURIComponent(summary)}`;
      charcount.textContent = `${summary.length} chars (URL ${url.length}, wa.me limit ~4000)`;
      if (url.length > 4000) charcount.style.color = '#c33'; else charcount.style.color = '#888';
      errBox.hidden = true;
      numIn.value = '';
      saveChk.checked = false;
      labelIn.value = '';
      labelIn.disabled = true;
      renderRecipients();
      setTimeout(() => numIn.focus(), 50);
    }
    function closeModal() { modal.classList.remove('wa-shown'); }

    function sendTo(e164) {
      pushRecent(e164);
      openWhatsAppFor(e164, summary);
      closeModal();
    }

    saveChk.onchange = () => { labelIn.disabled = !saveChk.checked; if (saveChk.checked) labelIn.focus(); };

    $('wa-cancel').onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    $('wa-send').onclick = () => {
      errBox.hidden = true;
      const e164 = normalizeE164(ccSel.value, numIn.value);
      if (!e164) {
        errBox.textContent = 'Invalid number. For India: 10 digits starting 6-9. Otherwise 7-15 digits total.';
        errBox.hidden = false;
        return;
      }
      if (saveChk.checked) {
        const label = (labelIn.value || '').trim();
        if (!label) { errBox.textContent = 'Enter a label for the saved recipient.'; errBox.hidden = false; return; }
        const saved = getSaved().filter(r => r.e164 !== e164);
        saved.push({ label, e164 });
        setSaved(saved);
      }
      sendTo(e164);
    };

    savedBox.onclick = (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        const i = parseInt(del.getAttribute('data-del'), 10);
        const saved = getSaved();
        saved.splice(i, 1);
        setSaved(saved);
        renderRecipients();
        return;
      }
      const chip = e.target.closest('.chip[data-e164]');
      if (chip) sendTo(chip.getAttribute('data-e164'));
    };
    recentBox.onclick = (e) => {
      const chip = e.target.closest('.chip[data-e164]');
      if (chip) sendTo(chip.getAttribute('data-e164'));
    };

    return { openModal };
  }

  function wireHandlers(scope) {
    const $ = (id) => scope.getElementById(id);
    const wa = wireWhatsAppModal(scope);

    $('ca-close').onclick = () => tearDown();
    $('ca-clear-cache').onclick = () => {
      if (confirm('Clear cross-course cache?')) { localStorage.removeItem(CACHE_KEY); tearDown(); }
    };
    $('ca-mode').onclick = () => {
      mode = (mode === 'split') ? 'float' : 'split';
      localStorage.setItem(MODE_KEY, mode);
      tearDown(); buildUI();
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
        alert(`Copied prompt for ${count} applicants.\n\nPaste into Claude.ai or Claude in Chrome.`);
      } catch (e) {
        const ta = scope.createElement('textarea');
        ta.value = text;
        ta.style.cssText='position:fixed;top:0;left:0;width:100%;height:200px;z-index:2147483647';
        scope.body.appendChild(ta); ta.select();
        alert('Clipboard blocked. Manual copy from textarea.');
      }
    };
    $('ca-whatsapp').onclick = () => wa.openModal();
  }

  function buildSplitUI() {
    const ourIds = new Set(['course-audit-iframe', 'course-audit-panel', 'ca-page-wrapper', 'ca-rerun-btn']);
    const wrapper = document.createElement('div');
    wrapper.id = 'ca-page-wrapper';
    wrapper.style.cssText = 'width:60vw; max-width:60vw; overflow-x:auto; box-sizing:border-box;';
    const kids = Array.from(document.body.children).filter(c => !ourIds.has(c.id));
    kids.forEach(k => wrapper.appendChild(k));
    document.body.insertBefore(wrapper, document.body.firstChild);

    const iframe = document.createElement('iframe');
    iframe.id = 'course-audit-iframe';
    iframe.style.cssText = `position:fixed; top:0; right:0; width:40vw; height:100vh; border:0;
      border-left:2px solid #333; z-index:2147483647; background:#fff;
      box-shadow:-4px 0 24px rgba(0,0,0,.3); color-scheme:light;`;
    iframe.srcdoc = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<base target="_top"><meta name="color-scheme" content="light">
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
    const style = document.createElement('style');
    style.textContent =
      `#course-audit-panel * { box-sizing:border-box; }` +
      PANEL_CSS.replace(/(^|\})\s*html,body\s*\{/g, '$1 #course-audit-panel {')
               .replace(/(^|\})\s*body\s*\{/g, '$1 #course-audit-panel {');
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
