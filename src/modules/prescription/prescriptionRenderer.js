const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { PDFDocument } = require('pdf-lib');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const { convertDocToDocxCached, convertDocxToPdf } = require('../word-converter/wordConverter');
const logger = require('../logging/logger');

const TOKEN_ALIASES = new Map(Object.entries({
  '#': 'MedicationBlock',
  SL: '',
  U: '',
  ItemName: '',
  Note: '',
  Q: '',
  F: '',
  SO: 'So',
  So: 'So',
  PatientID: 'MaBN',
  PatientName: 'PatientName',
  Address: 'Address',
  Conclusion: 'Conclusion',
  ChanDoan: 'ChanDoan',
  LamSang: 'LamSang',
  LoiDan: 'LoiDan',
  Advice: 'Advice',
  Barcode: 'Barcode',
  MaPhieu: 'MaPhieu',
  MaBN: 'MaBN',
  BHYT: 'BHYT',
  HR: 'HR',
  Temp: 'Temp',
  BP: 'BP',
  RR: 'RR',
  G: 'G',
  Dtb: 'Dtb',
  Date: 'Date',
  Month: 'Month',
  Mont: 'Mont',
  Year: 'Year',
  Doctor: 'Doctor',
}));

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeTokenName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function placeholderFor(rawName, context = {}) {
  const name = normalizeTokenName(rawName);
  if (name === 'PatientID') {
    context.patientIdCount = (context.patientIdCount || 0) + 1;
    if (context.role === 'front' && context.patientIdCount === 1) return '{PatientName}';
    return '{PatientBarcode}';
  }
  if (name === 'Conclusion' && context.role === 'back') return '{BackConclusion}';
  if (!TOKEN_ALIASES.has(name)) return `{${name}}`;
  const mapped = TOKEN_ALIASES.get(name);
  return mapped ? `{${mapped}}` : '';
}

function convertAngleTokens(text, context = {}) {
  return String(text)
    .replace(/<\s*([^<>]+?)\s*>/g, (_, name) => placeholderFor(name, context))
    .replace(/\{MedicationBlock\}\s*\/?/g, '{MedicationBlock}');
}

function paragraphText(paragraphXml) {
  return unescapeXml(
    String(paragraphXml)
      .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, '$1')
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

function isMedicationScaffoldText(text) {
  const t = normalizeTokenName(text);
  return [
    '<SL> <U>',
    '<ItemName>',
    '<Note>',
    '<Q> <U>',
    '<F>',
    'Ngày',
    ', mỗi lần',
  ].includes(t);
}

function normalizeParagraphXml(paragraphXml, context = {}) {
  const rawParagraphText = paragraphText(paragraphXml);
  if (isMedicationScaffoldText(rawParagraphText)) return '';
  if (!paragraphXml.includes('&lt;')) return paragraphXml;
  const textRe = /<w:t([^>]*)>([\s\S]*?)<\/w:t>/g;
  const nodes = [];
  let match;
  while ((match = textRe.exec(paragraphXml)) !== null) {
    nodes.push({
      start: match.index,
      end: textRe.lastIndex,
      attrs: match[1],
      text: unescapeXml(match[2]),
    });
  }
  if (!nodes.length) return paragraphXml;
  const combined = nodes.map((node) => node.text).join('');
  const converted = convertAngleTokens(combined, context);
  if (converted === combined) return paragraphXml;

  const removeRightAlign = converted.includes('{MedicationBlock}');
  let out = '';
  let cursor = 0;
  nodes.forEach((node, index) => {
    out += paragraphXml.slice(cursor, node.start);
    const nextText = index === 0 ? converted : '';
    out += `<w:t${node.attrs}>${escapeXml(nextText)}</w:t>`;
    cursor = node.end;
  });
  out += paragraphXml.slice(cursor);
  if (removeRightAlign) out = out.replace(/<w:jc w:val="right"\/>/g, '');
  return out;
}

function prepareXmlForDocxtemplater(xml, options = {}) {
  const context = { role: options.role || 'generic', patientIdCount: 0 };
  return String(xml).replace(/<w:p(?=[\s>])[\s\S]*?<\/w:p>/g, (paragraph) => normalizeParagraphXml(paragraph, context));
}

async function normalizeTemplate(templatePath) {
  if (path.extname(templatePath).toLowerCase() === '.doc') {
    const converted = await convertDocToDocxCached(templatePath);
    logger.job('info', 'prescription template normalized', { templatePath, normalizedTemplate: converted });
    return converted;
  }
  return templatePath;
}

async function renderPrescriptionDocx(templatePath, data, outputPath, options = {}) {
  ensureDir(path.dirname(outputPath));
  const normalizedTemplate = await normalizeTemplate(templatePath);
  if (path.extname(normalizedTemplate).toLowerCase() !== '.docx') {
    throw new Error(`Prescription template must be .doc or .docx: ${templatePath}`);
  }
  const zip = new PizZip(await fs.promises.readFile(normalizedTemplate));
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    zip.file(name, prepareXmlForDocxtemplater(zip.file(name).asText(), options));
  }
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  doc.render(data);
  const buffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  await fs.promises.writeFile(outputPath, buffer);
  logger.job('info', 'prescription docx rendered', { templatePath, outputPath });
  return outputPath;
}

async function mergePdfs(inputPaths, outputPath) {
  ensureDir(path.dirname(outputPath));
  const merged = await PDFDocument.create();
  for (const inputPath of inputPaths) {
    const src = await PDFDocument.load(await fs.promises.readFile(inputPath));
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  await fs.promises.writeFile(outputPath, await merged.save());
  return outputPath;
}

async function renderPrescriptionPdf(prescriptionData, outputPdfPath) {
  const progressId = prescriptionData.progressId;
  const baseDir = path.join(config.paths.tmpDir, 'prescriptions', String(progressId));
  ensureDir(baseDir);
  const frontDocx = path.join(baseDir, `${progressId}-front.docx`);
  const backDocx = path.join(baseDir, `${progressId}-back.docx`);
  const frontPdf = path.join(baseDir, `${progressId}-front.pdf`);
  const backPdf = path.join(baseDir, `${progressId}-back.pdf`);

  await renderPrescriptionDocx(config.prescription.templateFront, prescriptionData.templateData, frontDocx, { role: 'front' });
  await renderPrescriptionDocx(config.prescription.templateBack, prescriptionData.templateData, backDocx, { role: 'back' });
  await convertDocxToPdf(frontDocx, frontPdf);
  await convertDocxToPdf(backDocx, backPdf);
  await mergePdfs([frontPdf, backPdf], outputPdfPath);
  logger.job('info', 'prescription pdf rendered', { progressId, outputPdfPath });
  return {
    pdfPath: outputPdfPath,
    frontDocx,
    backDocx,
    frontPdf,
    backPdf,
  };
}

module.exports = {
  convertAngleTokens,
  prepareXmlForDocxtemplater,
  renderPrescriptionDocx,
  renderPrescriptionPdf,
};
