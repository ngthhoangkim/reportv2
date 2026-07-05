const fs = require('fs');
const path = require('path');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const logger = require('../logging/logger');
const { resolveFile, extractImagesFromArchiveOrRawV1, extractZip } = require('../media-resolver/mediaResolver');
const { mergeFilesToPdf, isPdfFile, isEmbeddableImage } = require('./pdfMerge');
const { resolveCnFilePdfFileName } = require('./outputNaming');

function isCurrentSessionFile(cnFile, sessionId) {
  if (sessionId == null) return true;
  return cnFile.sessionId != null && Number(cnFile.sessionId) === Number(sessionId);
}

function shouldRenderCnFile(cnFile, sessionId, options = {}) {
  if (options.includeHistory) return true;
  return isCurrentSessionFile(cnFile, sessionId);
}

async function extractMergeableFiles(localPath, workDir, cnFileId) {
  const ext = path.extname(localPath).toLowerCase();
  if (ext === '.pdf' || isEmbeddableImage(localPath)) {
    return [localPath];
  }

  const extractDir = path.join(workDir, `cn_file_${cnFileId || path.basename(localPath)}`);
  if (ext === '.zip') {
    const all = await extractZip(localPath, `cn-file-render-${cnFileId || path.basename(localPath)}`);
    return (all.files || []).filter((file) => isPdfFile(file) || isEmbeddableImage(file));
  }

  try {
    const extracted = await extractImagesFromArchiveOrRawV1(localPath, extractDir);
    return (extracted.files || []).filter((file) => isPdfFile(file) || isEmbeddableImage(file));
  } catch (err) {
    logger.job('warn', 'cn_file unsupported media', { localPath, cnFileId, error: err.message });
    return [];
  }
}

async function renderCnFiles({ caseData, outputDir, includeHistory = config.media.includeCnFilesHistory }) {
  ensureDir(outputDir);
  const workDir = path.join(config.paths.tmpDir, 'cn-files-render', `${caseData.fileNum}_${caseData.sessionId || 'all'}_${Date.now()}`);
  ensureDir(workDir);

  const files = [];
  const skipped = [];
  for (const cnFile of caseData.cnFiles || []) {
    if (!cnFile.fileName) continue;
    if (!shouldRenderCnFile(cnFile, caseData.sessionId, { includeHistory })) {
      skipped.push({ cnFileId: cnFile.id, fileName: cnFile.fileName, reason: 'history_skipped' });
      continue;
    }

    const outputName = resolveCnFilePdfFileName(cnFile.fileName);
    const outputPath = path.join(outputDir, outputName);
    try {
      const resolved = await resolveFile(cnFile.fileName, { subDir: 'cn-files' });
      if (!resolved.found) {
        skipped.push({ cnFileId: cnFile.id, fileName: cnFile.fileName, reason: 'media_missing' });
        continue;
      }
      const mergeable = await extractMergeableFiles(resolved.cachedPath, workDir, cnFile.id);
      if (!mergeable.length) {
        skipped.push({ cnFileId: cnFile.id, fileName: cnFile.fileName, reason: 'no_mergeable_files' });
        continue;
      }

      const merge = await mergeFilesToPdf(mergeable, outputPath, { withDetails: true });
      const stat = fs.statSync(outputPath);
      const item = {
        cnFileId: cnFile.id,
        docTitle: cnFile.docTitle,
        sourceFileName: cnFile.fileName,
        fileName: outputName,
        resultFileName: outputName.replace(/\.pdf$/i, ''),
        pdfPath: outputPath,
        bytes: stat.size,
        pageSources: mergeable.length,
        mergeSkipped: merge.skipped || [],
      };
      files.push(item);
      logger.job('info', 'cn_file completed', item);
    } catch (err) {
      const item = {
        cnFileId: cnFile.id,
        fileName: cnFile.fileName,
        outputName,
        error: err.message,
      };
      skipped.push(item);
      logger.job('error', 'cn_file failed', item);
    }
  }

  return {
    ok: files.length > 0,
    renderer: 'cn-files-basename-pdf',
    files,
    skipped,
    workDir,
  };
}

module.exports = {
  renderCnFiles,
  resolveCnFilePdfFileName,
};
