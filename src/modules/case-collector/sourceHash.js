const crypto = require('crypto');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function sourceHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');
}

function snapshotFromCase(caseData) {
  return {
    fileNum: caseData.fileNum,
    sessionId: caseData.sessionId || null,
    patientIds: caseData.patients.map((p) => p.patientId).sort(),
    imaging: caseData.imaging.map((r) => ({
      id: r.imagingResultId,
      requestId: r.requestId,
      type: r.pathologyType,
      createdDate: r.createdDate,
      updatedDate: r.updatedDate,
      deletedDate: r.deletedDate,
      fileName: r.fileName,
      templateFile: r.templateFile,
      resultBytes: r.resultDataBytes,
      conclusionBytes: r.conclusionDataBytes,
      suggestionBytes: r.suggestionDataBytes,
      totalImages: r.totalImages,
      printedImages: r.printedImages,
      pacsFileResultUrl: r.pacsFileResultUrl,
    })),
    cnFiles: caseData.cnFiles.map((f) => ({
      id: f.id,
      patientId: f.patientId,
      subSessionId: f.subSessionId,
      sessionId: f.sessionId,
      docTitle: f.docTitle,
      docType: f.docType,
      fileType: f.fileType,
      fileName: f.fileName,
      docDate: f.docDate,
      createdDate: f.createdDate,
      updatedDate: f.updatedDate,
      deletedDate: f.deletedDate,
    })),
    labs: caseData.labs,
    prescriptions: caseData.prescriptions,
  };
}

module.exports = { sourceHash, snapshotFromCase };
