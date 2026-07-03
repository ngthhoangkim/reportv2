const fs = require('fs');
const path = require('path');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');

function statePath(name) {
  ensureDir(config.paths.stateDir);
  return path.join(config.paths.stateDir, name);
}

function readJson(name, fallback) {
  const file = statePath(name);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const file = statePath(name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function appendJsonl(name, value) {
  const file = statePath(name);
  fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...value })}\n`, 'utf8');
}

function readJsonlRecent(name, limit = 100) {
  const file = statePath(name);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
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

module.exports = {
  readJson,
  writeJson,
  appendJsonl,
  readJsonlRecent,
  getSnapshots,
  setSnapshot,
};
