const fs = require('fs');
const path = require('path');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');

const JSONL_RETENTION_BYTES = (Number(process.env.STATE_JSONL_RETENTION_MB) || 50) * 1024 * 1024;
const SNAPSHOT_COMPACT_MAX_BYTES = (Number(process.env.STATE_SNAPSHOT_COMPACT_MAX_MB) || 200) * 1024 * 1024;

function statePath(name) {
  ensureDir(config.paths.stateDir);
  return path.join(config.paths.stateDir, name);
}

function readJson(name, fallback) {
  const file = statePath(name);
  try {
    if (!fs.existsSync(file)) return fallback;
    if (fs.statSync(file).size > SNAPSHOT_COMPACT_MAX_BYTES) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const file = statePath(name);
  // tmp phải riêng theo process, nếu không hai process sẽ ghi đè tmp của nhau rồi rename nhầm.
  const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function appendJsonl(name, value) {
  const file = statePath(name);
  fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...value })}\n`, 'utf8');
  try {
    if (fs.statSync(file).size > JSONL_RETENTION_BYTES * 2) trimJsonlFile(name);
  } catch {
    // Best-effort retention only; append success is more important than cleanup.
  }
}

function readJsonlRecent(name, limit = 100) {
  const file = statePath(name);
  if (!fs.existsSync(file)) return [];
  const stat = fs.statSync(file);
  const readBytes = Math.min(stat.size, JSONL_RETENTION_BYTES);
  const fd = fs.openSync(file, 'r');
  let text = '';
  try {
    const buffer = Buffer.alloc(readBytes);
    fs.readSync(fd, buffer, 0, readBytes, stat.size - readBytes);
    text = buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (stat.size > readBytes) lines.shift();
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  }).reverse();
}

function getSnapshots() {
  return readJson('source-snapshots.json', {});
}

function setSnapshot(key, snapshot) {
  const all = getSnapshots();
  all[key] = { ...snapshot, savedAt: new Date().toISOString() };
  writeJson('source-snapshots.json', all);
}

function trimJsonlFile(name, maxBytes = JSONL_RETENTION_BYTES) {
  const file = statePath(name);
  if (!fs.existsSync(file)) return { file, skipped: true, reason: 'missing' };
  const stat = fs.statSync(file);
  if (stat.size <= maxBytes) return { file, skipped: true, reason: 'under_limit', bytes: stat.size };

  const fd = fs.openSync(file, 'r');
  let text = '';
  try {
    const buffer = Buffer.alloc(maxBytes);
    fs.readSync(fd, buffer, 0, maxBytes, stat.size - maxBytes);
    text = buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
  const lines = text.split(/\r?\n/);
  lines.shift();
  const kept = lines.filter(Boolean).join('\n');
  fs.writeFileSync(file, kept ? `${kept}\n` : '', 'utf8');
  return { file, skipped: false, beforeBytes: stat.size, afterBytes: fs.statSync(file).size };
}

function compactSnapshotsFile(maxBytes = SNAPSHOT_COMPACT_MAX_BYTES) {
  const file = statePath('source-snapshots.json');
  if (!fs.existsSync(file)) return { file, skipped: true, reason: 'missing' };
  const stat = fs.statSync(file);
  if (stat.size > maxBytes) return { file, skipped: true, reason: 'too_large_for_safe_parse', bytes: stat.size };

  const snapshots = readJson('source-snapshots.json', {});
  let changed = false;
  for (const key of Object.keys(snapshots)) {
    if (snapshots[key] && snapshots[key].sourceSnapshot) {
      delete snapshots[key].sourceSnapshot;
      changed = true;
    }
  }
  if (!changed) return { file, skipped: true, reason: 'already_compact', bytes: stat.size };
  writeJson('source-snapshots.json', snapshots);
  return { file, skipped: false, beforeBytes: stat.size, afterBytes: fs.statSync(file).size };
}

function cleanupStateFiles() {
  return {
    generated: trimJsonlFile('generated-files.jsonl'),
    failedJobs: trimJsonlFile('failed-jobs.jsonl'),
    failedUploads: trimJsonlFile('failed-uploads.jsonl'),
    snapshots: compactSnapshotsFile(),
  };
}

module.exports = {
  readJson,
  writeJson,
  appendJsonl,
  readJsonlRecent,
  getSnapshots,
  setSnapshot,
  trimJsonlFile,
  compactSnapshotsFile,
  cleanupStateFiles,
};
