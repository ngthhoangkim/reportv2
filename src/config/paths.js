const fs = require('fs');
const path = require('path');
const { config } = require('./env');

const TMP_RENDER_SUBDIRS = ['cdha-items', 'cdha-render'];
const TMP_STALE_MS = 2 * 60 * 60 * 1000; // 2 giờ

function ensureDir(dir) {
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureAppDirs() {
  [
    config.paths.localImageDir,
    config.paths.output,
    config.paths.stateDir,
    config.paths.logsDir,
    config.paths.tmpDir,
  ].forEach(ensureDir);
}

async function cleanupStaleRenderDirs(maxAgeMs = TMP_STALE_MS) {
  for (const sub of TMP_RENDER_SUBDIRS) {
    const parent = path.join(config.paths.tmpDir, sub);
    if (!fs.existsSync(parent)) continue;
    let entries;
    try {
      entries = await fs.promises.readdir(parent);
    } catch {
      continue;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of entries) {
      const fullPath = path.join(parent, entry);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) {
          await fs.promises.rm(fullPath, { recursive: true, force: true });
          console.log('[paths] stale render dir removed', fullPath);
        }
      } catch (err) {
        console.warn('[paths] stale render dir cleanup failed', fullPath, err.message);
      }
    }
  }
}

// Xóa toàn bộ khi startup — mọi thư mục còn sót là rác từ lần chạy trước
async function cleanupRenderDirsOnStartup() {
  for (const sub of TMP_RENDER_SUBDIRS) {
    const parent = path.join(config.paths.tmpDir, sub);
    if (!fs.existsSync(parent)) continue;
    let entries;
    try {
      entries = await fs.promises.readdir(parent);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(parent, entry);
      try {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        console.log('[paths] startup render dir removed', fullPath);
      } catch (err) {
        console.warn('[paths] startup render dir cleanup failed', fullPath, err.message);
      }
    }
  }
}

module.exports = { ensureDir, ensureAppDirs, cleanupRenderDirsOnStartup, cleanupStaleRenderDirs };
