const { collectCandidatesSince } = require('../modules/worker/candidateCollector');
const { generateReportSafe } = require('../modules/report-renderer/reportGenerator');
const state = require('../modules/state/stateStore');
const logger = require('../modules/logging/logger');

function parseTypes(types) {
  if (!types) return null;
  if (Array.isArray(types)) return types.map((s) => String(s).trim()).filter(Boolean);
  return String(types).split(',').map((s) => s.trim()).filter(Boolean);
}

function dayRange(date) {
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(`${date}T23:59:59.999`);
  return { from, to };
}

async function candidatesForRange(from, to, types) {
  const all = await collectCandidatesSince(from, types);
  return all.filter((c) => !c.lastChangedAt || new Date(c.lastChangedAt) <= to);
}

function failedCandidates() {
  return state.readJsonlRecent('failed-jobs.jsonl', 1000)
    .filter((item) => item.fileNum)
    .map((item) => ({ fileNum: item.fileNum, sessionId: item.sessionId == null ? null : Number(item.sessionId), source: 'failed' }));
}

async function runBackfill(options) {
  const types = parseTypes(options.types);
  let candidates = [];
  if (options.fileNum) {
    candidates = [{ fileNum: String(options.fileNum).trim(), sessionId: options.sessionId == null || options.sessionId === '' ? null : Number(options.sessionId), source: 'manual' }];
  } else if (options.failedOnly) {
    candidates = failedCandidates();
  } else {
    let from;
    let to;
    if (options.date) {
      const range = dayRange(options.date);
      from = range.from;
      to = range.to;
    } else {
      from = new Date(`${options.from}T00:00:00`);
      to = new Date(`${options.to}T23:59:59.999`);
    }
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      throw new Error('Backfill requires --date, --from/--to, --fileNum, or --failed-only');
    }
    candidates = await candidatesForRange(from, to, types);
  }

  const unique = new Map();
  for (const c of candidates) {
    const key = `${c.fileNum}::${c.sessionId == null ? 'all' : c.sessionId}`;
    unique.set(key, c);
  }
  const list = Array.from(unique.values());
  logger.backfill('info', 'backfill candidates', { count: list.length, dryRun: Boolean(options.dryRun), force: Boolean(options.force) });

  if (options.dryRun) {
    return { ok: true, dryRun: true, count: list.length, candidates: list };
  }

  const results = [];
  for (const item of list) {
    results.push(await generateReportSafe({
      fileNum: item.fileNum,
      sessionId: item.sessionId,
      resultFileName: options.resultFileName,
      mode: options.mode,
      force: Boolean(options.force),
      upload: Boolean(options.upload),
    }));
  }
  return { ok: true, count: results.length, results };
}

module.exports = { runBackfill, parseTypes };
