const test = require('node:test');
const assert = require('node:assert/strict');
const { isZipMagic, isJpegMagic, isPngMagic } = require('../src/modules/media-resolver/mediaResolver');

test('detects media archive magic without extension', () => {
  assert.equal(isZipMagic(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(isJpegMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(isPngMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
});
