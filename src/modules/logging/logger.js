const fs = require('fs');
const path = require('path');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function appendJsonl(channel, entry) {
  ensureDir(config.paths.logsDir);
  const file = path.join(config.paths.logsDir, `${channel}-${dayKey()}.jsonl`);
  const row = {
    ts: new Date().toISOString(),
    channel,
    ...entry,
  };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function log(channel, level, message, meta = {}) {
  appendJsonl(channel, { level, message, ...meta });
  const line = `[${level.toUpperCase()}] ${message}`;
  if (level === 'error') console.error(line, meta);
  else console.log(line, meta);
}

module.exports = {
  app: (level, message, meta) => log('app', level, message, meta),
  worker: (level, message, meta) => log('worker', level, message, meta),
  job: (level, message, meta) => log('job', level, message, meta),
  backfill: (level, message, meta) => log('backfill', level, message, meta),
  upload: (level, message, meta) => log('upload', level, message, meta),
  error: (message, meta) => log('error', 'error', message, meta),
  appendJsonl,
};
