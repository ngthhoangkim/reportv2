const { collectCandidatesSince } = require('../modules/worker/candidateCollector');
const { generatePrescriptionsSafe } = require('../modules/prescription/prescriptionGenerator');
const state = require('../modules/state/stateStore');
const logger = require('../modules/logging/logger');

function dayRange(date) {
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(`${date}T23:59:59.999`);
  return { from, to };
}

async function candidatesForRange(from, to) {
  const all = await collectCandidatesSince(from, ['prescription']);
  return all.filter((c) => !c.lastChangedAt || new Date(c.lastChangedAt) <= to);
}

function failedCandidates() {
  return state.readJsonlRecent('failed-jobs.jsonl', 1000)
    .filter((item) => item.type === 'prescription' && item.fileNum)
    .map((item) => ({
      fileNum: item.fileNum,
      sessionId: item.sessionId == null ? null : Number(item.sessionId),
      progressId: item.progressId == null ? null : Number(item.progressId),
      source: 'failed',
    }));
}

async function runPrescriptionBackfill(options) {
  let candidates = [];
  if (options.fileNum) {
    candidates = [{
      fileNum: String(options.fileNum).trim(),
      sessionId: options.sessionId == null || options.sessionId === '' ? null : Number(options.sessionId),
      progressId: options.progressId == null || options.progressId === '' ? null : Number(options.progressId),
      source: 'manual',
    }];
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
      throw new Error('Prescription backfill requires --date, --from/--to, --fileNum, or --failed-only');
    }
    candidates = await candidatesForRange(from, to);
  }

  const unique = new Map();
  for (const c of candidates) {
    const key = `${c.fileNum}::${c.sessionId == null ? 'all' : c.sessionId}::${c.progressId == null ? 'all' : c.progressId}`;
    unique.set(key, c);
  }
  const list = Array.from(unique.values());
  logger.backfill('info', 'prescription backfill candidates', {
    count: list.length,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
  });

  if (options.dryRun) {
    return { ok: true, dryRun: true, count: list.length, candidates: list };
  }

  const results = [];
  for (const item of list) {
    results.push(await generatePrescriptionsSafe({
      fileNum: item.fileNum,
      sessionId: item.sessionId,
      progressId: item.progressId,
      force: Boolean(options.force),
      upload: Boolean(options.upload),
    }));
  }
  return { ok: true, count: results.length, results };
}

module.exports = { runPrescriptionBackfill };
