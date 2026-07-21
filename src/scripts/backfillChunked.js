const { runBackfill } = require('./backfillRunner');
const state = require('../modules/state/stateStore');
const logger = require('../modules/logging/logger');
const db = require('../db/sqlServer');

const CURSOR_FILE = 'backfill-cursor.json';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function ymd(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Cắt [from, to] thành từng tháng, mặc định trả về mới nhất trước. */
function monthChunks(from, to, newestFirst = true) {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const chunks = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    const monthStart = ymd(year, month, 1);
    const monthEnd = ymd(year, month, lastDayOfMonth(year, month));
    chunks.push({
      key: `${year}-${String(month).padStart(2, '0')}`,
      from: monthStart < from ? from : monthStart,
      to: monthEnd > to ? to : monthEnd,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return newestFirst ? chunks.reverse() : chunks;
}

function loadCursor(rangeKey, reset) {
  const cursor = state.readJson(CURSOR_FILE, null);
  if (reset || !cursor || cursor.rangeKey !== rangeKey) {
    return { rangeKey, startedAt: new Date().toISOString(), done: {}, failed: {} };
  }
  return { done: {}, failed: {}, ...cursor };
}

function saveCursor(cursor, current) {
  state.writeJson(CURSOR_FILE, { ...cursor, current: current || null, updatedAt: new Date().toISOString() });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = args.from || process.env.BACKFILL_FROM;
  const to = args.to || process.env.BACKFILL_TO;
  const types = args.types || process.env.BACKFILL_TYPES || null;
  const upload = args.upload === true || args.upload === 'true'
    || String(process.env.BACKFILL_UPLOAD || 'true').toLowerCase() === 'true';
  const force = args.force === true || args.force === 'true'
    || String(process.env.BACKFILL_FORCE || 'false').toLowerCase() === 'true';
  const oldestFirst = args.oldestFirst === true || String(process.env.BACKFILL_OLDEST_FIRST || '').toLowerCase() === 'true';
  const retryFailed = args.retryFailed === true;
  const reset = args.reset === true;

  if (!isDate(from) || !isDate(to)) {
    throw new Error('Cần --from YYYY-MM-DD --to YYYY-MM-DD (hoặc biến môi trường BACKFILL_FROM / BACKFILL_TO)');
  }
  if (from > to) throw new Error(`--from (${from}) phải nhỏ hơn hoặc bằng --to (${to})`);

  const rangeKey = `${from}..${to}|${types || 'all'}|upload=${upload}|force=${force}`;
  const chunks = monthChunks(from, to, !oldestFirst);
  const cursor = loadCursor(rangeKey, reset);

  const pending = chunks.filter((chunk) => {
    if (cursor.done[chunk.key]) return false;
    if (cursor.failed[chunk.key] && !retryFailed) return false;
    return true;
  });

  logger.backfill('info', 'chunked backfill started', {
    from,
    to,
    totalChunks: chunks.length,
    pendingChunks: pending.length,
    doneChunks: Object.keys(cursor.done).length,
    order: oldestFirst ? 'oldest-first' : 'newest-first',
    upload,
    force,
    types: types || null,
  });
  saveCursor(cursor, null);

  for (let i = 0; i < pending.length; i += 1) {
    const chunk = pending[i];
    logger.backfill('info', 'chunk started', {
      chunk: chunk.key, from: chunk.from, to: chunk.to, index: i + 1, total: pending.length,
    });
    saveCursor(cursor, { ...chunk, startedAt: new Date().toISOString(), index: i + 1, total: pending.length });

    try {
      const result = await runBackfill({ from: chunk.from, to: chunk.to, types, upload, force });
      delete cursor.failed[chunk.key];
      cursor.done[chunk.key] = { count: result.count, finishedAt: new Date().toISOString() };
      logger.backfill('info', 'chunk completed', { chunk: chunk.key, count: result.count, remaining: pending.length - i - 1 });
    } catch (err) {
      // Một tháng hỏng không nên chặn các tháng còn lại; ghi lại để chạy --retry-failed sau.
      cursor.failed[chunk.key] = { error: err.message, failedAt: new Date().toISOString() };
      logger.backfill('error', 'chunk failed', { chunk: chunk.key, error: err.message, stack: err.stack });
    }
    saveCursor(cursor, null);
  }

  const failedKeys = Object.keys(cursor.failed);
  const totalCases = Object.values(cursor.done).reduce((sum, item) => sum + (item.count || 0), 0);
  logger.backfill('info', 'chunked backfill finished', {
    doneChunks: Object.keys(cursor.done).length,
    failedChunks: failedKeys,
    totalCases,
  });
  process.stdout.write(`${JSON.stringify({
    ok: failedKeys.length === 0,
    doneChunks: Object.keys(cursor.done).length,
    failedChunks: failedKeys,
    totalCases,
  }, null, 2)}\n`);
  if (failedKeys.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
