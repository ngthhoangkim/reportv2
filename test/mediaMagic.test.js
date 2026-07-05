const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const {
  isZipMagic,
  isJpegMagic,
  isPngMagic,
  extractImagesFromArchiveOrRawV1,
} = require('../src/modules/media-resolver/mediaResolver');

test('detects media archive magic without extension', () => {
  assert.equal(isZipMagic(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(isJpegMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(isPngMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
});

test('extractImagesFromArchiveOrRawV1 flattens zip image basenames like v1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reportv2-media-'));
  const zipPath = path.join(dir, 'media-no-ext');
  const outDir = path.join(dir, 'out');
  const zip = new AdmZip();
  zip.addFile('nested/IMG001.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  zip.addFile('nested/readme.txt', Buffer.from('ignore'));
  zip.writeZip(zipPath);

  const result = await extractImagesFromArchiveOrRawV1(zipPath, outDir, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.map((f) => path.basename(f)), ['IMG001.jpg']);
});
