const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const logger = require('../logging/logger');

const IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const V1_EXTRACT_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff']);
const PROBE_EXTENSIONS = ['', '.zip', '.ZIP', '.pdf', '.PDF', '.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG', '.bmp', '.BMP'];
const IMAGE_PROBE_EXTENSIONS = [
  '',
  '.jpg',
  '.jpeg',
  '.JPG',
  '.JPEG',
  '.png',
  '.PNG',
  '.bmp',
  '.BMP',
  '.webp',
  '.WEBP',
  '.gif',
  '.GIF',
  '.tif',
  '.tiff',
  '.TIF',
  '.TIFF',
  '.zip',
  '.ZIP',
];

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

function readMagic(filePath, len = 16) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, 0);
      return buf.slice(0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return Buffer.alloc(0);
  }
}

function isZipMagic(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function isJpegMagic(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isPngMagic(buf) {
  return buf.length >= 8
    && buf[0] === 0x89
    && buf[1] === 0x50
    && buf[2] === 0x4e
    && buf[3] === 0x47;
}

function buildCandidates(fileName, options = {}) {
  const clean = String(fileName || '').trim();
  if (!clean) return [];
  if (path.isAbsolute(clean) || /^\\\\/.test(clean)) return [clean];

  const probes = options.preferImages ? IMAGE_PROBE_EXTENSIONS : PROBE_EXTENSIONS;
  const names = path.extname(clean) ? [clean] : probes.map((ext) => `${clean}${ext}`);
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
  const candidates = buildCandidates(fileName, options);
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

async function extractZip(zipPath, outputSubDir = 'zip') {
  const outputDir = path.join(config.paths.tmpDir, 'extract', outputSubDir, path.basename(zipPath, path.extname(zipPath)));
  ensureDir(outputDir);

  const passwords = ['', ...config.archives.passwords];
  let lastError = null;
  for (const password of passwords) {
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
      for (const entry of entries) {
        const target = path.join(outputDir, cleanFileName(entry.entryName));
        ensureDir(path.dirname(target));
        fs.writeFileSync(target, entry.getData(password));
      }
      const files = await listFiles(outputDir);
      logger.job('info', 'zip extracted', { zipPath, outputDir, fileCount: files.length, usedPassword: Boolean(password) });
      return { ok: true, outputDir, files, usedPassword: Boolean(password) };
    } catch (err) {
      lastError = err;
      const msg = String(err && err.message ? err.message : err);
      if (password && /aes|encrypted|bad password|invalid password|wrong password/i.test(msg)) {
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

async function extractImagesFromZipV1(zipPath, extractToDirectory, passwords = config.archives.passwords) {
  ensureDir(extractToDirectory);
  const passList = ['', ...(passwords || [])];
  let lastError = null;
  for (const password of passList) {
    try {
      const zip = new AdmZip(zipPath);
      const extractedFiles = [];
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const nameOnly = path.basename(entry.entryName);
        const ext = path.extname(nameOnly).toLowerCase();
        if (!V1_EXTRACT_IMAGE_EXTENSIONS.has(ext)) continue;
        const destinationPath = path.join(extractToDirectory, cleanFileName(nameOnly));
        const data = password ? entry.getData(password) : entry.getData();
        fs.writeFileSync(destinationPath, data);
        extractedFiles.push(destinationPath);
      }
      logger.job('info', 'zip images extracted v1-style', {
        zipPath,
        outputDir: extractToDirectory,
        fileCount: extractedFiles.length,
        usedPassword: Boolean(password),
      });
      return { ok: true, outputDir: extractToDirectory, files: extractedFiles, usedPassword: Boolean(password) };
    } catch (err) {
      lastError = err;
      const msg = String(err && err.message ? err.message : err);
      if (password && /aes|encrypted|bad password|invalid password|wrong password/i.test(msg)) {
        logger.job('warn', 'zip image password attempt failed', { zipPath, usedPassword: Boolean(password), error: msg });
      }
    }
  }

  const message = lastError && lastError.message ? lastError.message : 'Cannot extract zip images';
  logger.job('error', 'zip image extract failed', { zipPath, error: message });
  return { ok: false, outputDir: extractToDirectory, files: [], error: message };
}

async function extractImagesFromArchiveOrRawV1(filePath, extractToDirectory, passwords = config.archives.passwords) {
  if (!fileExists(filePath)) {
    throw new Error(`Media file not found: ${filePath}`);
  }
  ensureDir(extractToDirectory);
  const magic = readMagic(filePath, 16);
  if (magic.length && magic.every((b) => b === 0)) {
    throw new Error('File is all zeros (invalid). Replace with real ZIP or JPEG/PNG export.');
  }
  if (isZipMagic(magic)) {
    return extractImagesFromZipV1(filePath, extractToDirectory, passwords);
  }
  if (isJpegMagic(magic) || isPngMagic(magic)) {
    const base = path.basename(filePath);
    let ext = path.extname(base).toLowerCase();
    if (!ext) ext = isPngMagic(magic) ? '.png' : '.jpg';
    const destName = path.extname(base) ? base : `${base}${ext}`;
    const dest = path.join(extractToDirectory, cleanFileName(destName));
    fs.copyFileSync(filePath, dest);
    return { ok: true, outputDir: extractToDirectory, files: [dest], usedPassword: false };
  }
  throw new Error(`Unsupported media (need ZIP or JPEG/PNG): ${filePath}`);
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
  extractImagesFromZipV1,
  extractImagesFromArchiveOrRawV1,
  listFiles,
  isImageFile,
  readMagic,
  isZipMagic,
  isJpegMagic,
  isPngMagic,
};
