const test = require('node:test');
const assert = require('node:assert/strict');
const { toPdfSafeText } = require('../src/modules/report-renderer/pdfSummary');

test('PDF summary fallback strips Vietnamese accents for StandardFonts', () => {
  assert.equal(toPdfSafeText('NGUYỄN THỊ HUỲNH HÀ'), 'NGUYEN THI HUYNH HA');
});
