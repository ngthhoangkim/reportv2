const fs = require('fs');
const path = require('path');

const PATHOLOGY = {
  XRAY: 2,
  NOISOI: 3,
  SIEUAM: 4,
};

const TEMPLATE_IMAGE_LIMITS = {
  'UltraSoundResultTemplate 1H.doc': 1,
  'UltraSoundResultTemplate 1H.docx': 1,
  'UltraSoundResultTemplate.doc': 2,
  'UltraSoundResultTemplate.docx': 2,
  'NoiSoi 9H.doc': 9,
  'NoiSoi 9H.docx': 9,
  'NoiSoiMoi.doc': 4,
  'NoiSoiMoi.docx': 4,
  'SoiCTC.doc': 2,
  'SoiCTC.docx': 2,
  'XrayResultTemplate.doc': 1,
  'XrayResultTemplate.docx': 1,
};

function resolveTemplateCandidates(templateName) {
  const name = String(templateName || '').trim();
  if (!name) return [];
  const ext = path.extname(name).toLowerCase();
  if (ext === '.doc') {
    const base = path.basename(name, ext);
    return [`${base}.docx`, `${base}.doc`];
  }
  return [name];
}

function firstExisting(baseDir, names) {
  for (const name of names) {
    const p = path.join(baseDir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function selectFallbackByPathology(baseDir, pathologyType, imageCount = 0) {
  switch (Number(pathologyType)) {
    case PATHOLOGY.SIEUAM:
      return firstExisting(
        baseDir,
        imageCount <= 1
          ? ['UltraSoundResultTemplate 1H.docx', 'UltraSoundResultTemplate 1H.doc']
          : ['UltraSoundResultTemplate.docx', 'UltraSoundResultTemplate.doc'],
      );
    case PATHOLOGY.XRAY:
      return firstExisting(baseDir, ['XrayResultTemplate.docx', 'XrayResultTemplate.doc']);
    case PATHOLOGY.NOISOI:
    default:
      return null;
  }
}

function selectTemplate(baseDir, templateFile, pathologyType, imageCount = 0) {
  const templateName = path.basename(String(templateFile || '').trim());
  const direct = firstExisting(baseDir, resolveTemplateCandidates(templateName));
  if (direct) return direct;
  return selectFallbackByPathology(baseDir, pathologyType, imageCount);
}

function getImageLimit(templatePath) {
  return TEMPLATE_IMAGE_LIMITS[path.basename(templatePath)] || Number.MAX_SAFE_INTEGER;
}

module.exports = {
  selectTemplate,
  getImageLimit,
  resolveTemplateCandidates,
};
