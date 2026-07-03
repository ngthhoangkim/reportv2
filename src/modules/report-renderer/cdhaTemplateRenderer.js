const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const logger = require('../logging/logger');
const { collectImagingRenderRecords, collectPathologyImages } = require('../case-collector/collector');
const {
  resolveFile,
  extractZip,
  listFiles,
  readMagic,
  isZipMagic,
  isJpegMagic,
  isPngMagic,
} = require('../media-resolver/mediaResolver');
const { convertDocToDocxCached, convertDocxToPdf } = require('../word-converter/wordConverter');
const { rtfBufferToPlain } = require('./rtfPlain');
const { selectTemplate } = require('./templateSelector');
const { mergeFilesToPdf, isPdfFile, isEmbeddableImage } = require('./pdfMerge');
const { resolveCdhaRecordPdfFileName } = require('./outputNaming');

function str(value) {
  if (value == null) return '';
  try {
    return String(value).normalize('NFC');
  } catch {
    return String(value);
  }
}

function formatDateVN(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function calcAge(dob, atDate) {
  if (!dob) return '';
  const birth = new Date(dob);
  const at = atDate ? new Date(atDate) : new Date();
  if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) return '';
  let age = at.getFullYear() - birth.getFullYear();
  const m = at.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birth.getDate())) age -= 1;
  return age > 0 && age < 130 ? String(age) : '';
}

function cleanReportField(value) {
  return str(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{5,}/g, '\n\n\n\n')
    .trim();
}

function buildPayload(record) {
  const result = rtfBufferToPlain(record.resultData);
  const conclusion = rtfBufferToPlain(record.conclusionData);
  const suggestion = rtfBufferToPlain(record.suggestionData);
  const age = calcAge(record.dob, record.ngayKham);
  const payload = {
    FileNm: str(record.fileNum || record.itemNum),
    PatientName: str(record.patientName),
    Age: age ? ` ${age}` : '',
    Gender: str(record.gender),
    Diagnosis: cleanReportField(record.conclusion),
    ReferDoctor: str(record.requestedDoctor),
    Doctor: str(record.doctor),
    ItemNum: str(record.itemNum),
    SampleNumber: str(record.sampleNumber || record.itemNum),
    Address: str(record.address),
    PathologyName: '',
    CDNS: '',
    DateRpt: formatDateVN(record.ngayKham),
    Result: cleanReportField(result),
    Conclusion: cleanReportField(conclusion),
    Suggestion: cleanReportField(suggestion),
    SessionId: str(record.sessionId),
    FileNum: str(record.fileNum),
    PacsViewURL: '',
    PacsFileResultURL: '',
    PacsAccessCode: '',
  };
  for (let i = 1; i <= 200; i += 1) payload[`Image${i}`] = '';
  return new Proxy(payload, {
    get(target, prop) {
      if (typeof prop === 'string' && !(prop in target)) return '';
      return target[prop];
    },
  });
}

async function normalizeTemplate(templatePath) {
  if (path.extname(templatePath).toLowerCase() === '.doc') {
    return convertDocToDocxCached(templatePath);
  }
  return templatePath;
}

async function renderRecordDocx(record, templatePath, segmentIndex, workDir) {
  const templateDocx = await normalizeTemplate(templatePath);
  const zip = new PizZip(await fs.promises.readFile(templateDocx, 'binary'));
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '<<', end: '>>' },
    linebreaks: true,
    paragraphLoop: true,
    nullGetter: () => '',
  });
  doc.render(buildPayload(record));
  const out = path.join(workDir, `cdha_${record.imagingResultId}_${segmentIndex}.docx`);
  await fs.promises.writeFile(out, doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return out;
}

async function renderRecordPdfSegment(record, segmentIndex, workDir) {
  const templatePath = selectTemplate(config.paths.templates, record.templateFile, record.pathologyType, 0);
  if (!templatePath) {
    return {
      ok: false,
      skipped: {
        imagingResultId: record.imagingResultId,
        reason: 'template_missing',
        templateFile: record.templateFile,
      },
    };
  }

  logger.job('info', 'cdha render item started', {
    imagingResultId: record.imagingResultId,
    fileName: record.fileName,
    serviceName: record.serviceName,
    templatePath,
  });

  const docxPath = await renderRecordDocx(record, templatePath, segmentIndex, workDir);
  const pdfPath = path.join(workDir, `cdha_${record.imagingResultId}_${segmentIndex}.pdf`);
  await convertDocxToPdf(docxPath, pdfPath);
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Word did not create PDF: ${pdfPath}`);
  }

  const images = await resolveRecordImages(record);
  return {
    ok: true,
    pdfPath,
    imageFiles: images.files,
    imageStats: {
      imagingResultId: record.imagingResultId,
      appendedImages: images.files.length,
      missingImages: images.missing,
    },
    templatePath,
  };
}

async function resolveRecordImages(record) {
  const rows = await collectPathologyImages(record.imagingResultId, config.media.printedImagesOnly);
  const archiveFiles = await resolveRecordArchiveFiles(record);
  const resolved = [];
  const missing = [];
  for (const row of rows) {
    const fromArchive = findImageInFiles(row.filename, archiveFiles);
    if (fromArchive) {
      resolved.push(fromArchive);
      continue;
    }

    const item = await resolveFile(row.filename, { subDir: 'pathology-images', preferImages: true });
    if (item.found && (isEmbeddableImage(item.cachedPath) || isPdfFile(item.cachedPath))) {
      resolved.push(item.cachedPath);
    } else if (item.found) {
      missing.push({ filename: row.filename, reason: 'unsupported_image_type', cachedPath: item.cachedPath });
    } else {
      missing.push({ filename: row.filename, reason: 'missing' });
    }
  }
  logger.job('info', 'cdha images resolved', {
    imagingResultId: record.imagingResultId,
    fileName: record.fileName,
    wantedImages: rows.length,
    archiveFiles: archiveFiles.length,
    resolvedImages: resolved.length,
    missingImages: missing.length,
  });
  return { files: resolved, missing };
}

async function resolveRecordArchiveFiles(record) {
  const files = [];
  if (!record.fileName || !String(record.fileName).trim()) return files;
  const archive = await resolveFile(record.fileName, { subDir: 'cdha-archives' });
  if (!archive.found) return files;

  const ext = path.extname(archive.cachedPath).toLowerCase();
  const magic = readMagic(archive.cachedPath);
  if (ext === '.zip' || isZipMagic(magic)) {
    const extracted = await extractZip(
      archive.cachedPath,
      `cdha-${record.imagingResultId || record.fileName}`,
    );
    if (extracted.ok) {
      files.push(...(extracted.files || []));
    }
    return files;
  }

  if (isEmbeddableImage(archive.cachedPath) || isPdfFile(archive.cachedPath)) {
    files.push(archive.cachedPath);
  } else if (isJpegMagic(magic) || isPngMagic(magic)) {
    const extFromMagic = isPngMagic(magic) ? '.png' : '.jpg';
    const target = path.join(
      config.paths.tmpDir,
      'raw-images',
      `${record.imagingResultId || record.fileName}${extFromMagic}`,
    );
    ensureDir(path.dirname(target));
    await fs.promises.copyFile(archive.cachedPath, target);
    files.push(target);
  } else if (fs.existsSync(archive.cachedPath) && fs.statSync(archive.cachedPath).isDirectory()) {
    files.push(...await listFiles(archive.cachedPath));
  }
  return files;
}

function fileStem(value) {
  return path.basename(String(value || '').trim()).replace(/\.[^.]+$/, '').toLowerCase();
}

function findImageInFiles(imageName, files) {
  const targetBase = path.basename(String(imageName || '').trim()).toLowerCase();
  const targetStem = fileStem(imageName);
  return (files || []).find((file) => {
    if (!isEmbeddableImage(file) && !isPdfFile(file)) return false;
    const base = path.basename(file).toLowerCase();
    return base === targetBase || fileStem(base) === targetStem;
  }) || null;
}

async function fetchPacsPdf(url, workDir, index) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.media.pacsFetchTimeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!contentType.includes('pdf') && buf.slice(0, 4).toString('latin1') !== '%PDF') {
      throw new Error(`Response is not PDF: ${contentType || 'unknown content-type'}`);
    }
    const out = path.join(workDir, `pacs_${index}.pdf`);
    await fs.promises.writeFile(out, buf);
    logger.job('info', 'pacs pdf fetched', { url, out, bytes: buf.length });
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function collectPacsFiles(caseData, workDir) {
  const files = [];
  const skipped = [];
  const seen = new Set();
  const rows = (caseData && caseData.imaging) || [];
  for (const row of rows) {
    const url = String(row.pacsFileResultUrl || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const file = await fetchPacsPdf(url, workDir, files.length);
      if (file) files.push(file);
    } catch (err) {
      const item = { requestId: row.requestId, url, error: err.message };
      skipped.push(item);
      logger.job('warn', 'pacs pdf fetch failed', item);
    }
  }
  return { files, skipped };
}

function cnFilesToMergeFiles(mediaSummary) {
  const files = [];
  const skipped = [];
  for (const item of (mediaSummary && mediaSummary.cnFiles) || []) {
    const candidates = [];
    if (item.extracted && item.extracted.ok) candidates.push(...(item.extracted.files || []));
    else if (item.cachedPath) candidates.push(item.cachedPath);

    for (const file of candidates) {
      if (isPdfFile(file) || isEmbeddableImage(file)) {
        files.push(file);
      } else {
        skipped.push({
          cnFileId: item.cnFile && item.cnFile.id,
          file,
          reason: 'unsupported_cn_file_type',
        });
      }
    }
  }
  return { files, skipped };
}

async function renderCdhaTemplatePdf({ fileNum, sessionId, outputPath, caseData = null, mediaSummary = null }) {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'word_com_requires_windows' };
  }
  if (!fs.existsSync(config.paths.templates)) {
    return { ok: false, reason: 'templates_dir_missing', templates: config.paths.templates };
  }

  const records = await collectImagingRenderRecords(fileNum, sessionId);
  const workDir = path.join(config.paths.tmpDir, 'cdha-render', `${fileNum}_${sessionId || 'all'}_${Date.now()}`);
  ensureDir(workDir);

  const mergeInputs = [];
  const skipped = [];
  const imageStats = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    try {
      const rendered = await renderRecordPdfSegment(record, i, workDir);
      if (!rendered.ok) {
        skipped.push(rendered.skipped);
        logger.job('warn', 'cdha template missing', rendered.skipped);
        continue;
      }
      mergeInputs.push(rendered.pdfPath, ...rendered.imageFiles);
      imageStats.push(rendered.imageStats);
      logger.job('info', 'cdha render segment completed', { imagingResultId: record.imagingResultId, pdfPath: rendered.pdfPath });
    } catch (err) {
      const item = {
        imagingResultId: record.imagingResultId,
        templateFile: record.templateFile,
        error: err.message,
      };
      skipped.push(item);
      logger.job('error', 'cdha render segment failed', item);
    }
  }

  const pacs = await collectPacsFiles(caseData, workDir);
  mergeInputs.push(...pacs.files);

  const cn = cnFilesToMergeFiles(mediaSummary);
  mergeInputs.push(...cn.files);

  if (!mergeInputs.length) {
    return { ok: false, reason: 'no_template_segments_rendered', skipped };
  }

  ensureDir(path.dirname(outputPath));
  const merge = await mergeFilesToPdf(mergeInputs, outputPath, { withDetails: true });
  return {
    ok: true,
    outputPath,
    segmentCount: records.length - skipped.length,
    appendedImagePages: imageStats.reduce((sum, item) => sum + item.appendedImages, 0),
    appendedPacsPdfs: pacs.files.length,
    appendedCnFiles: cn.files.length,
    skipped: skipped.concat(pacs.skipped, cn.skipped, merge.skipped || []),
    imageStats,
    workDir,
  };
}

async function renderCdhaItemPdfs({ fileNum, sessionId, outputDir }) {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'word_com_requires_windows', files: [], skipped: [] };
  }
  if (!fs.existsSync(config.paths.templates)) {
    return { ok: false, reason: 'templates_dir_missing', templates: config.paths.templates, files: [], skipped: [] };
  }

  const records = await collectImagingRenderRecords(fileNum, sessionId);
  const workDir = path.join(config.paths.tmpDir, 'cdha-items', `${fileNum}_${sessionId || 'all'}_${Date.now()}`);
  ensureDir(workDir);
  ensureDir(outputDir);

  const files = [];
  const skipped = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record.fileName || !String(record.fileName).trim()) {
      const item = {
        imagingResultId: record.imagingResultId,
        serviceName: record.serviceName,
        reason: 'missing_file_name',
      };
      skipped.push(item);
      logger.job('warn', 'cdha item skipped', item);
      continue;
    }

    const fileName = resolveCdhaRecordPdfFileName(record);
    const outputPath = path.join(outputDir, fileName);
    try {
      const rendered = await renderRecordPdfSegment(record, i, workDir);
      if (!rendered.ok) {
        skipped.push(rendered.skipped);
        logger.job('warn', 'cdha item skipped', rendered.skipped);
        continue;
      }

      const merge = await mergeFilesToPdf(
        [rendered.pdfPath, ...rendered.imageFiles],
        outputPath,
        { withDetails: true },
      );
      const stat = fs.statSync(outputPath);
      const out = {
        imagingResultId: record.imagingResultId,
        requestId: record.requestId,
        serviceName: record.serviceName,
        fileName,
        resultFileName: fileName.replace(/\.pdf$/i, ''),
        pdfPath: outputPath,
        bytes: stat.size,
        appendedImagePages: rendered.imageFiles.length,
        mergeSkipped: merge.skipped || [],
      };
      files.push(out);
      logger.job('info', 'cdha item completed', out);
    } catch (err) {
      const item = {
        imagingResultId: record.imagingResultId,
        fileName,
        serviceName: record.serviceName,
        error: err.message,
      };
      skipped.push(item);
      logger.job('error', 'cdha item failed', item);
    }
  }

  return {
    ok: files.length > 0,
    renderer: 'cdha-item-template-word-com',
    files,
    skipped,
    workDir,
  };
}

module.exports = {
  renderCdhaTemplatePdf,
  renderCdhaItemPdfs,
  buildPayload,
};
