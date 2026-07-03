const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const { convertDocToDocxCached, convertDocxToPdf } = require('../word-converter/wordConverter');
const logger = require('../logging/logger');

function findTemplate(name = 'full-report') {
  const docx = path.join(config.paths.templates, `${name}.docx`);
  if (fs.existsSync(docx)) return docx;
  const doc = path.join(config.paths.templates, `${name}.doc`);
  if (fs.existsSync(doc)) return doc;
  return null;
}

async function normalizeTemplate(templatePath) {
  if (path.extname(templatePath).toLowerCase() === '.doc') {
    return convertDocToDocxCached(templatePath);
  }
  return templatePath;
}

async function renderDocx(templatePath, data, outputPath) {
  ensureDir(path.dirname(outputPath));
  const normalized = await normalizeTemplate(templatePath);
  const content = await fs.promises.readFile(normalized);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  doc.render(data);
  const buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  await fs.promises.writeFile(outputPath, buffer);
  logger.job('info', 'docx rendered', { templatePath, outputPath });
  return outputPath;
}

async function renderTemplateToPdf(templateName, data, outputPdfPath) {
  const template = findTemplate(templateName);
  if (!template) return null;
  const renderedDocx = path.join(
    config.paths.tmpDir,
    'rendered',
    `${path.basename(outputPdfPath, '.pdf')}.docx`,
  );
  await renderDocx(template, data, renderedDocx);
  await convertDocxToPdf(renderedDocx, outputPdfPath);
  return { template, renderedDocx, outputPdfPath };
}

function buildTemplateData(caseData, mediaSummary) {
  const patient = (caseData.patients || [])[0] || {};
  return {
    fileNum: caseData.fileNum,
    sessionId: caseData.sessionId || '',
    sourceHash: caseData.sourceHash,
    patient,
    patients: caseData.patients || [],
    imaging: caseData.imaging || [],
    cnFiles: caseData.cnFiles || [],
    labs: caseData.labs || [],
    prescriptions: caseData.prescriptions || [],
    media: mediaSummary || {},
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  findTemplate,
  renderDocx,
  renderTemplateToPdf,
  buildTemplateData,
};
