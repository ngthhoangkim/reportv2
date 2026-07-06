const { collectCandidatesSince } = require('../modules/worker/candidateCollector');
const { generateReportSafe } = require('../modules/report-renderer/reportGenerator');
const { generatePrescriptionsSafe } = require('../modules/prescription/prescriptionGenerator');
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
    .map((item) => ({
      fileNum: item.fileNum,
      sessionId: item.sessionId == null ? null : Number(item.sessionId),
      progressId: item.progressId == null ? null : Number(item.progressId),
      source: item.type === 'prescription' ? 'prescription' : 'failed',
    }));
}

function candidateSortValue(item) {
  return item.lastChangedAt ? new Date(item.lastChangedAt).getTime() : Number.MAX_SAFE_INTEGER;
}

function sortCandidates(candidates) {
  return candidates.slice().sort((a, b) => {
    const byDate = candidateSortValue(a) - candidateSortValue(b);
    if (byDate) return byDate;
    const byFile = String(a.fileNum || '').localeCompare(String(b.fileNum || ''));
    if (byFile) return byFile;
    const bySession = Number(a.sessionId || 0) - Number(b.sessionId || 0);
    if (bySession) return bySession;
    return Number(a.progressId || 0) - Number(b.progressId || 0);
  });
}

function writeProgress(options, item, index, total, result) {
  state.writeJson('backfill-progress.json', {
    updatedAt: new Date().toISOString(),
    range: options.date ? { date: options.date } : { from: options.from || null, to: options.to || null },
    types: options.types || null,
    upload: Boolean(options.upload),
    force: Boolean(options.force),
    index,
    total,
    remaining: Math.max(total - index, 0),
    current: item,
    ok: result && result.ok !== false,
    error: result && result.ok === false ? result.error || null : null,
  });
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
    const key = c.source === 'prescription'
      ? `${c.source}::${c.fileNum}::${c.sessionId == null ? 'all' : c.sessionId}::${c.progressId == null ? 'all' : c.progressId}`
      : `${c.fileNum}::${c.sessionId == null ? 'all' : c.sessionId}`;
    unique.set(key, c);
  }
  const list = sortCandidates(Array.from(unique.values()));
  logger.backfill('info', 'backfill candidates', { count: list.length, dryRun: Boolean(options.dryRun), force: Boolean(options.force) });

  if (options.dryRun) {
    return { ok: true, dryRun: true, count: list.length, candidates: list };
  }

  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    logger.backfill('info', 'backfill progress', {
      index: i + 1,
      total: list.length,
      remaining: list.length - i - 1,
      fileNum: item.fileNum,
      sessionId: item.sessionId,
      progressId: item.progressId,
      source: item.source,
      lastChangedAt: item.lastChangedAt,
    });
    let result;
    if (item.source === 'prescription') {
      result = await generatePrescriptionsSafe({
        fileNum: item.fileNum,
        sessionId: item.sessionId,
        progressId: item.progressId,
        force: Boolean(options.force),
        upload: Boolean(options.upload),
      });
    } else {
      result = await generateReportSafe({
        fileNum: item.fileNum,
        sessionId: item.sessionId,
        resultFileName: options.resultFileName,
        mode: options.mode,
        force: Boolean(options.force),
        upload: Boolean(options.upload),
      });
    }
    results.push(result);
    writeProgress(options, item, i + 1, list.length, result);
  }
  return { ok: true, count: results.length, results };
}

module.exports = { runBackfill, parseTypes };
