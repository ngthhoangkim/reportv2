const fs = require('fs');
const path = require('path');
const { config } = require('./env');

const TMP_RENDER_SUBDIRS = ['cdha-items', 'cdha-render'];
const TMP_STALE_MS = 2 * 60 * 60 * 1000; // 2 giờ
const OUTPUT_STALE_MS = 2 * 60 * 60 * 1000; // 2 giờ

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
}

module.exports = { ensureDir, ensureAppDirs, cleanupRenderDirsOnStartup, cleanupStaleRenderDirs, cleanupOutputByDateRange };
