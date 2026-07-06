const test = require('node:test');
const assert = require('node:assert/strict');
const { progressBarcode } = require('../src/modules/prescription/prescriptionUtils');
const {
  convertAngleTokens,
  prepareXmlForDocxtemplater,
  renderPlaceholdersInXml,
} = require('../src/modules/prescription/prescriptionRenderer');
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

test('prescription XML normalizer only rewrites real paragraphs', () => {
  const xml = '<w:body><w:p><w:pPr/><w:r><w:t>&lt;SO&gt;</w:t></w:r></w:p></w:body>';
  assert.equal(prepareXmlForDocxtemplater(xml), '<w:body><w:p><w:pPr/><w:r><w:t>{So}</w:t></w:r></w:p></w:body>');
});

test('prescription renderer replaces placeholders without docxtemplater', () => {
  const xml = '<w:t xml:space="preserve">{So}</w:t><w:t>{MedicationBlock}</w:t>';
  assert.equal(
    renderPlaceholdersInXml(xml, { So: 539910, MedicationBlock: 'A\nB' }),
    '<w:t xml:space="preserve">539910</w:t><w:t>A</w:t><w:br/><w:t>B</w:t>',
  );
});
