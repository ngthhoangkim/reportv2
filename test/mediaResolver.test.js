const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCandidates } = require('../src/modules/media-resolver/mediaResolver');

test('image resolving prefers image suffixes before zip like v1', () => {
  const candidates = buildCandidates('IMG001', { preferImages: true });
  const names = candidates.map((p) => p.replace(/\\/g, '/'));
  const jpg = names.findIndex((p) => p.endsWith('/IMG001.jpg'));
  const zip = names.findIndex((p) => p.endsWith('/IMG001.zip'));
  assert.equal(jpg >= 0, true);
  assert.equal(zip >= 0, true);
  assert.equal(jpg < zip, true);
});
