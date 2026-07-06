const test = require('node:test');
const assert = require('node:assert/strict');
const { progressBarcode } = require('../src/modules/prescription/prescriptionUtils');
const { medicationBlock } = require('../src/modules/prescription/prescriptionCollector');
const {
  convertAngleTokens,
  angleTokenFinds,
  buildWordReplacements,
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

test('word replacements preserve first PatientID as name on front template', () => {
  const replacements = buildWordReplacements({
    PatientName: 'A',
    PatientBarcode: '*B*',
    Conclusion: 'C',
    MedicationBlock: 'M',
  }, { role: 'front' });
  assert.deepEqual(replacements.slice(0, 2), [
    { find: '<PatientID>', finds: ['<PatientID>', '< PatientID>', '<PatientID >', '< PatientID >'], replace: 'A', once: true },
    { find: '<PatientID>', finds: ['<PatientID>', '< PatientID>', '<PatientID >', '< PatientID >'], replace: '*B*', once: false },
  ]);
});

test('word replacements include spaced angle token variants', () => {
  assert.deepEqual(angleTokenFinds('BP'), ['<BP>', '< BP>', '<BP >', '< BP >']);
});

test('word replacements send medication scaffold as a block', () => {
  const replacements = buildWordReplacements({ MedicationBlock: '1/ A' });
  assert.ok(replacements.some((item) => item.kind === 'medicationScaffold' && item.replace === '1/ A'));
  assert.equal(replacements.some((item) => item.find === '<ItemName>'), false);
});

test('medication block follows prescription scaffold order', () => {
  assert.equal(medicationBlock([{
    index: 1,
    itemName: 'Hapacol Caplet 500',
    property: 'Paracetamol (acetaminophen)',
    quantity: '10',
    unit: 'Viên',
    dose: '1',
    doseUnit: 'Viên',
    frequency: '2 lần/ngày',
    instructions: 'sáng chiều sau ăn',
  }]), [
    '1/ 10 Viên',
    'Hapacol Caplet 500',
    '(Paracetamol (acetaminophen))',
    'Ngày 2 lần/ngày, mỗi lần 1 Viên',
    'sáng chiều sau ăn',
  ].join('\n'));
});
