const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCdhaPdfFileName,
  resolveCdhaRecordPdfFileName,
  resolveCnFilePdfFileName,
  resolvePrescriptionUploadName,
  normalizePrescriptionPrefix,
} = require('../src/modules/report-renderer/outputNaming');

test('CDHA output name follows v1 latest imaging FileName rule', () => {
  const name = resolveCdhaPdfFileName({
    fileNum: '16012083',
    sessionId: 855699,
    imaging: [
      { fileName: 'old-result' },
      { fileName: 'new/result:name.pdf' },
    ],
  });
  assert.equal(name, 'new_result_name.pdf');
});

test('CDHA output name supports explicit v1 override', () => {
  const name = resolveCdhaPdfFileName({ fileNum: '1', sessionId: 2, imaging: [] }, 'ABC.pdf');
  assert.equal(name, 'ABC.pdf');
});

test('CDHA item output name follows each imaging FileName', () => {
  assert.equal(resolveCdhaRecordPdfFileName({ fileName: '20260522075119490221254' }), '20260522075119490221254.pdf');
});

test('prescription S3 upload naming uses ProgressId per toa', () => {
  assert.equal(normalizePrescriptionPrefix(), 'khambenh/toathuoc/');
  assert.equal(resolvePrescriptionUploadName(539910), '539910.pdf');
});

test('CN_FILES output uses table file basename with pdf extension', () => {
  assert.equal(resolveCnFilePdfFileName('Doc260522082233560.zip'), 'Doc260522082233560.pdf');
});
