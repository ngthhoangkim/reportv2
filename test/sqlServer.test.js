const test = require('node:test');
const assert = require('node:assert/strict');
const { assertReadOnly } = require('../src/db/sqlServer');

test('assertReadOnly allows select queries', () => {
  assert.doesNotThrow(() => assertReadOnly('SELECT TOP 1 * FROM dbo.CN_FILES WITH (NOLOCK)'));
  assert.doesNotThrow(() => assertReadOnly('WITH cte AS (SELECT 1 AS id) SELECT * FROM cte'));
});

test('assertReadOnly blocks write and admin statements', () => {
  assert.throws(() => assertReadOnly('UPDATE dbo.CN_FILES SET DocTitle = N"x"'), /blocked/);
  assert.throws(() => assertReadOnly('DELETE FROM dbo.CN_FILES'), /blocked/);
  assert.throws(() => assertReadOnly('CREATE TABLE dbo.TestTable (Id int)'), /blocked/);
  assert.throws(() => assertReadOnly('SELECT * INTO dbo.TempCopy FROM dbo.CN_FILES'), /blocked/);
});
