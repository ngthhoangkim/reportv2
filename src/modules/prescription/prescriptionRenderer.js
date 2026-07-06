const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { PDFDocument } = require('pdf-lib');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const { convertDocToDocxCached, renderWordTemplateToPdf } = require('../word-converter/wordConverter');
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

const MEDICATION_SCAFFOLD_TOKENS = new Set(['SL', 'U', 'ItemName', 'Note', 'Q', 'F']);

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

function placeholderValue(name, data) {
  if (!Object.prototype.hasOwnProperty.call(data, name)) return '';
  const value = data[name];
  if (value == null) return '';
  return String(value);
}

function replaceTemplatePlaceholders(text, data) {
  return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => placeholderValue(name, data));
}

function renderTextNode(attrs, value) {
  const text = String(value);
  const parts = text.split(/\n/);
  if (parts.length === 1) return `<w:t${attrs}>${escapeXml(parts[0])}</w:t>`;
  return parts
    .map((part, index) => `${index ? '<w:br/>' : ''}<w:t${attrs}>${escapeXml(part)}</w:t>`)
    .join('');
}

function renderPlaceholdersInXml(xml, data) {
  return String(xml).replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (_, attrs, rawText) => {
    const replaced = replaceTemplatePlaceholders(unescapeXml(rawText), data);
    return renderTextNode(attrs, replaced);
  });
}

function splitParagraphRanges(xml) {
  const ranges = [];
  const re = /<w:p(?=[\s>])[\s\S]*?<\/w:p>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    ranges.push({ start: match.index, end: re.lastIndex, xml: match[0] });
  }
  return ranges;
}

function extractPPr(paraXml) {
  const match = String(paraXml).match(/<w:pPr\b[\s\S]*?<\/w:pPr>/);
  return match ? match[0] : '<w:pPr/>';
}

function extractFirstRPr(paraXml) {
  const firstRun = String(paraXml).match(/<w:r\b[\s\S]*?<\/w:r>/);
  if (!firstRun) return '';
  const rPr = firstRun[0].match(/<w:rPr\b[\s\S]*?<\/w:rPr>/);
  return rPr ? rPr[0] : '';
}

function replaceParagraphPlainText(paraXml, text) {
  const pPr = extractPPr(paraXml);
  const rPr = extractFirstRPr(paraXml);
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text || '')}</w:t></w:r></w:p>`;
}

function medicationTemplatePayloads(item, index) {
  const quantity = [item.quantity, item.unit].filter(Boolean).join(' ');
  const itemName = item.property ? `${item.itemName} (${item.property})` : item.itemName;
  const dose = [item.dose, item.doseUnit].filter(Boolean).join(' ');
  return [
    `${index + 1}/`,
    quantity,
    itemName,
    item.instructions || item.note || '',
    'Ngày',
    ', mỗi lần',
    dose,
    item.frequency || '',
  ];
}

function replaceMedicationParagraphsInXml(xml, medications = []) {
  const paragraphs = splitParagraphRanges(xml);
  const startIndex = paragraphs.findIndex((para) => /^<\s*#\s*>\s*\/?$/.test(paragraphText(para.xml)));
  if (startIndex < 0 || startIndex + 7 >= paragraphs.length) return xml;

  const template = paragraphs.slice(startIndex, startIndex + 8).map((para) => para.xml);
  const block = (medications || []).map((item, medicationIndex) => {
    const payloads = medicationTemplatePayloads(item, medicationIndex);
    return template.map((para, i) => replaceParagraphPlainText(para, payloads[i])).join('');
  }).join('');

  const rangeStart = paragraphs[startIndex].start;
  const rangeEnd = paragraphs[startIndex + 7].end;
  return xml.slice(0, rangeStart) + block + xml.slice(rangeEnd);
}

function angleTokenFinds(token) {
  return [
    `<${token}>`,
    `< ${token}>`,
    `<${token} >`,
    `< ${token} >`,
  ];
}

function tokenReplacement(token, value, once = false) {
  return {
    find: `<${token}>`,
    finds: angleTokenFinds(token),
    replace: value == null ? '' : String(value),
    once,
  };
}

function medicationRowsForWord(data) {
  return (data.medications || []).map((item, index) => ({
    index: `${index + 1}/`,
    quantity: [item.quantity, item.unit].filter(Boolean).join(' '),
    itemName: item.property ? `${item.itemName} (${item.property})` : item.itemName,
    compactName: item.itemName || '',
    note: item.instructions || item.note || '',
    dose: [item.dose, item.doseUnit].filter(Boolean).join(' '),
    frequency: item.frequency || '',
  }));
}

function buildWordReplacements(data, options = {}) {
  const role = options.role || 'generic';
  const replacements = [];

  if (role === 'front') {
    replacements.push(tokenReplacement('PatientID', data.PatientName, true));
    replacements.push(tokenReplacement('PatientID', data.PatientBarcode));
  } else {
    replacements.push(tokenReplacement('PatientID', data.PatientBarcode));
  }

  replacements.push(tokenReplacement('Conclusion', role === 'back' ? data.BackConclusion : data.Conclusion));
  if (role === 'front') {
    replacements.push({ kind: 'medicationRows', rows: medicationRowsForWord(data) });
  }

  for (const [token, field] of TOKEN_ALIASES.entries()) {
    if (['PatientID', 'Conclusion', '#'].includes(token)) continue;
    if (MEDICATION_SCAFFOLD_TOKENS.has(token)) continue;
    replacements.push(tokenReplacement(token, field ? data[field] : ''));
  }
  return replacements;
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
    const xml = options.role === 'front'
      ? replaceMedicationParagraphsInXml(zip.file(name).asText(), data.medications)
      : zip.file(name).asText();
    const prepared = prepareXmlForDocxtemplater(xml, options);
    zip.file(name, renderPlaceholdersInXml(prepared, data));
  }
  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
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

async function renderPrescriptionTemplatePdf(templatePath, data, pdfPath, options = {}) {
  ensureDir(path.dirname(pdfPath));
  if (options.role === 'front') {
    logger.job('info', 'prescription front template data', {
      medicationCount: (data.medications || []).length,
      diagnosisLength: String(data.Conclusion || '').length,
    });
  }
  const replacements = buildWordReplacements(data, options);
  await renderWordTemplateToPdf(templatePath, pdfPath, replacements);
  logger.job('info', 'prescription template pdf rendered', { templatePath, pdfPath });
  return pdfPath;
}

async function renderPrescriptionPdf(prescriptionData, outputPdfPath) {
  const progressId = prescriptionData.progressId;
  const baseDir = path.join(config.paths.tmpDir, 'prescriptions', String(progressId));
  ensureDir(baseDir);
  const frontPdf = path.join(baseDir, `${progressId}-front.pdf`);
  const backPdf = path.join(baseDir, `${progressId}-back.pdf`);

  await renderPrescriptionTemplatePdf(config.prescription.templateFront, prescriptionData.templateData, frontPdf, { role: 'front' });
  await renderPrescriptionTemplatePdf(config.prescription.templateBack, prescriptionData.templateData, backPdf, { role: 'back' });
  await mergePdfs([frontPdf, backPdf], outputPdfPath);
  logger.job('info', 'prescription pdf rendered', { progressId, outputPdfPath });
  return {
    pdfPath: outputPdfPath,
    frontPdf,
    backPdf,
  };
}

module.exports = {
  convertAngleTokens,
  buildWordReplacements,
  prepareXmlForDocxtemplater,
  renderPlaceholdersInXml,
  renderPrescriptionDocx,
  renderPrescriptionTemplatePdf,
  renderPrescriptionPdf,
  angleTokenFinds,
  medicationRowsForWord,
  replaceMedicationParagraphsInXml,
};
