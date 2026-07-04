// audit.js - Course attendee audit rule engine
// Framework-agnostic. Input: array of attendee objects with the columns from the xlsx export.
// Output: { hardErrors: [...], safety: [...], soft: [...], sensitiveCounts: {...}, crossCourse: [...] }
//
// Usage:
//   const findings = window.CourseAudit.run(attendees, { courseStart: '2026-05-20', allCourses: [...] });

(function (root) {
  'use strict';

  // ---------- normalizers ----------
  const normPhone = (x) => {
    if (x == null) return null;
    const s = String(x).replace(/\D/g, '');
    return s.length >= 10 ? s.slice(-10) : (s || null);
  };

  const normName = (x) => {
    if (x == null) return null;
    return String(x)
      .toLowerCase()
      .replace(/\(sevak\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const normAadhar = (id, type) => {
    if (id == null || !type || !/^aadhar/i.test(String(type))) return null;
    const s = String(id).replace(/\D/g, '');
    return s.length === 12 ? s : null;
  };

  // Normalize raw 12-digit string regardless of ID Type
  const normAadharRaw = (x) => {
    if (x == null) return null;
    const s = String(x).replace(/\D/g, '');
    return s.length === 12 ? s : null;
  };

  // Normalize PAN to uppercase, strip whitespace, validate format
  const PAN_RE_INTERNAL = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const normPan = (x) => {
    if (x == null) return null;
    const s = String(x).replace(/\s+/g, '').toUpperCase();
    return PAN_RE_INTERNAL.test(s) ? s : null;
  };

  const normEmail = (x) => {
    if (x == null) return null;
    const s = String(x).trim().toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
  };

  // Honorific / title prefixes that shouldn't be part of Name.
  // Multi-word entries must come before their single-word heads (sorted longest-first below).
  const NAME_PREFIXES = [
    'Mr', 'Mrs', 'Ms', 'Miss', 'Mx',
    'Shri', 'Sri', 'Shree', 'Smt', 'Kumari', 'Kum', 'Master', 'Baby',
    'Dr', 'Doctor', 'Prof', 'Professor', 'Asst Prof', 'Associate Prof',
    'Principal', 'Dean', 'Er', 'Engineer', 'Adv', 'Advocate',
    'CA', 'CS', 'CMA', 'CPA', 'Architect', 'Ar', 'Counsel',
    'IAS', 'IPS', 'IFS', 'IRS', 'PCS',
    'Retd', 'Retired', 'Ex',
    'Lt', 'Capt', 'Captain', 'Major', 'Maj', 'Col', 'Colonel',
    'Brig', 'Brigadier', 'Gen', 'General', 'Subedar', 'Havildar',
    'Inspector', 'SI', 'ASI', 'DSP', 'SP', 'ACP', 'DCP', 'DIG', 'IG',
    'Lt Col', 'Maj Gen', 'Brig Gen', 'Retd Col', 'Col Retd',
    'Swami', 'Sadhu', 'Sadhvi', 'Acharya', 'Venerable',
    'Rev', 'Reverend', 'Fr', 'Father', 'Pastor',
    'Maulana', 'Mufti', 'Hafiz', 'Haji', 'Hajji',
    'Pandit', 'Pt', 'Pujya', 'Guruji', 'Muni',
    'Kunwar', 'Thakur', 'Sir', 'Dame', 'Lord', 'Lady',
  ];
  const PREFIX_LIST = NAME_PREFIXES
    .map(p => p.toLowerCase())
    .sort((a, b) => b.split(' ').length - a.split(' ').length);

  // Returns the matched title prefix (as written in the name) or null.
  // Only flags when the title is followed by an actual name, so standalone
  // given names like "Baby" or "Kumari" alone don't trip it.
  const namePrefix = (name) => {
    if (name == null) return null;
    const norm = String(name)
      .replace(/\(sevak\)/gi, '')
      .replace(/\./g, '. ')       // "Mr.Ramesh" -> "Mr. Ramesh"
      .replace(/\s+/g, ' ')
      .trim();
    if (!norm) return null;
    const tokens = norm.split(' ');
    const bare = tokens.map(t => t.replace(/\.+$/, '').toLowerCase());
    for (const p of PREFIX_LIST) {
      const pt = p.split(' ');
      if (tokens.length <= pt.length) continue; // must be followed by a name
      if (bare.slice(0, pt.length).join(' ') === p) {
        return tokens.slice(0, pt.length).join(' ');
      }
    }
    return null;
  };

  const parseDate = (x) => {
    if (!x) return null;
    const d = new Date(x);
    return isNaN(d) ? null : d;
  };

  const ageOn = (dob, refDate) => {
    if (!dob) return null;
    let a = refDate.getFullYear() - dob.getFullYear();
    const m = refDate.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && refDate.getDate() < dob.getDate())) a--;
    return a;
  };

  // ---------- status buckets ----------
  const ACTIVE = new Set(['expected', 'confirmed']);
  const RESOLVED = new Set(['duplicate', 'rejected', 'regret', 'cancelled', 'left', 'errors']);
  const KNOWN_STATUS = new Set([
    'received', 'review', 'clarification', 'clarification-response',
    'preconfirmation', 'confirmed', 'expected', 'waitlist',
    'duplicate', 'rejected', 'regret', 'cancelled', 'attended', 'left', 'errors'
  ]);

  const isActive = (r) => ACTIVE.has(String(r.Status || '').toLowerCase().trim());

  // ---------- main ----------
  function run(rows, opts = {}) {
    const courseStart = opts.courseStart ? new Date(opts.courseStart) : new Date();
    const findings = { hardErrors: [], safety: [], soft: [], sensitiveCounts: {}, crossCourse: [] };

    // attach normalized fields and row index
    const data = rows.map((r, i) => {
      // Aadhar: prefer the primary ID if ID Type=Aadhar, else fall back to 'Aadhar Raw'
      const aadhar = normAadhar(r['ID No'], r['ID Type']) || normAadharRaw(r['Aadhar Raw']);
      // PAN: prefer 'PAN Raw', else primary ID if ID Type=Pan card,
      // else primary ID when its value is PAN-shaped (mislabeled Identifier)
      let panSrc = r['PAN Raw'];
      if (!panSrc && /^pan/i.test(String(r['ID Type'] || ''))) panSrc = r['ID No'];
      if (!panSrc && normPan(r['ID No'])) panSrc = r['ID No'];
      const pan = normPan(panSrc);
      return {
        _i: i,
        _name: normName(r.Name),
        _phone: normPhone(r.PhoneMobile),
        _email: normEmail(r.Email),
        _aadhar: aadhar,
        _pan: pan,
        _dob: parseDate(r.DOB),
        _emer: normPhone(r['Emergency Contact No']),
        _active: isActive(r),
        raw: r
      };
    });

    const active = data.filter(d => d._active);

    // ===== HARD ERRORS =====
    const H = findings.hardErrors;
    const push = (arr, check, row, detail) => arr.push({ check, row: row._i, name: row.raw.Name, ...detail });

    // 1. Missing critical fields (ID Type / ID No covered by id_missing below)
    const CRIT = ['Name', 'Gender', 'Age', 'PhoneMobile', 'Address', 'City', 'State',
                  'Conf No', 'Emergency Name', 'Emergency Contact No', 'DOB', 'Status'];
    active.forEach(d => {
      CRIT.forEach(c => {
        const v = d.raw[c];
        if (v == null || String(v).trim() === '') {
          push(H, 'missing_field', d, { field: c });
        }
      });
    });

    // 2. PhoneMobile invalid (India default)
    active.forEach(d => {
      const p = d.raw.PhoneMobile;
      if (p == null) return;
      const digits = String(p).replace(/\D/g, '');
      const country = String(d.raw.Country || '').toLowerCase();
      if (digits.length < 10) push(H, 'phone_short', d, { value: String(p), len: digits.length });
      else if ((country === '' || country === 'india') && !/^[6-9]/.test(digits.slice(-10))) {
        push(H, 'phone_prefix_invalid', d, { value: String(p) });
      }
    });

    // 3. Email malformed (active rows)
    const emRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    active.forEach(d => {
      const e = d.raw.Email;
      if (e == null || String(e).trim() === '') {
        push(H, 'email_missing', d, {});
      } else if (!emRe.test(String(e).trim())) {
        push(H, 'email_malformed', d, { value: String(e) });
      }
    });

    // 4. Aadhar wrong length / masked / actually a PAN
    active.forEach(d => {
      const type = String(d.raw['ID Type'] || '');
      if (!/^aadhar/i.test(type)) return;
      const raw = String(d.raw['ID No'] || '').trim();
      if (!raw) return; // id_missing handles this case
      if (/X{4,}/i.test(raw)) push(H, 'aadhar_masked', d, { value: raw });
      else if (PAN_RE_INTERNAL.test(raw.replace(/\s+/g, '').toUpperCase())) {
        // dipi's single Identifier field: a PAN mislabeled as Aadhar.
        // Don't run Aadhar length rules on it — flag the type mismatch instead.
        push(H, 'id_type_mismatch', d, { value: raw, idType: 'Aadhar', looksLike: 'PAN' });
      } else {
        const digits = raw.replace(/\D/g, '');
        if (digits.length !== 12) push(H, 'aadhar_length', d, { value: raw, len: digits.length });
      }
    });

    // 5. ID Type concatenated (multi-select artifact)
    const validIdTypes = ['aadhar', 'pan card', 'passport', 'voter id', 'driving license'];
    active.forEach(d => {
      const t = String(d.raw['ID Type'] || '').toLowerCase().trim();
      if (!t) return;
      if (!validIdTypes.includes(t)) {
        // detect if it's a concatenation of two valid types
        const matches = validIdTypes.filter(v => t.includes(v));
        if (matches.length >= 2) push(H, 'id_type_concatenated', d, { value: d.raw['ID Type'] });
        else push(H, 'id_type_unknown', d, { value: d.raw['ID Type'] });
      }
    });

    // 5b. ID Type / ID No completely missing
    active.forEach(d => {
      const t = String(d.raw['ID Type'] || '').toLowerCase().trim();
      const no = String(d.raw['ID No'] || '').trim();
      if (!t || !no) {
        push(H, 'id_missing', d, { idType: d.raw['ID Type'] || null, idNo: d.raw['ID No'] || null });
      }
    });

    // 5c. PAN required for donation receipts (Indian tax dept mandate).
    //     - Flag if PAN is missing entirely
    //     - Flag if PAN is present but doesn't match Indian PAN format
    //     - Foreign nationals (Country != India and != blank) are exempt
    const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
    active.forEach(d => {
      const country = String(d.raw.Country || '').toLowerCase().trim();
      const isIndian = (country === '' || country === 'india');
      if (!isIndian) return;

      const idType = String(d.raw['ID Type'] || '').toLowerCase().trim();
      const idNo   = String(d.raw['ID No'] || '').trim();
      const panRaw = String(d.raw['PAN Raw'] || '').trim();

      // PAN can appear in three places:
      //   1. The dedicated PAN column ('PAN Raw' from the dipi pancard field)
      //   2. As the primary ID with ID Type = "Pan card"
      //   3. Mislabeled under another ID Type (dipi single Identifier field) —
      //      accept it if the value is PAN-shaped, so pan_missing doesn't fire
      let pan = panRaw;
      if (!pan && idType === 'pan card') pan = idNo;
      if (!pan && PAN_RE.test(idNo.replace(/\s+/g, ''))) pan = idNo;

      if (!pan) {
        push(H, 'pan_missing', d, {});
      } else if (/^\d{12}$/.test(pan.replace(/\s+/g, ''))) {
        // 12-digit number in the PAN slot — almost certainly an Aadhar
        push(H, 'id_type_mismatch', d, { value: pan, idType: 'Pan card', looksLike: 'Aadhar' });
      } else if (!PAN_RE.test(pan.replace(/\s+/g, ''))) {
        push(H, 'pan_invalid', d, { value: pan });
      }
    });

    // 6. Age vs DOB mismatch
    active.forEach(d => {
      if (!d._dob) return;
      const listed = parseInt(d.raw.Age, 10);
      if (isNaN(listed)) return;
      const calc = ageOn(d._dob, courseStart);
      if (Math.abs(calc - listed) > 1) {
        push(H, 'age_dob_mismatch', d, { listedAge: listed, calcAge: calc, dob: d.raw.DOB });
      }
    });

    // 7. DOB implies impossible age
    const minAge = opts.minAge || 18;
    const maxAge = opts.maxAge || 95;
    active.forEach(d => {
      if (!d._dob) return;
      const a = ageOn(d._dob, courseStart);
      if (a < minAge) push(H, 'age_under_min', d, { age: a, dob: d.raw.DOB });
      if (a > maxAge) push(H, 'age_over_max', d, { age: a, dob: d.raw.DOB });
    });

    // 8. Conf No prefix vs Gender mismatch
    active.forEach(d => {
      const c = String(d.raw['Conf No'] || '').trim();
      const g = String(d.raw.Gender || '').toLowerCase().trim();
      if (c.length < 2) return;
      const second = c[1].toUpperCase();
      if (second === 'M' && g !== 'male') push(H, 'conf_gender_mismatch', d, { confNo: c, gender: g });
      if (second === 'F' && g !== 'female') push(H, 'conf_gender_mismatch', d, { confNo: c, gender: g });
    });

    // 9. Duplicate Conf No
    const confMap = new Map();
    active.forEach(d => {
      const c = String(d.raw['Conf No'] || '').trim();
      if (!c) return;
      if (!confMap.has(c)) confMap.set(c, []);
      confMap.get(c).push(d);
    });
    for (const [c, arr] of confMap) {
      if (arr.length > 1) {
        push(H, 'conf_no_duplicate', arr[0], { confNo: c, rows: arr.map(x => x._i) });
      }
    }

    // 10. Duplicate active rows by aadhar / phone / name+dob
    const dedupGroup = (keyFn, label) => {
      const m = new Map();
      active.forEach(d => {
        const k = keyFn(d);
        if (!k) return;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(d);
      });
      for (const [k, arr] of m) {
        if (arr.length > 1) {
          push(H, 'within_file_duplicate', arr[0], {
            matchBy: label, key: k, rows: arr.map(x => x._i), names: arr.map(x => x.raw.Name)
          });
        }
      }
    };
    dedupGroup(d => d._aadhar, 'aadhar');
    dedupGroup(d => d._phone, 'phone');
    dedupGroup(d => d._name && d._dob ? `${d._name}|${d._dob.toISOString().slice(0,10)}` : null, 'name+dob');

    // Unknown Status value
    data.forEach(d => {
      const s = String(d.raw.Status || '').toLowerCase().trim();
      if (s && !KNOWN_STATUS.has(s)) push(H, 'status_unknown', d, { value: d.raw.Status });
    });

    // 11. Honorific/title prefix in Name (pollutes letters, Conf lists, dedup)
    active.forEach(d => {
      const p = namePrefix(d.raw.Name);
      if (p) push(H, 'name_title_prefix', d, { prefix: p, value: d.raw.Name });
    });

    // ===== SAFETY FLAGS =====
    const S = findings.safety;

    // 12. Emergency = own mobile
    active.forEach(d => {
      if (d._phone && d._emer && d._phone === d._emer) push(S, 'emergency_eq_self', d, {});
    });

    // 13. Partial emergency contact data
    active.forEach(d => {
      const name = String(d.raw['Emergency Name'] || '').trim();
      const phone = String(d.raw['Emergency Contact No'] || '').trim();
      if ((name && !phone) || (!name && phone)) {
        push(S, 'emergency_partial', d, { hasName: !!name, hasPhone: !!phone });
      }
    });

    // 14. Sensitive field counts (no per-row flag, just counts)
    const SENSITIVE = ['Physical Health', 'Mental Health', 'Medication', 'Pregnancy Details', 'Addiction'];
    SENSITIVE.forEach(f => {
      const n = active.filter(d => {
        const v = d.raw[f];
        if (v == null) return false;
        const s = String(v).trim().toLowerCase();
        return s !== '' && s !== 'no' && s !== 'na' && s !== 'none' && s !== '-';
      }).length;
      findings.sensitiveCounts[f] = n;
    });

    // ===== SOFT FLAGS =====
    const SF = findings.soft;

    // 15. Shared mobile within course
    const phoneGroups = new Map();
    active.forEach(d => {
      if (!d._phone) return;
      if (!phoneGroups.has(d._phone)) phoneGroups.set(d._phone, []);
      phoneGroups.get(d._phone).push(d);
    });
    for (const [k, arr] of phoneGroups) {
      if (arr.length > 1) {
        push(SF, 'shared_mobile', arr[0], { phone: k, rows: arr.map(x => x._i), names: arr.map(x => x.raw.Name) });
      }
    }

    // 16. Shared email across non-related surnames
    const emailGroups = new Map();
    active.forEach(d => {
      if (!d._email) return;
      if (!emailGroups.has(d._email)) emailGroups.set(d._email, []);
      emailGroups.get(d._email).push(d);
    });
    for (const [k, arr] of emailGroups) {
      if (arr.length > 1) {
        const surnames = new Set(arr.map(x => {
          const parts = (x.raw.Name || '').trim().split(/\s+/);
          return parts[parts.length - 1].toLowerCase();
        }));
        if (surnames.size > 1) {
          push(SF, 'shared_email_unrelated', arr[0], { email: k, rows: arr.map(x => x._i), names: arr.map(x => x.raw.Name) });
        }
      }
    }

    // ===== CROSS-COURSE =====
    if (opts.allCourses && Array.isArray(opts.allCourses)) {
      const C = findings.crossCourse;
      const thisCourseId = opts.courseId || opts.courseStart;
      const others = opts.allCourses.filter(c => c.courseId !== thisCourseId);

      // Pre-normalize all "other course" active rows once for speed
      const otherIndex = [];
      others.forEach(c => {
        (c.rows || []).filter(r => isActive(r)).forEach(r => {
          const aadhar = normAadhar(r['ID No'], r['ID Type']) || normAadharRaw(r['Aadhar Raw']);
          let panSrc = r['PAN Raw'];
          if (!panSrc && /^pan/i.test(String(r['ID Type'] || ''))) panSrc = r['ID No'];
          if (!panSrc && normPan(r['ID No'])) panSrc = r['ID No'];
          const pan = normPan(panSrc);
          otherIndex.push({
            courseId: c.courseId,
            row: r,
            _aadhar: aadhar,
            _pan: pan,
            _phone: normPhone(r.PhoneMobile),
            _email: normEmail(r.Email),
            _name: normName(r.Name),
            _dob: parseDate(r.DOB),
          });
        });
      });

      active.forEach(d => {
        // Map of "courseId|targetName|targetConfNo" -> { match record, set of matchBy }
        const byTarget = new Map();
        const addMatch = (other, matchBy) => {
          const key = `${other.courseId}|${other.row.Name}|${other.row['Conf No']||''}`;
          if (!byTarget.has(key)) {
            byTarget.set(key, {
              courseId: other.courseId,
              name: other.row.Name,
              status: other.row.Status,
              confNo: other.row['Conf No'],
              matchBy: new Set()
            });
          }
          byTarget.get(key).matchBy.add(matchBy);
        };

        otherIndex.forEach(other => {
          if (d._aadhar && other._aadhar === d._aadhar) addMatch(other, 'aadhar');
          if (d._pan    && other._pan    === d._pan)    addMatch(other, 'PAN');
          if (d._phone  && other._phone  === d._phone)  addMatch(other, 'phone');
          if (d._email  && other._email  === d._email)  addMatch(other, 'email');
          if (d._name && d._dob && other._name === d._name && other._dob && other._dob.getTime() === d._dob.getTime()) {
            addMatch(other, 'name+DOB');
          }
        });

        if (byTarget.size > 0) {
          C.push({
            check: 'cross_course_duplicate',
            row: d._i,
            name: d.raw.Name,
            thisCourse: thisCourseId,
            alsoIn: [...byTarget.values()].map(m => ({
              courseId: m.courseId,
              name: m.name,
              status: m.status,
              confNo: m.confNo,
              matchBy: [...m.matchBy]
            }))
          });
        }
      });
    }

    return findings;
  }

  root.CourseAudit = { run, _internal: { normPhone, normName, normAadhar, ageOn, isActive, namePrefix } };
})(typeof window !== 'undefined' ? window : globalThis);
