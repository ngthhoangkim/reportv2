const { createApp } = require('./app');
const { config } = require('./config/env');
const logger = require('./modules/logging/logger');
const { Worker } = require('./modules/worker/worker');
const db = require('./db/sqlServer');

const app = createApp();
const worker = new Worker();
const server = app.listen(config.app.port, () => {
  logger.app('info', 'reportv2 server started', { port: config.app.port, workerEnabled: config.worker.enabled });
  if (config.worker.enabled) worker.start();
});

async function shutdown(signal) {
  logger.app('info', 'shutdown requested', { signal });
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
