const { createApp } = require('./app');
const { config } = require('./config/env');
const logger = require('./modules/logging/logger');
const { Worker } = require('./modules/worker/worker');
const db = require('./db/sqlServer');
const { cleanupRenderDirsOnStartup, cleanupStaleRenderDirs } = require('./config/paths');

const STALE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // mỗi 1 giờ

const app = createApp();
const worker = new Worker();
const server = app.listen(config.app.port, async () => {
  logger.app('info', 'reportv2 server started', { port: config.app.port, workerEnabled: config.worker.enabled });
  await cleanupRenderDirsOnStartup();
  if (config.worker.enabled) worker.start();
});

const staleCleanupTimer = setInterval(() => cleanupStaleRenderDirs(), STALE_CLEANUP_INTERVAL_MS);
staleCleanupTimer.unref();

async function shutdown(signal) {
  logger.app('info', 'shutdown requested', { signal });
  clearInterval(staleCleanupTimer);
  worker.stop();
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server, worker };
