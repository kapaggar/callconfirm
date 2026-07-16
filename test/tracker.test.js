// Unit tests for the call tracker's pure helpers (tracker-inline.js).
//
// tracker-inline.js only touches the DOM inside functions, so requiring it in
// Node populates globalThis.DipiTracker; the T-minus countdown math is exposed
// via _internal.

const { test } = require('node:test');
const assert = require('node:assert');

require('../tracker-inline.js');
const { parseCourseStart, deadlineInfo, priorityRank, validateBackup, mergeSessions } = globalThis.DipiTracker._internal;

// ── parseCourseStart ──

test('parses the scraper dates string with a year', () => {
  const d = parseCourseStart('30th-Jul to 2nd-Aug 2026');
  assert.deepStrictEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 6, 30]);
});

test('skips pseudo-matches like "3 Day" in course titles', () => {
  const d = parseCourseStart('Dhamma Sudha / 3 Day / 2026 / 30th-Jul to 2nd-Aug');
  assert.deepStrictEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 6, 30]);
});

test('no year: an upcoming date stays in the current year', () => {
  const now = new Date(2026, 6, 16); // 16 Jul 2026
  const d = parseCourseStart('30th-Jul to 2nd-Aug', now);
  assert.deepStrictEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 6, 30]);
});

test('no year: a date months in the past rolls to next year', () => {
  const now = new Date(2026, 10, 20); // 20 Nov 2026
  const d = parseCourseStart('15th-Jan to 26th-Jan', now);
  assert.strictEqual(d.getFullYear(), 2027);
});

test('garbage or empty input → null', () => {
  assert.strictEqual(parseCourseStart('Dhamma Sudha Course'), null);
  assert.strictEqual(parseCourseStart(''), null);
  assert.strictEqual(parseCourseStart(null), null);
});

// ── deadlineInfo ──

const now = new Date(2026, 6, 16); // 16 Jul 2026

test('deadline math: start in 19d with T-14 → deadline in 5d, level ok→soon boundary', () => {
  const info = deadlineInfo(new Date(2026, 7, 4), 14, now); // 4 Aug = +19d
  assert.strictEqual(info.daysToStart, 19);
  assert.strictEqual(info.daysToDeadline, 5);
  assert.strictEqual(info.level, 'soon'); // ≤7
});

test('levels: ok / urgent / over / past', () => {
  assert.strictEqual(deadlineInfo(new Date(2026, 8, 1), 14, now).level, 'ok');      // deadline 33d away
  assert.strictEqual(deadlineInfo(new Date(2026, 6, 31), 14, now).level, 'urgent'); // deadline in 1d
  assert.strictEqual(deadlineInfo(new Date(2026, 6, 20), 14, now).level, 'over');   // deadline 10d ago
  assert.strictEqual(deadlineInfo(new Date(2026, 6, 10), 14, now).level, 'past');   // course started
});

test('deadline exactly today → over-boundary is not tripped', () => {
  const info = deadlineInfo(new Date(2026, 6, 30), 14, now); // start +14 → deadline today
  assert.strictEqual(info.daysToDeadline, 0);
  assert.strictEqual(info.level, 'urgent');
});

test('null start → null', () => {
  assert.strictEqual(deadlineInfo(null, 14, now), null);
});

// ── priorityRank ──

test('priority order: pending first, cancelled last, unknown mid-rank', () => {
  const order = ['pending', 'callback', 'no_answer', 'tentative', 'left_message', 'confirmed', 'cancelled']
    .map(status => priorityRank({ status }));
  assert.deepStrictEqual(order, [0, 1, 2, 3, 4, 5, 6]);
  assert.strictEqual(priorityRank({ status: 'something_new' }), 3);
});

// ── validateBackup ──

test('validateBackup accepts a v1 envelope and rejects everything else', () => {
  const good = { kind: 'dipiTracker.session', v: 1, session: { title: 'X', applicants: [] } };
  assert.strictEqual(validateBackup(good), null);
  assert.match(validateBackup({ foo: 1 }) || '', /Not a tracker session backup/);
  assert.match(validateBackup({ kind: 'dipiTracker.session', v: 2, session: good.session }) || '', /Unsupported backup version/);
  assert.match(validateBackup({ kind: 'dipiTracker.session', v: 1, session: { title: 'X' } }) || '', /missing session data/);
  assert.match(validateBackup(null) || '', /Not a tracker session backup/);
});

// ── mergeSessions ──

const app = (o) => ({
  id: 'x', name: 'Ramesh Kumar', aid: '101', mobile: '+919876543210',
  status: 'pending', attempts: 0, lastAttempt: null, notes: '', ...o,
});
const sess = (applicants) => ({ applicants });

test('newer lastAttempt wins on the same AID', () => {
  const local = app({ status: 'no_answer', attempts: 1, lastAttempt: '2026-07-10T10:00:00Z' });
  const incoming = app({ status: 'confirmed', attempts: 2, lastAttempt: '2026-07-15T10:00:00Z' });
  const { merged, stats } = mergeSessions(sess([local]), sess([incoming]));
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].status, 'confirmed');
  assert.deepStrictEqual(stats, { updated: 1, added: 0 });
});

test('older incoming record does not overwrite local progress', () => {
  const local = app({ status: 'confirmed', lastAttempt: '2026-07-15T10:00:00Z' });
  const incoming = app({ status: 'no_answer', lastAttempt: '2026-07-10T10:00:00Z' });
  const { merged, stats } = mergeSessions(sess([local]), sess([incoming]));
  assert.strictEqual(merged[0].status, 'confirmed');
  assert.deepStrictEqual(stats, { updated: 0, added: 0 });
});

test('timestamp tie: the record with progress beats a pristine pending one', () => {
  const local = app();                                  // untouched
  const incoming = app({ status: 'confirmed', attempts: 1 }); // progress, no lastAttempt
  const { merged } = mergeSessions(sess([local]), sess([incoming]));
  assert.strictEqual(merged[0].status, 'confirmed');
});

test('notes are never dropped and attempts take the max', () => {
  const local = app({ notes: 'call after 6pm', attempts: 3, lastAttempt: '2026-07-10T10:00:00Z' });
  const incoming = app({ status: 'confirmed', notes: '', attempts: 1, lastAttempt: '2026-07-15T10:00:00Z' });
  const { merged } = mergeSessions(sess([local]), sess([incoming]));
  assert.strictEqual(merged[0].status, 'confirmed');    // incoming won…
  assert.strictEqual(merged[0].notes, 'call after 6pm'); // …but the loser's notes survive
  assert.strictEqual(merged[0].attempts, 3);
});

test('unmatched incoming applicants are appended; locals not in the backup stay', () => {
  const local = app({ aid: '101', name: 'Ramesh Kumar' });
  const incoming = app({ aid: '202', name: 'Amit Shah' });
  const { merged, stats } = mergeSessions(sess([local]), sess([incoming]));
  assert.strictEqual(merged.length, 2);
  assert.deepStrictEqual(stats, { updated: 0, added: 1 });
  assert.deepStrictEqual(merged.map(a => a.name), ['Amit Shah', 'Ramesh Kumar']); // name-sorted
});

test('no AID: falls back to name+mobile matching', () => {
  const local = app({ aid: '', status: 'no_answer', lastAttempt: '2026-07-10T10:00:00Z' });
  const incoming = app({ aid: '', status: 'confirmed', lastAttempt: '2026-07-15T10:00:00Z' });
  const { merged, stats } = mergeSessions(sess([local]), sess([incoming]));
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].status, 'confirmed');
  assert.deepStrictEqual(stats, { updated: 1, added: 0 });
});
