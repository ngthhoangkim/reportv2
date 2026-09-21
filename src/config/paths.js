const fs = require('fs');
const path = require('path');
const { config } = require('./env');

const TMP_RENDER_SUBDIRS = ['cdha-items', 'cdha-render'];
const TMP_STALE_MS = 2 * 60 * 60 * 1000; // 2 giờ
const OUTPUT_STALE_MS = 2 * 60 * 60 * 1000; // 2 giờ
// File log theo ngày của app: app/worker/job/backfill/upload/error-YYYY-MM-DD.jsonl.
// Chỉ đụng đúng các file này — KHÔNG đụng pm2-*.log (PM2 đang lock) và state.
const LOG_FILE_RE = /^(app|worker|job|backfill|upload|error)-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 14;

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
  await cleanupStaleOutputFiles(maxAgeMs);
  await cleanupOldLogFiles();
}

// Duyệt đệ quy mọi file trong output (kể cả subfolder như prescriptions/),
// xóa file nào predicate trả về true. Trả về { removed, errors }.
async function removeOutputFilesWhere(predicate) {
  const outputDir = config.paths.output;
  if (!fs.existsSync(outputDir)) return { removed: 0, errors: 0 };
  let removed = 0;
  let errors = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.promises.stat(fullPath);
          if (predicate(stat)) {
            await fs.promises.rm(fullPath, { force: true });
            removed++;
          }
        }
      } catch (err) {
        console.warn('[paths] output file cleanup failed', fullPath, err.message);
        errors++;
      }
    }
  }
  await walk(outputDir);
  return { removed, errors };
}

async function cleanupStaleOutputFiles(maxAgeMs = OUTPUT_STALE_MS) {
  const cutoff = Date.now() - maxAgeMs;
  const { removed } = await removeOutputFilesWhere((stat) => stat.mtimeMs < cutoff);
  if (removed > 0) console.log(`[paths] stale output files removed: ${removed}`);
}

async function cleanupOutputByDateRange(from, to) {
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs = to ? new Date(to).getTime() : Date.now();
  if (isNaN(fromMs) || isNaN(toMs)) throw new Error('Invalid date range');
  const result = await removeOutputFilesWhere(
    (stat) => stat.mtimeMs >= fromMs && stat.mtimeMs <= toMs,
  );
  console.log(`[paths] output cleanup by date range [${from} → ${to}]: removed=${result.removed} errors=${result.errors}`);
  return result;
}

// Xóa file log ngày cũ hơn maxAgeDays (theo ngày trong tên file). Không đụng pm2-*.log.
async function cleanupOldLogFiles(maxAgeDays = LOG_RETENTION_DAYS) {
  const logsDir = config.paths.logsDir;
  if (!fs.existsSync(logsDir)) return { removed: 0, errors: 0 };
  let entries;
  try {
    entries = await fs.promises.readdir(logsDir);
  } catch {
    return { removed: 0, errors: 0 };
  }
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  let errors = 0;
  for (const entry of entries) {
    const m = LOG_FILE_RE.exec(entry);
    if (!m) continue;
    const fileDate = new Date(`${m[2]}-${m[3]}-${m[4]}T00:00:00.000Z`).getTime();
    if (isNaN(fileDate) || fileDate >= cutoff) continue;
    const fullPath = path.join(logsDir, entry);
    try {
      await fs.promises.rm(fullPath, { force: true });
      removed++;
    } catch (err) {
      console.warn('[paths] old log cleanup failed', fullPath, err.message);
      errors++;
    }
  }
  if (removed > 0) console.log(`[paths] old log files removed: ${removed} (retention ${maxAgeDays}d)`);
  return { removed, errors };
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
  await cleanupStaleOutputFiles();
  await cleanupOldLogFiles();
}

module.exports = { ensureDir, ensureAppDirs, cleanupRenderDirsOnStartup, cleanupStaleRenderDirs, cleanupOutputByDateRange, cleanupOldLogFiles };
