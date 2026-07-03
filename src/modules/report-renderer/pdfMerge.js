const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const PDF_EXTENSIONS = new Set(['.pdf']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function isPdfFile(filePath) {
  return PDF_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

function isEmbeddableImage(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

async function addPdfFile(merged, file) {
  const src = await PDFDocument.load(await fs.promises.readFile(file));
  const pages = await merged.copyPages(src, src.getPageIndices());
  for (const page of pages) merged.addPage(page);
}

async function addImageFile(merged, file) {
  const bytes = await fs.promises.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const image = ext === '.png'
    ? await merged.embedPng(bytes)
    : await merged.embedJpg(bytes);
  const page = merged.addPage([595.28, 841.89]);
  const margin = 32;
  const maxW = page.getWidth() - margin * 2;
  const maxH = page.getHeight() - margin * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (page.getWidth() - width) / 2,
    y: (page.getHeight() - height) / 2,
    width,
    height,
  });
}

async function mergeFilesToPdf(inputFiles, outputPath, options = {}) {
  const merged = await PDFDocument.create();
  const skipped = [];
  for (const file of inputFiles) {
    try {
      if (!file || !fs.existsSync(file)) {
        skipped.push({ file, reason: 'missing' });
      } else if (isPdfFile(file)) {
        await addPdfFile(merged, file);
      } else if (isEmbeddableImage(file)) {
        await addImageFile(merged, file);
      } else {
        skipped.push({ file, reason: 'unsupported_type' });
      }
    } catch (err) {
      skipped.push({ file, reason: 'merge_failed', error: err.message });
    }
  }
  if (merged.getPageCount() === 0) {
    throw new Error('No mergeable PDF/image files');
  }
  await fs.promises.writeFile(outputPath, await merged.save());
  return options.withDetails ? { outputPath, skipped } : outputPath;
}

async function mergePdfFiles(inputFiles, outputPath) {
  return mergeFilesToPdf(inputFiles, outputPath);
}

module.exports = {
  mergePdfFiles,
  mergeFilesToPdf,
  isPdfFile,
  isEmbeddableImage,
};
