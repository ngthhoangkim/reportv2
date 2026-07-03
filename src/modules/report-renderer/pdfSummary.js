const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

function linesFromCase(caseData, mediaSummary) {
  const patient = (caseData.patients || [])[0] || {};
  const lines = [
    `FileNum: ${caseData.fileNum}`,
    `SessionId: ${caseData.sessionId || 'all'}`,
    `Patient: ${patient.fullName || ''}`,
    `Source hash: ${caseData.sourceHash}`,
    '',
    `CDHA results: ${(caseData.imaging || []).length}`,
    ...caseData.imaging.slice(0, 40).map((r) => `- ${r.typeName} #${r.imagingResultId} ${r.serviceName || r.resultName || ''} images=${r.totalImages} pacs=${r.pacsFileResultUrl ? 'yes' : 'no'}`),
    '',
    `CN_FILES: ${(caseData.cnFiles || []).length} resolved=${mediaSummary.foundCount || 0} missing=${mediaSummary.missingCount || 0}`,
    ...caseData.cnFiles.slice(0, 40).map((f) => `- #${f.id} ${f.docTitle || ''} ${f.docDate || ''} file=${f.fileName || ''}`),
    '',
    `Labs groups: ${(caseData.labs || []).length}`,
    ...caseData.labs.slice(0, 20).map((l) => `- session=${l.sessionId} resultCount=${l.pathologyResultCount} valueRows=${l.valueRowCount}`),
    '',
    `Prescription groups: ${(caseData.prescriptions || []).length}`,
    ...caseData.prescriptions.slice(0, 20).map((p) => `- session=${p.sessionId} lines=${p.rxLineCount}`),
  ];
  return lines;
}

async function drawSummaryPdf(outputPath, caseData, mediaSummary) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const lines = linesFromCase(caseData, mediaSummary);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 805;

  page.drawText('Report V2 Phase 1 Summary', { x: 40, y, size: 16, font: bold, color: rgb(0.05, 0.05, 0.05) });
  y -= 28;
  for (const line of lines) {
    if (y < 50) {
      page = pdf.addPage([595.28, 841.89]);
      y = 805;
    }
    const chunks = line.length > 105 ? line.match(/.{1,105}/g) : [line];
    for (const chunk of chunks) {
      page.drawText(chunk, { x: 40, y, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 14;
    }
  }

  fs.writeFileSync(outputPath, await pdf.save());
  return outputPath;
}

module.exports = { drawSummaryPdf, linesFromCase };
