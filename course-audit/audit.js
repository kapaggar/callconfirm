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
    const data = rows.map((r, i) => ({
      _i: i,
      _name: normName(r.Name),
      _phone: normPhone(r.PhoneMobile),
      _email: r.Email ? String(r.Email).trim().toLowerCase() : null,
      _aadhar: normAadhar(r['ID No'], r['ID Type']),
      _dob: parseDate(r.DOB),
      _emer: normPhone(r['Emergency Contact No']),
      _active: isActive(r),
      raw: r
    }));

    const active = data.filter(d => d._active);

    // ===== HARD ERRORS =====
    const H = findings.hardErrors;
    const push = (arr, check, row, detail) => arr.push({ check, row: row._i, name: row.raw.Name, ...detail });

    // 1. Missing critical fields
    const CRIT = ['Name', 'Gender', 'Age', 'PhoneMobile', 'Address', 'City', 'State',
                  'ID Type', 'ID No', 'Conf No', 'Emergency Name', 'Emergency Contact No', 'DOB', 'Status'];
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

    // 4. Aadhar wrong length / masked
    active.forEach(d => {
      const type = String(d.raw['ID Type'] || '');
      if (!/^aadhar/i.test(type)) return;
      const raw = String(d.raw['ID No'] || '');
      if (/X{4,}/i.test(raw)) push(H, 'aadhar_masked', d, { value: raw });
      else {
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

    // 11. Status=Duplicate orphan
    data.filter(d => String(d.raw.Status || '').toLowerCase() === 'duplicate').forEach(d => {
      const hasMatch = data.some(other => other._i !== d._i && (
        (d._aadhar && other._aadhar === d._aadhar) ||
        (d._phone && other._phone === d._phone) ||
        (d._name && other._name === d._name && d._dob && other._dob && d._dob.getTime() === other._dob.getTime())
      ));
      if (!hasMatch) push(H, 'duplicate_status_orphan', d, {});
    });

    // Unknown Status value
    data.forEach(d => {
      const s = String(d.raw.Status || '').toLowerCase().trim();
      if (s && !KNOWN_STATUS.has(s)) push(H, 'status_unknown', d, { value: d.raw.Status });
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
      const lookups = ['_aadhar', '_phone'];

      active.forEach(d => {
        lookups.forEach(key => {
          if (!d[key]) return;
          const matches = others.flatMap(c =>
            (c.rows || [])
              .filter(r => isActive(r))
              .filter(r => {
                if (key === '_aadhar') return normAadhar(r['ID No'], r['ID Type']) === d._aadhar;
                if (key === '_phone') return normPhone(r.PhoneMobile) === d._phone;
                return false;
              })
              .map(r => ({ courseId: c.courseId, row: r }))
          );
          if (matches.length) {
            C.push({
              check: 'cross_course_duplicate',
              row: d._i, name: d.raw.Name, matchBy: key.replace('_', ''),
              thisCourse: thisCourseId,
              alsoIn: matches.map(m => ({ courseId: m.courseId, name: m.row.Name, status: m.row.Status, confNo: m.row['Conf No'] }))
            });
          }
        });
      });
    }

    return findings;
  }

  root.CourseAudit = { run, _internal: { normPhone, normName, normAadhar, ageOn, isActive } };
})(typeof window !== 'undefined' ? window : globalThis);
