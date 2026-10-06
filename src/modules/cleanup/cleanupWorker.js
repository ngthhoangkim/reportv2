const { config } = require('../../config/env');
const logger = require('../logging/logger');
const { cleanupStaleRenderDirs } = require('../../config/paths');

class CleanupWorker {
  constructor() {
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return;
    logger.app('info', 'cleanup worker started', {
      intervalSeconds: config.cleanup.intervalSeconds,
      tmpStaleSeconds: config.cleanup.tmpStaleSeconds,
      outputStaleSeconds: config.cleanup.outputStaleSeconds,
      logRetentionDays: config.cleanup.logRetentionDays,
    });
    this.tick();
    this.timer = setInterval(() => this.tick(), config.cleanup.intervalSeconds * 1000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.app('info', 'cleanup worker stopped');
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await cleanupStaleRenderDirs();
    } catch (err) {
      logger.app('warn', 'cleanup worker tick failed', { error: err.message, stack: err.stack });
    } finally {
      this.running = false;
    }
  }
}

module.exports = { CleanupWorker };
