const path = require('path');
const fs = require('fs');
const { collectCase } = require('../case-collector/collector');
const { resolveCaseMedia } = require('../media-resolver/mediaResolver');
const { uploadPdf } = require('../uploader/uploader');
const state = require('../state/stateStore');
const logger = require('../logging/logger');
const { ensureDir } = require('../../config/paths');
const { config } = require('../../config/env');
const { drawSummaryPdf } = require('./pdfSummary');
const { renderTemplateToPdf, buildTemplateData } = require('./docxTemplate');
const { resolveCdhaPdfFileName } = require('./outputNaming');
const { renderCdhaTemplatePdf } = require('./cdhaTemplateRenderer');

function snapshotKey(fileNum, sessionId) {
  return `${String(fileNum).trim()}::${sessionId == null || sessionId === '' ? 'all' : Number(sessionId)}`;
}

function shouldSkipByHash(key, sourceHash, force) {
  if (force) return false;
  const snapshots = state.getSnapshots();
  return snapshots[key] && snapshots[key].sourceHash === sourceHash && snapshots[key].status === 'generated';
}

async function generateReport(options) {
  const fileNum = String(options.fileNum || '').trim();
  const sessionId = options.sessionId == null || options.sessionId === '' ? null : Number(options.sessionId);
  if (!fileNum) throw new Error('fileNum is required');

  const key = snapshotKey(fileNum, sessionId);
  const startedAt = new Date().toISOString();
  logger.job('info', 'generate started', { fileNum, sessionId, force: Boolean(options.force), upload: Boolean(options.upload) });

  const caseData = await collectCase({ fileNum, sessionId });
  if (shouldSkipByHash(key, caseData.sourceHash, options.force)) {
    logger.job('info', 'generate skipped because source hash is unchanged', { fileNum, sessionId, sourceHash: caseData.sourceHash });
    return { skipped: true, reason: 'source_hash_unchanged', fileNum, sessionId, sourceHash: caseData.sourceHash };
  }

  const mediaSummary = await resolveCaseMedia(caseData);
  ensureDir(config.paths.output);
  const finalName = resolveCdhaPdfFileName(caseData, options.resultFileName);
  const pdfPath = path.join(config.paths.output, finalName);
  const templateData = buildTemplateData(caseData, mediaSummary);
  const cdhaRendered = await renderCdhaTemplatePdf({
    fileNum,
    sessionId,
    outputPath: pdfPath,
    caseData,
    mediaSummary,
  });
  const rendered = cdhaRendered.ok
    ? cdhaRendered
    : await renderTemplateToPdf('full-report', templateData, pdfPath);
  if (!rendered) {
    await drawSummaryPdf(pdfPath, caseData, mediaSummary);
  }

  const stat = fs.statSync(pdfPath);
  const job = {
    fileNum,
    sessionId,
    sourceHash: caseData.sourceHash,
    pdfPath,
    fileName: finalName,
    resultFileName: finalName.replace(/\.pdf$/i, ''),
    bytes: stat.size,
    media: mediaSummary,
    renderer: cdhaRendered.ok ? 'cdha-template-word-com' : (rendered ? 'docx-template-word-com' : 'summary-pdf'),
    renderDetails: cdhaRendered.ok ? cdhaRendered : undefined,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  state.appendJsonl('generated-files.jsonl', job);
  state.setSnapshot(key, { status: 'generated', sourceHash: caseData.sourceHash, pdfPath, sourceSnapshot: caseData.sourceSnapshot });
  logger.job('info', 'generate completed', { fileNum, sessionId, pdfPath, bytes: stat.size });

  let uploadResult = null;
  if (options.upload) {
    uploadResult = await uploadPdf(pdfPath);
  }
  return { ok: true, ...job, upload: uploadResult };
}

async function generateReportSafe(options) {
  try {
    return await generateReport(options);
  } catch (err) {
    const failed = {
      fileNum: options.fileNum,
      sessionId: options.sessionId == null ? null : Number(options.sessionId),
      error: err.message,
      stack: err.stack,
    };
    state.appendJsonl('failed-jobs.jsonl', failed);
    logger.job('error', 'generate failed', failed);
    return { ok: false, ...failed };
  }
}

module.exports = {
  generateReport,
  generateReportSafe,
  snapshotKey,
};
