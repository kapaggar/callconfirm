// Unit tests for the face-dedup matching math (photo-review/facematch.js).
//
// The browser parts (face-api, IndexedDB) are guarded behind IS_BROWSER, so
// requiring the file in Node populates globalThis.FaceMatch with the pure
// matching helpers under _internal. Descriptors here are tiny synthetic
// vectors — dist() is dimension-agnostic, so 2-d points make readable cases.

const { test } = require('node:test');
const assert = require('node:assert');

require('../photo-review/facematch.js');
const { dist, tier, matchPairs, pruneKeep } = globalThis.FaceMatch._internal;
const { TIERS } = globalThis.FaceMatch;

const rec = (courseKey, aid, name, desc) => ({ courseKey, aid, name, desc });

test('dist is Euclidean', () => {
  assert.strictEqual(dist([0, 0], [3, 4]), 5);
  assert.strictEqual(dist([1, 1], [1, 1]), 0);
});

test('tier boundaries: ≤strong → strong, ≤possible → possible, above → null', () => {
  assert.strictEqual(tier(TIERS.strong), 'strong');
  assert.strictEqual(tier(TIERS.strong + 0.001), 'possible');
  assert.strictEqual(tier(TIERS.possible), 'possible');
  assert.strictEqual(tier(TIERS.possible + 0.001), null);
});

test('same face across two courses → one cross-course match', () => {
  const records = [
    rec('63/100', 'a1', 'Ramesh Kumar', [0, 0]),
    rec('63/200', 'b7', 'R Kumar', [0.1, 0]), // distance 0.1 → strong
  ];
  const m = matchPairs(records, '63/100');
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].otherCourse, '63/200');
  assert.strictEqual(m[0].tier, 'strong');
  assert.strictEqual(m[0].withinCourse, false);
});

test('distinct faces produce no match', () => {
  const records = [
    rec('63/100', 'a1', 'Ramesh', [0, 0]),
    rec('63/200', 'b7', 'Suresh', [5, 5]),
  ];
  assert.deepStrictEqual(matchPairs(records, '63/100'), []);
});

test('same face twice within one course → flagged once, withinCourse', () => {
  const records = [
    rec('63/100', 'a1', 'Ramesh Kumar', [0, 0]),
    rec('63/100', 'a2', 'Ram Kumar', [0.05, 0]),
  ];
  const m = matchPairs(records, '63/100');
  assert.strictEqual(m.length, 1, 'in-course pair must be counted once, not twice');
  assert.strictEqual(m[0].withinCourse, true);
});

test('possible-tier distance is flagged as possible', () => {
  const d = (TIERS.strong + TIERS.possible) / 2; // between the two ceilings
  const records = [
    rec('63/100', 'a1', 'Ramesh', [0, 0]),
    rec('63/200', 'b7', 'Ramesh?', [d, 0]),
  ];
  const m = matchPairs(records, '63/100');
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].tier, 'possible');
});

test('matches sort closest-first and records without descriptors are skipped', () => {
  const records = [
    rec('63/100', 'a1', 'Ramesh', [0, 0]),
    rec('63/200', 'b1', 'Far', [0.5, 0]),
    rec('63/200', 'b2', 'Near', [0.1, 0]),
    rec('63/200', 'b3', 'NoDesc', null),
  ];
  const m = matchPairs(records, '63/100');
  assert.strictEqual(m.length, 2);
  assert.strictEqual(m[0].otherName, 'Near');
  assert.strictEqual(m[1].otherName, 'Far');
});

test('the flagged course only reports its own applicants (left side)', () => {
  const records = [
    rec('63/100', 'a1', 'Ramesh', [0, 0]),
    rec('63/200', 'b1', 'Kumar', [0.1, 0]),
    rec('63/300', 'c1', 'Third', [9, 9]), // matches nobody
  ];
  const m = matchPairs(records, '63/200');
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].aid, 'b1');
  assert.strictEqual(m[0].otherCourse, '63/100');
});

test('pruneKeep evicts the oldest courses beyond the cap', () => {
  const courses = [
    { courseKey: 'old', ts: 1 },
    { courseKey: 'mid', ts: 2 },
    { courseKey: 'new', ts: 3 },
  ];
  assert.deepStrictEqual(pruneKeep(courses, 2), ['old']);
  assert.deepStrictEqual(pruneKeep(courses, 3), []);
});
