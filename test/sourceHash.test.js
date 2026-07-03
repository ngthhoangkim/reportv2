const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceHash } = require('../src/modules/case-collector/sourceHash');
const { snapshotKey } = require('../src/modules/report-renderer/reportGenerator');

test('sourceHash is stable regardless of object key order', () => {
  const a = sourceHash({ b: 2, a: { y: 1, x: 0 } });
  const b = sourceHash({ a: { x: 0, y: 1 }, b: 2 });
  assert.equal(a, b);
});

test('snapshotKey separates all-session and specific session jobs', () => {
  assert.equal(snapshotKey('16012083', null), '16012083::all');
  assert.equal(snapshotKey('16012083', 855699), '16012083::855699');
});
