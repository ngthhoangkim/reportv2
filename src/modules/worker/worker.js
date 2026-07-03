const { config } = require('../../config/env');
const logger = require('../logging/logger');
const { collectCandidatesSince } = require('./candidateCollector');
const { generateReportSafe } = require('../report-renderer/reportGenerator');

class Worker {
  constructor() {
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    logger.worker('info', 'worker started', {
      pollSeconds: config.worker.pollSeconds,
      lookbackHours: config.worker.lookbackHours,
    });
    this.tick();
    this.timer = setInterval(() => this.tick(), config.worker.pollSeconds * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.worker('info', 'worker stopped');
  }

  async tick() {
    if (this.running) {
      logger.worker('warn', 'worker tick skipped because previous tick is still running');
      return;
    }
    this.running = true;
    const fromDate = new Date(Date.now() - config.worker.lookbackHours * 60 * 60 * 1000);
    try {
      const candidates = await collectCandidatesSince(fromDate);
      logger.worker('info', 'worker candidates collected', { count: candidates.length, fromDate: fromDate.toISOString() });
      for (const candidate of candidates) {
        await generateReportSafe({
          fileNum: candidate.fileNum,
          sessionId: candidate.sessionId,
          upload: true,
          force: false,
        });
      }
    } catch (err) {
      logger.worker('error', 'worker tick failed', { error: err.message, stack: err.stack });
    } finally {
      this.running = false;
    }
  }
}

module.exports = { Worker };
