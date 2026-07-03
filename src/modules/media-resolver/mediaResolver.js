const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const logger = require('../logging/logger');

const IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const PROBE_EXTENSIONS = ['', '.zip', '.ZIP', '.pdf', '.PDF', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.bmp', '.BMP'];

function cleanFileName(name) {
  return String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function fileExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function buildCandidates(fileName) {
  const clean = String(fileName || '').trim();
  if (!clean) return [];
  if (path.isAbsolute(clean) || /^\\\\/.test(clean)) return [clean];

  const names = path.extname(clean) ? [clean] : PROBE_EXTENSIONS.map((ext) => `${clean}${ext}`);
  const roots = [
    config.paths.sourceImageDir,
    config.paths.fallbackImageDir,
    config.paths.localImageDir,
  ].filter(Boolean);

  const candidates = [];
  for (const root of roots) {
    for (const name of names) {
      candidates.push(path.join(root, name));
    }
  }
  return candidates;
}

async function copyToCache(sourcePath, subDir = 'media') {
  ensureDir(config.paths.localImageDir);
  const cacheDir = path.join(config.paths.localImageDir, subDir);
  ensureDir(cacheDir);

  const base = cleanFileName(path.basename(sourcePath));
  const target = path.join(cacheDir, base);
  if (path.resolve(sourcePath) === path.resolve(target)) return target;
  if (!fileExists(target)) {
    await fs.promises.copyFile(sourcePath, target);
  }
  return target;
}

async function resolveFile(fileName, options = {}) {
  const candidates = buildCandidates(fileName);
  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      const cachedPath = await copyToCache(candidate, options.subDir || 'media');
      logger.job('info', 'media resolved', { fileName, sourcePath: candidate, cachedPath });
      return { found: true, sourcePath: candidate, cachedPath };
    }
  }

  logger.job('warn', 'media missing', { fileName, candidates: candidates.slice(0, 8) });
  return { found: false, fileName, candidates };
}

function setZipPassword(zip, password) {
  if (!password) return;
  if (typeof zip.setPassword === 'function') zip.setPassword(password);
}

async function extractZip(zipPath, outputSubDir = 'zip') {
  const outputDir = path.join(config.paths.tmpDir, 'extract', outputSubDir, path.basename(zipPath, path.extname(zipPath)));
  ensureDir(outputDir);

  const passwords = ['', ...config.archives.passwords];
  let lastError = null;
  for (const password of passwords) {
    try {
      const zip = new AdmZip(zipPath);
      setZipPassword(zip, password);
      const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
      for (const entry of entries) {
        const target = path.join(outputDir, cleanFileName(entry.entryName));
        ensureDir(path.dirname(target));
        fs.writeFileSync(target, entry.getData());
      }
      const files = await listFiles(outputDir);
      logger.job('info', 'zip extracted', { zipPath, outputDir, fileCount: files.length, usedPassword: Boolean(password) });
      return { ok: true, outputDir, files, usedPassword: Boolean(password) };
    } catch (err) {
      lastError = err;
      const msg = String(err && err.message ? err.message : err);
      if (/aes|encrypted|bad password|invalid password|wrong password/i.test(msg)) {
        logger.job('warn', 'zip password attempt failed', { zipPath, usedPassword: Boolean(password), error: msg });
      }
    }
  }

  const message = lastError && lastError.message ? lastError.message : 'Cannot extract zip';
  logger.job('error', 'zip extract failed', {
    zipPath,
    error: message,
    note: /aes/i.test(message) ? 'ZIP AES may require another extractor in Phase 2' : undefined,
  });
  return { ok: false, error: message };
}

async function listFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(full));
    else result.push(full);
  }
  return result;
}

async function resolveCnFile(cnFile) {
  const resolved = await resolveFile(cnFile.fileName, { subDir: 'cn-files' });
  if (!resolved.found) return { ...resolved, cnFile };

  const ext = path.extname(resolved.cachedPath).toLowerCase();
  if (ext === '.zip') {
    const extracted = await extractZip(resolved.cachedPath, `cn-file-${cnFile.id || 'unknown'}`);
    return { ...resolved, cnFile, extracted };
  }
  return { ...resolved, cnFile };
}

async function resolveCaseMedia(caseData) {
  const cnFiles = [];
  for (const item of caseData.cnFiles || []) {
    if (item.fileName) cnFiles.push(await resolveCnFile(item));
  }
  return {
    cnFiles,
    foundCount: cnFiles.filter((r) => r.found).length,
    missingCount: cnFiles.filter((r) => !r.found).length,
  };
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

module.exports = {
  buildCandidates,
  resolveFile,
  resolveCnFile,
  resolveCaseMedia,
  extractZip,
  listFiles,
  isImageFile,
};
