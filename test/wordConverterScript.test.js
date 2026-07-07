const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'src', 'modules', 'word-converter', 'wordConverter.js');

test('embedded PowerShell regexes keep their backslashes through the JS template literal', () => {
  const src = fs.readFileSync(sourcePath, 'utf8');
  // Inside a JS template literal `\s` becomes `s` and `\d` becomes `d`, which
  // once made PowerShell `-split '\s+'` split on the letter "s" and drop every
  // s/S from prescription lines. Regex escapes must be written as `\\s` / `\\d`.
  const singleEscaped = src.match(/[^\\]\\[sdwSDW][*+]/g) || [];
  assert.deepEqual(singleEscaped, []);
});
