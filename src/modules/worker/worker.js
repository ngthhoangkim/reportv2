const { config } = require('../../config/env');
const logger = require('../logging/logger');
const { collectCandidatesSince } = require('./candidateCollector');
const { generateReportSafe } = require('../report-renderer/reportGenerator');
const { generatePrescriptionsSafe } = require('../prescription/prescriptionGenerator');
const state = require('../state/stateStore');

const CURSOR_FILE = 'worker-cursor.json';

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function loadCursor() {
  const cursor = state.readJson(CURSOR_FILE, {});
  return validDate(cursor.lastChangedAt);
}

function saveCursor(lastChangedAt, extra = {}) {
  state.writeJson(CURSOR_FILE, {
    lastChangedAt: lastChangedAt.toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

function sortCandidates(candidates) {
  return candidates.slice().sort((a, b) => {
    const left = a.lastChangedAt ? new Date(a.lastChangedAt).getTime() : 0;
    const right = b.lastChangedAt ? new Date(b.lastChangedAt).getTime() : 0;
    if (left !== right) return left - right;
    const byFile = String(a.fileNum || '').localeCompare(String(b.fileNum || ''));
    if (byFile) return byFile;
    const bySession = Number(a.sessionId || 0) - Number(b.sessionId || 0);
    if (bySession) return bySession;
    return Number(a.progressId || 0) - Number(b.progressId || 0);
  });
}

function maxChangedAt(candidates, fallback) {
  let max = fallback;
  for (const candidate of candidates) {
    const changedAt = validDate(candidate.lastChangedAt);
    if (changedAt && changedAt > max) max = changedAt;
  }
  return max;
}

function parseScheduleTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function nextScheduledRun(now = new Date(), scheduleTimes = []) {
  const times = scheduleTimes.map(parseScheduleTime).filter(Boolean);
  if (!times.length) return null;
  let best = null;
  for (const time of times) {
    const candidate = new Date(now);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
    if (!best || candidate < best) best = candidate;
  }
  return best;
}

class Worker {
  constructor() {
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    logger.worker('info', 'worker started', {
      scheduleTimes: config.worker.scheduleTimes,
      pollSecondsOverride: config.worker.pollSeconds || null,
      initialLookbackHours: config.worker.initialLookbackHours,
      cursorOverlapMinutes: config.worker.cursorOverlapMinutes,
      settleSeconds: config.worker.settleSeconds,
    });
    this.scheduleNext();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    logger.worker('info', 'worker stopped');
  }

  scheduleNext() {
    if (config.worker.pollSeconds > 0) {
      this.timer = setTimeout(async () => {
        this.timer = null;
        await this.tick();
        this.scheduleNext();
      }, config.worker.pollSeconds * 1000);
      this.timer.unref();
      return;
    }

    const nextRun = nextScheduledRun(new Date(), config.worker.scheduleTimes);
    if (!nextRun) {
      logger.worker('warn', 'worker schedule is empty; no automatic DB sync will run');
      return;
    }
    const delayMs = Math.max(nextRun.getTime() - Date.now(), 1000);
    logger.worker('info', 'worker next run scheduled', { nextRun: nextRun.toISOString(), scheduleTimes: config.worker.scheduleTimes });
    this.timer = setTimeout(async () => {
      this.timer = null;
      await this.tick();
      this.scheduleNext();
    }, delayMs);
    this.timer.unref();
  }

  async tick() {
    if (this.running) {
      logger.worker('warn', 'worker tick skipped because previous tick is still running');
      return;
    }
    this.running = true;
    const now = Date.now();
    const cursor = loadCursor();
    const toDate = new Date(now - config.worker.settleSeconds * 1000);
    const fromDate = cursor
      ? new Date(cursor.getTime() - config.worker.cursorOverlapMinutes * 60 * 1000)
      : new Date(now - config.worker.initialLookbackHours * 60 * 60 * 1000);
    try {
      if (fromDate > toDate) {
        logger.worker('warn', 'worker tick skipped because cursor is ahead of settled time', {
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
          cursor: cursor ? cursor.toISOString() : null,
        });
        return;
      }
      const candidates = sortCandidates(await collectCandidatesSince(fromDate, null, toDate));
      logger.worker('info', 'worker candidates collected', {
        count: candidates.length,
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        cursor: cursor ? cursor.toISOString() : null,
      });
      for (const candidate of candidates) {
        if (candidate.source === 'prescription') {
          await generatePrescriptionsSafe({
            fileNum: candidate.fileNum,
            sessionId: candidate.sessionId,
            progressId: candidate.progressId,
            upload: true,
            force: false,
          });
        } else {
          await generateReportSafe({
            fileNum: candidate.fileNum,
            sessionId: candidate.sessionId,
            upload: true,
            force: false,
          });
        }
      }
      const nextCursor = maxChangedAt(candidates, toDate);
      saveCursor(nextCursor, { processedCount: candidates.length });
      logger.worker('info', 'worker cursor saved', { lastChangedAt: nextCursor.toISOString(), processedCount: candidates.length });
    } catch (err) {
      logger.worker('error', 'worker tick failed', { error: err.message, stack: err.stack });
    } finally {
      this.running = false;
    }
  }
}

module.exports = { Worker };
