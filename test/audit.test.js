// Unit tests for the course-audit rule engine (course-audit/audit.js).
//
// audit.js is framework-agnostic: its IIFE assigns window.CourseAudit, falling
// back to globalThis outside a browser — so requiring it here populates
// globalThis.CourseAudit with { run, _internal } and no DOM/mocks are needed.
//
// Run:  node --test test/      (or: npm test)
//
// These rules gate 80G donation-receipt eligibility (PAN/Aadhaar validity) and
// course logistics (duplicates, age, phone/email). A silently-wrong rule
// mis-flags a real donor, so keep this suite green.

const { test } = require('node:test');
const assert = require('node:assert');

require('../course-audit/audit.js');
const { CourseAudit } = globalThis;

// ── helpers ──────────────────────────────────────────────────────────────

// A fully valid, active applicant. Override single fields per test so each
// case isolates one rule; the clean baseline must produce zero hard errors.
function mkRow(o = {}) {
  return {
    Name: 'Ramesh Kumar',
    Gender: 'Male',
    Age: '40',
    PhoneMobile: '9876543210',
    Address: '12 MG Road',
    City: 'Pune',
    State: 'Maharashtra',
    Country: 'India',
    'Conf No': '1M01',
    'Emergency Name': 'Sita Kumar',
    'Emergency Contact No': '9123456780',
    DOB: '1986-01-15',
    Status: 'Confirmed',
    Email: 'ramesh@example.com',
    'ID Type': 'Aadhar',
    'ID No': '123412341234',
    'PAN Raw': 'ABCDE1234F',
    ...o,
  };
}

// Fixed courseStart so age math is deterministic in CI (DOB 1986-01-15 → 40).
const run = (rows, opts = {}) => CourseAudit.run(rows, { courseStart: '2026-08-01', ...opts });
const has = (list, check) => list.some(f => f.check === check);
const findChecks = (list) => list.map(f => f.check);

// ── baseline ─────────────────────────────────────────────────────────────

test('a fully valid active row produces no hard errors or safety flags', () => {
  const f = run([mkRow()]);
  assert.deepStrictEqual(f.hardErrors, [], 'unexpected hard errors: ' + findChecks(f.hardErrors));
  assert.deepStrictEqual(f.safety, [], 'unexpected safety flags: ' + findChecks(f.safety));
});

// ── PAN (80G-critical) ───────────────────────────────────────────────────

test('present PAN with a bad format → pan_invalid', () => {
  const f = run([mkRow({ 'PAN Raw': 'ABCD1234' })]);
  assert.ok(has(f.hardErrors, 'pan_invalid'));
});

test('valid PAN → no pan_invalid and no pan_missing even when presence-check is on', () => {
  const f = run([mkRow()], { checkPanPresence: true });
  assert.ok(!has(f.hardErrors, 'pan_invalid'));
  assert.ok(!has(f.hardErrors, 'pan_missing'));
});

test('pan_missing is opt-in: absent PAN is silent by default, flagged only with checkPanPresence', () => {
  const noPan = () => mkRow({ 'PAN Raw': '' }); // ID Type Aadhar, so no PAN anywhere
  assert.ok(!has(run([noPan()]).hardErrors, 'pan_missing'), 'should NOT flag by default');
  assert.ok(has(run([noPan()], { checkPanPresence: true }).hardErrors, 'pan_missing'), 'should flag when enabled');
});

test('a 12-digit number in the PAN slot → id_type_mismatch (Aadhaar mislabelled as PAN)', () => {
  const f = run([mkRow({ 'ID Type': 'Pan card', 'ID No': '123412341234', 'PAN Raw': '' })]);
  assert.ok(has(f.hardErrors, 'id_type_mismatch'));
});

test('foreign nationals are exempt from the PAN-presence requirement', () => {
  const f = run([mkRow({ Country: 'USA', 'PAN Raw': '' })], { checkPanPresence: true });
  assert.ok(!has(f.hardErrors, 'pan_missing'));
});

// ── Aadhaar ──────────────────────────────────────────────────────────────

test('masked Aadhaar → aadhar_masked', () => {
  const f = run([mkRow({ 'ID No': '1234XXXX1234' })]);
  assert.ok(has(f.hardErrors, 'aadhar_masked'));
});

test('wrong-length Aadhaar → aadhar_length', () => {
  const f = run([mkRow({ 'ID No': '12345' })]);
  assert.ok(has(f.hardErrors, 'aadhar_length'));
});

test('PAN-shaped value under ID Type Aadhaar → id_type_mismatch (not aadhar_length)', () => {
  const f = run([mkRow({ 'ID No': 'ABCDE1234F' })]);
  assert.ok(has(f.hardErrors, 'id_type_mismatch'));
  assert.ok(!has(f.hardErrors, 'aadhar_length'));
});

// ── phone / email ────────────────────────────────────────────────────────

test('phone shorter than 10 digits → phone_short', () => {
  assert.ok(has(run([mkRow({ PhoneMobile: '12345' })]).hardErrors, 'phone_short'));
});

test('Indian phone not starting 6–9 → phone_prefix_invalid', () => {
  assert.ok(has(run([mkRow({ PhoneMobile: '1234567890' })]).hardErrors, 'phone_prefix_invalid'));
});

test('missing email → email_missing; malformed email → email_malformed', () => {
  assert.ok(has(run([mkRow({ Email: '' })]).hardErrors, 'email_missing'));
  assert.ok(has(run([mkRow({ Email: 'not-an-email' })]).hardErrors, 'email_malformed'));
});

// ── age / DOB ────────────────────────────────────────────────────────────

test('listed Age disagreeing with DOB by >1yr → age_dob_mismatch', () => {
  assert.ok(has(run([mkRow({ Age: '50' })]).hardErrors, 'age_dob_mismatch'));
});

test('DOB implying age under the minimum → age_under_min', () => {
  const f = run([mkRow({ Age: '11', DOB: '2015-06-01' })]);
  assert.ok(has(f.hardErrors, 'age_under_min'));
});

// ── identity / status / name ─────────────────────────────────────────────

test('Conf No gender letter contradicting Gender → conf_gender_mismatch', () => {
  assert.ok(has(run([mkRow({ 'Conf No': '1F01' })]).hardErrors, 'conf_gender_mismatch'));
});

test('missing critical field → missing_field', () => {
  assert.ok(has(run([mkRow({ City: '' })]).hardErrors, 'missing_field'));
});

test('honorific title in Name → name_title_prefix', () => {
  const f = run([mkRow({ Name: 'Dr Ramesh Kumar' })]);
  assert.ok(has(f.hardErrors, 'name_title_prefix'));
});

test('unrecognised Status value → status_unknown', () => {
  assert.ok(has(run([mkRow({ Status: 'Foobar' })]).hardErrors, 'status_unknown'));
});

test('inactive rows are exempt from the active-row rules', () => {
  // Rejected row full of problems should still raise nothing.
  const f = run([mkRow({ Status: 'Rejected', PhoneMobile: '12', Email: 'bad', City: '' })]);
  assert.deepStrictEqual(f.hardErrors, [], 'unexpected: ' + findChecks(f.hardErrors));
});

// ── duplicates ───────────────────────────────────────────────────────────

test('two active rows sharing a Conf No → conf_no_duplicate', () => {
  const a = mkRow({ Name: 'Amit Shah', 'ID No': '111122223333', PhoneMobile: '9811111111', Email: 'amit@x.com', 'Conf No': '1M05' });
  const b = mkRow({ Name: 'Vijay Rao', 'ID No': '444455556666', PhoneMobile: '9822222222', Email: 'vijay@x.com', 'Conf No': '1M05' });
  assert.ok(has(run([a, b]).hardErrors, 'conf_no_duplicate'));
});

test('two active rows sharing a phone → within_file_duplicate (matchBy phone)', () => {
  const a = mkRow({ Name: 'Amit Shah', 'ID No': '111122223333', Email: 'amit@x.com', 'Conf No': '1M05', PhoneMobile: '9800000000' });
  const b = mkRow({ Name: 'Vijay Rao', 'ID No': '444455556666', Email: 'vijay@x.com', 'Conf No': '1M06', PhoneMobile: '9800000000' });
  const dups = run([a, b]).hardErrors.filter(f => f.check === 'within_file_duplicate');
  assert.ok(dups.some(d => d.matchBy === 'phone'));
});

test('two active rows sharing an Aadhaar → within_file_duplicate (matchBy aadhar)', () => {
  const a = mkRow({ Name: 'Amit Shah', PhoneMobile: '9811111111', Email: 'amit@x.com', 'Conf No': '1M05', 'ID No': '555566667777' });
  const b = mkRow({ Name: 'Vijay Rao', PhoneMobile: '9822222222', Email: 'vijay@x.com', 'Conf No': '1M06', 'ID No': '555566667777' });
  const dups = run([a, b]).hardErrors.filter(f => f.check === 'within_file_duplicate');
  assert.ok(dups.some(d => d.matchBy === 'aadhar'));
});

// ── safety / soft / sensitive ────────────────────────────────────────────

test('emergency contact equal to own mobile → safety emergency_eq_self', () => {
  const f = run([mkRow({ 'Emergency Contact No': '9876543210' })]); // == PhoneMobile
  assert.ok(has(f.safety, 'emergency_eq_self'));
});

test('shared email across unrelated surnames → soft shared_email_unrelated', () => {
  const a = mkRow({ Name: 'Amit Shah', 'ID No': '111122223333', PhoneMobile: '9811111111', 'Conf No': '1M05', Email: 'shared@x.com' });
  const b = mkRow({ Name: 'Vijay Rao', 'ID No': '444455556666', PhoneMobile: '9822222222', 'Conf No': '1M06', Email: 'shared@x.com' });
  assert.ok(has(run([a, b]).soft, 'shared_email_unrelated'));
});

test('non-empty sensitive field is counted', () => {
  const f = run([mkRow({ 'Physical Health': 'diabetes' })]);
  assert.strictEqual(f.sensitiveCounts['Physical Health'], 1);
});

// ── cross-course ─────────────────────────────────────────────────────────

test('same Aadhaar active in another cached course → cross_course_duplicate', () => {
  const other = { courseId: '2026-05-01', rows: [mkRow({ Name: 'Amit Shah', 'ID No': '999988887777' })] };
  const f = run([mkRow({ Name: 'Amit Shah', 'ID No': '999988887777' })], { courseId: '2026-08-01', allCourses: [other] });
  assert.ok(f.crossCourse.length > 0);
});

// ── exposed internals ────────────────────────────────────────────────────

test('_internal helpers behave as documented', () => {
  const { normPhone, ageOn, namePrefix, isActive } = CourseAudit._internal;
  assert.strictEqual(normPhone('+91 98765 43210'), '9876543210');
  assert.strictEqual(ageOn(new Date('1990-01-01'), new Date('2026-06-01')), 36);
  assert.strictEqual(namePrefix('Dr Ramesh'), 'Dr');
  assert.strictEqual(namePrefix('Ramesh'), null);
  assert.strictEqual(isActive({ Status: 'Confirmed' }), true);
  assert.strictEqual(isActive({ Status: 'Rejected' }), false);
});
