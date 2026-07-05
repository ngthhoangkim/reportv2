const test = require('node:test');
const assert = require('node:assert/strict');
const { progressBarcode } = require('../src/modules/prescription/prescriptionUtils');
const { convertAngleTokens } = require('../src/modules/prescription/prescriptionRenderer');
const { s3KeyForProgress } = require('../src/modules/prescription/prescriptionGenerator');

test('progress barcode is G plus 8-digit padded ProgressId', () => {
  assert.equal(progressBarcode(539910), 'G00539910');
  assert.equal(progressBarcode(501136), 'G00501136');
});

test('prescription S3 key is split by ProgressId', () => {
  assert.equal(s3KeyForProgress(539910), 'khambenh/toathuoc/539910.pdf');
});

test('short angle placeholders normalize to docxtemplater tags', () => {
  assert.equal(convertAngleTokens('Số <SO> - < BP > - < PatientName>'), 'Số {So} - {BP} - {PatientName}');
  assert.equal(convertAngleTokens('<#>/<SL> <U><ItemName><Q><F>'), '{MedicationBlock} ');
});

test('front template treats repeated PatientID placeholders by position', () => {
  const context = { role: 'front', patientIdCount: 0 };
  assert.equal(convertAngleTokens('<PatientID> <PatientID>', context), '{PatientName} {PatientBarcode}');
});
