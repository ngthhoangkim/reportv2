function sanitizePdfBase(name) {
  let s = String(name || '').replace(/[/\\?%*:|"<>]/g, '_').trim();
  if (/\.pdf$/i.test(s)) s = s.slice(0, -4);
  return s || 'report';
}

function resolveCdhaPdfBaseName(caseData, explicitOverride) {
  if (explicitOverride != null && String(explicitOverride).trim() !== '') {
    return sanitizePdfBase(explicitOverride);
  }

  const records = Array.isArray(caseData.imaging) ? caseData.imaging : [];
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const fileName = records[i].fileName;
    if (fileName && String(fileName).trim()) {
      return sanitizePdfBase(fileName);
    }
  }

  const sessionPart = caseData.sessionId == null ? 'all' : String(caseData.sessionId);
  return sanitizePdfBase(`${caseData.fileNum}_${sessionPart}`);
}

function resolveCdhaPdfFileName(caseData, explicitOverride) {
  return `${resolveCdhaPdfBaseName(caseData, explicitOverride)}.pdf`;
}

function resolvePrescriptionUploadName(sessionId) {
  return `${String(sessionId)}.pdf`;
}

function normalizePrescriptionPrefix() {
  return 'khambenh/toathuoc/';
}

module.exports = {
  sanitizePdfBase,
  resolveCdhaPdfBaseName,
  resolveCdhaPdfFileName,
  resolvePrescriptionUploadName,
  normalizePrescriptionPrefix,
};
