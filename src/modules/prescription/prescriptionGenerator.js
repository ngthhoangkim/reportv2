const fs = require('fs');
const path = require('path');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const state = require('../state/stateStore');
const logger = require('../logging/logger');
const { uploadPdf } = require('../uploader/uploader');
const {
  normalizePrescriptionPrefix,
  resolvePrescriptionUploadName,
} = require('../report-renderer/outputNaming');
const { collectPrescriptionData } = require('./prescriptionCollector');
const { renderPrescriptionPdf } = require('./prescriptionRenderer');

function prescriptionS3Prefix() {
  return config.prescription.s3Prefix || normalizePrescriptionPrefix();
}

function s3KeyForProgress(progressId) {
  return `${prescriptionS3Prefix().replace(/\/?$/, '/')}${resolvePrescriptionUploadName(progressId)}`;
}

async function generatePrescriptions(options) {
  const fileNum = String(options.fileNum || '').trim();
  if (!fileNum) throw new Error('fileNum is required');
  const sessionId = options.sessionId == null || options.sessionId === '' ? null : Number(options.sessionId);
  const progressId = options.progressId == null || options.progressId === '' ? null : Number(options.progressId);
  const prescriptions = await collectPrescriptionData({ fileNum, sessionId, progressId });
  ensureDir(config.prescription.outputDir);

  const files = [];
  for (const item of prescriptions) {
    const fileName = resolvePrescriptionUploadName(item.progressId);
    const pdfPath = path.join(config.prescription.outputDir, fileName);
    if (!options.force && fs.existsSync(pdfPath)) {
      logger.job('info', 'prescription pdf exists, skipping render', { progressId: item.progressId, pdfPath });
    } else {
      await renderPrescriptionPdf(item, pdfPath);
    }
    let uploadResult = null;
    if (options.upload) {
      uploadResult = await uploadPdf(pdfPath, { prefix: prescriptionS3Prefix() });
    }
    files.push({
      progressId: item.progressId,
      sessionId: item.sessionId,
      fileNum: item.fileNum,
      fileName,
      pdfPath,
      s3Key: s3KeyForProgress(item.progressId),
      upload: uploadResult,
    });
  }
  return { ok: true, count: files.length, files };
}

async function generatePrescriptionsSafe(options) {
  try {
    return await generatePrescriptions(options);
  } catch (err) {
    const failed = {
      type: 'prescription',
      fileNum: options.fileNum,
      sessionId: options.sessionId == null ? null : Number(options.sessionId),
      progressId: options.progressId == null ? null : Number(options.progressId),
      error: err.message,
      stack: err.stack,
    };
    state.appendJsonl('failed-jobs.jsonl', failed);
    logger.job('error', 'prescription generation failed', failed);
    return { ok: false, error: err.message, ...failed };
  }
}

module.exports = {
  generatePrescriptions,
  generatePrescriptionsSafe,
  prescriptionS3Prefix,
  s3KeyForProgress,
};
