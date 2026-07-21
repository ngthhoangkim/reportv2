const fs = require('fs');
const os = require('os');
const path = require('path');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const logger = require('../logging/logger');

const LOCK_NAME = 'word-com.lock';
const HEARTBEAT_MS = 5000;
const STALE_MS = 60000;
const POLL_MS = 500;
const ACQUIRE_TIMEOUT_MS = 15 * 60 * 1000;

const host = os.hostname();
let held = null;

function lockPath() {
  ensureDir(config.paths.stateDir);
  return path.join(config.paths.stateDir, LOCK_NAME);
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isAlive(info) {
  if (!info || !info.pid) return false;
  if (info.host !== host) return true; // Không kiểm tra được pid máy khác, chỉ dựa vào heartbeat.
  try {
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isStale(info) {
  if (!info) return true;
  const beat = Date.parse(info.heartbeatAt || info.acquiredAt || '');
  if (!Number.isFinite(beat)) return true;
  return Date.now() - beat > STALE_MS;
}

function writeLockFile(file, label) {
  const now = new Date().toISOString();
  const payload = { pid: process.pid, host, label, acquiredAt: now, heartbeatAt: now };
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(payload));
  } finally {
    fs.closeSync(fd);
  }
  return payload;
}

function beat(file) {
  const info = readLock(file);
  if (!info || info.pid !== process.pid || info.host !== host) return;
  info.heartbeatAt = new Date().toISOString();
  try {
    fs.writeFileSync(file, JSON.stringify(info));
  } catch {
    // Heartbeat lỗi tạm thời không đáng để làm chết job đang chạy.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Khoá độc quyền Word COM giữa nhiều process (server realtime + backfill).
 * Re-entrant trong cùng process: các lần acquire lồng nhau chỉ tăng bộ đếm.
 */
async function acquire(label = 'word', timeoutMs = ACQUIRE_TIMEOUT_MS) {
  if (held) {
    held.depth += 1;
    return () => release();
  }

  const file = lockPath();
  const deadline = Date.now() + timeoutMs;
  let warned = false;

  for (;;) {
    try {
      writeLockFile(file, label);
      const timer = setInterval(() => beat(file), HEARTBEAT_MS);
      timer.unref();
      held = { file, depth: 1, timer };
      return () => release();
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }

    const info = readLock(file);
    if (!info || (!isAlive(info) || isStale(info))) {
      logger.job('warn', 'word com lock stale, reclaiming', {
        owner: info ? { pid: info.pid, host: info.host, label: info.label, heartbeatAt: info.heartbeatAt } : null,
      });
      try {
        fs.unlinkSync(file);
      } catch {
        // Process khác vừa dọn trước, cứ thử lại vòng sau.
      }
      continue;
    }

    if (!warned) {
      warned = true;
      logger.job('info', 'waiting for word com lock', { label, owner: { pid: info.pid, label: info.label } });
    }
    if (Date.now() > deadline) {
      throw new Error(`Timeout waiting for Word COM lock held by pid ${info.pid} (${info.label})`);
    }
    await sleep(POLL_MS);
  }
}

function release() {
  if (!held) return;
  held.depth -= 1;
  if (held.depth > 0) return;
  clearInterval(held.timer);
  const info = readLock(held.file);
  if (info && info.pid === process.pid && info.host === host) {
    try {
      fs.unlinkSync(held.file);
    } catch {
      // Đã bị dọn rồi thì thôi.
    }
  }
  held = null;
}

function releaseOnExit() {
  if (!held) return;
  held.depth = 1;
  release();
}

process.on('exit', releaseOnExit);
process.on('SIGINT', releaseOnExit);
process.on('SIGTERM', releaseOnExit);

module.exports = { acquire, release, lockPath };
