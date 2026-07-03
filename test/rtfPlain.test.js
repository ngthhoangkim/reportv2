const test = require('node:test');
const assert = require('node:assert/strict');
const { fallbackRtfToPlainText, normalizeVietnameseToneMarks } = require('../src/modules/report-renderer/rtfPlain');

test('normalizes detached Vietnamese acute/grave tone marks', () => {
  assert.equal(normalizeVietnameseToneMarks('kê´t luâ`n câ`n kha´c'), 'kết luần cần khác');
});

test('RTF plain fallback decodes win1258 hex and normalizes text', () => {
  const rtf = String.raw`{\rtf1 KET LUAN:\par c\'e2\'ccn kê´t}`;
  const plain = fallbackRtfToPlainText(rtf);
  assert.match(plain, /cần kết/);
});
