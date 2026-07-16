// Unit tests for the call tracker's pure helpers (tracker-inline.js).
//
// tracker-inline.js only touches the DOM inside functions, so requiring it in
// Node populates globalThis.DipiTracker; the T-minus countdown math is exposed
// via _internal.

const { test } = require('node:test');
const assert = require('node:assert');

require('../tracker-inline.js');
const { parseCourseStart, deadlineInfo, priorityRank } = globalThis.DipiTracker._internal;

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
