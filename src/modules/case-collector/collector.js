const db = require('../../db/sqlServer');
const { sourceHash, snapshotFromCase } = require('./sourceHash');

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapDate(v) {
  return v ? new Date(v).toISOString() : null;
}

function typeName(type) {
  switch (Number(type)) {
    case 2: return 'XRay';
    case 3: return 'NoiSoi';
    case 4: return 'SieuAm';
    case 6: return 'CT';
    case 7: return 'MRI';
    case 8: return 'ECG';
    case 11: return 'Mammo';
    default: return `Type ${type}`;
  }
}

function sessionPredicate(alias, sessionId) {
  return sessionId != null ? ` AND ${alias}.SessionId = @sessionId` : '';
}

async function collectPatients(fileNum) {
  const rows = await db.query(
    `
    SELECT TOP 20
      p.ContactId AS PatientID,
      p.FileNum,
      pv.FullName,
      pv.Dob,
      pv.Sex
    FROM dbo.CR_Patient p WITH (NOLOCK)
    LEFT JOIN dbo.PersonView pv WITH (NOLOCK) ON pv.ContactId = p.ContactId
    WHERE LTRIM(RTRIM(CONVERT(VARCHAR(50), p.FileNum))) = LTRIM(RTRIM(@fileNum))
    ORDER BY p.ContactId DESC
    `,
    { fileNum },
  );
  return rows.map((r) => ({
    patientId: numOrNull(r.PatientID),
    fileNum: r.FileNum != null ? String(r.FileNum).trim() : '',
    fullName: r.FullName || '',
    dob: mapDate(r.Dob),
    sex: r.Sex || '',
  }));
}

async function collectImaging(fileNum, sessionId = null) {
  const rows = await db.query(
    `
    SELECT
      v.FileNum,
      v.SessionId,
      v.PatientName,
      v.Dob,
      v.Sex,
      v.Street,
      v.ServiceName,
      v.Doctor,
      v.RequestedDoctor,
      r.Id AS ImagingResultId,
      r.PatientID,
      r.RequestId,
      r.PathologyType,
      r.ResultName,
      r.TemplateFile,
      r.FileName,
      r.CreatedDate,
      r.UpdatedDate,
      r.DeletedDate,
      r.FinishDate,
      r.SampleNumber,
      DATALENGTH(d.ResultData) AS ResultDataBytes,
      DATALENGTH(d.ConclusionData) AS ConclusionDataBytes,
      DATALENGTH(d.SuggestionData) AS SuggestionDataBytes,
      ISNULL(img.TotalImages, 0) AS TotalImages,
      ISNULL(img.PrintedImages, 0) AS PrintedImages,
      pacs.FileResultURL,
      pacs.ViewURL,
      pacs.AccessCode,
      pacs.PacsCreatedDate
    FROM dbo.CN_ImagingResult r WITH (NOLOCK)
    INNER JOIN dbo.ViewImagingResult v WITH (NOLOCK) ON v.Id = r.Id
    INNER JOIN dbo.CN_ImagingResultData d WITH (NOLOCK) ON d.ImagingResultId = r.Id
    OUTER APPLY (
      SELECT
        COUNT(1) AS TotalImages,
        SUM(CASE WHEN Printed = 1 THEN 1 ELSE 0 END) AS PrintedImages
      FROM dbo.CN_PathologyImage pi WITH (NOLOCK)
      WHERE pi.ResultId = r.Id AND pi.DeletedDate IS NULL
    ) img
    OUTER APPLY (
      SELECT TOP 1
        p.FileResultURL,
        p.ViewURL,
        p.AccessCode,
        p.CreatedDate AS PacsCreatedDate
      FROM dbo.PACS_RequestInfo p WITH (NOLOCK)
      WHERE p.RequestId = r.RequestId
      ORDER BY p.Id DESC
    ) pacs
    WHERE r.DeletedDate IS NULL
      AND LTRIM(RTRIM(CONVERT(VARCHAR(50), v.FileNum))) = LTRIM(RTRIM(@fileNum))
      ${sessionPredicate('v', sessionId)}
    ORDER BY v.SessionId DESC, r.CreatedDate ASC, r.Id ASC
    `,
    { fileNum, sessionId },
  );
  return rows.map((r) => ({
    fileNum: r.FileNum != null ? String(r.FileNum).trim() : '',
    sessionId: numOrNull(r.SessionId),
    patientId: numOrNull(r.PatientID),
    patientName: r.PatientName || '',
    dob: mapDate(r.Dob),
    sex: r.Sex || '',
    address: r.Street || '',
    serviceName: r.ServiceName || '',
    doctor: r.Doctor || '',
    requestedDoctor: r.RequestedDoctor || '',
    imagingResultId: numOrNull(r.ImagingResultId),
    requestId: numOrNull(r.RequestId),
    pathologyType: numOrNull(r.PathologyType),
    typeName: typeName(r.PathologyType),
    resultName: r.ResultName || '',
    templateFile: r.TemplateFile || '',
    fileName: r.FileName || '',
    sampleNumber: r.SampleNumber || '',
    createdDate: mapDate(r.CreatedDate),
    updatedDate: mapDate(r.UpdatedDate),
    deletedDate: mapDate(r.DeletedDate),
    finishDate: mapDate(r.FinishDate),
    resultDataBytes: Number(r.ResultDataBytes || 0),
    conclusionDataBytes: Number(r.ConclusionDataBytes || 0),
    suggestionDataBytes: Number(r.SuggestionDataBytes || 0),
    totalImages: Number(r.TotalImages || 0),
    printedImages: Number(r.PrintedImages || 0),
    pacsFileResultUrl: r.FileResultURL || '',
    pacsViewUrl: r.ViewURL || '',
    pacsAccessCode: r.AccessCode || '',
    pacsCreatedDate: mapDate(r.PacsCreatedDate),
  }));
}

async function collectCnFiles(fileNum, sessionId = null) {
  const rows = await db.query(
    `
    SELECT
      f.ID,
      f.PatientID,
      f.PatientName,
      f.DocTitle,
      f.DocType,
      f.FileType,
      f.FileName,
      f.DocDate,
      f.DateEntered,
      f.CreatedDate,
      f.UpdatedDate,
      f.DeletedDate,
      f.SubSessionId,
      ss.SessionId AS CrSessionId,
      directPatient.FileNum AS DirectFileNum,
      sessionPatient.FileNum AS SessionFileNum,
      CASE
        WHEN ss.SessionId IS NOT NULL THEN 'subsession'
        ELSE 'patient'
      END AS MatchScope
    FROM dbo.CN_FILES f WITH (NOLOCK)
    LEFT JOIN dbo.CR_Patient directPatient WITH (NOLOCK) ON directPatient.ContactId = f.PatientID
    LEFT JOIN dbo.CR_SubSession ss WITH (NOLOCK) ON ss.Id = f.SubSessionId
    LEFT JOIN dbo.CR_Session s WITH (NOLOCK) ON s.Id = ss.SessionId
    LEFT JOIN dbo.CR_Patient sessionPatient WITH (NOLOCK) ON sessionPatient.ContactId = s.PatientID
    WHERE f.DeletedDate IS NULL
      AND (
        LTRIM(RTRIM(CONVERT(VARCHAR(50), directPatient.FileNum))) = LTRIM(RTRIM(@fileNum))
        OR LTRIM(RTRIM(CONVERT(VARCHAR(50), sessionPatient.FileNum))) = LTRIM(RTRIM(@fileNum))
      )
      AND (
        @sessionId IS NULL
        OR ss.SessionId = @sessionId
        OR f.SubSessionId = @sessionId
        OR f.SubSessionId IS NULL
      )
    ORDER BY f.CreatedDate DESC, f.ID DESC
    `,
    { fileNum, sessionId },
  );
  return rows.map((r) => ({
    id: numOrNull(r.ID),
    patientId: numOrNull(r.PatientID),
    patientName: r.PatientName || '',
    docTitle: r.DocTitle || '',
    docType: r.DocType || '',
    fileType: numOrNull(r.FileType),
    fileName: r.FileName || '',
    subSessionId: numOrNull(r.SubSessionId),
    sessionId: numOrNull(r.CrSessionId),
    matchScope: r.MatchScope || '',
    docDate: mapDate(r.DocDate),
    dateEntered: mapDate(r.DateEntered),
    createdDate: mapDate(r.CreatedDate),
    updatedDate: mapDate(r.UpdatedDate),
    deletedDate: mapDate(r.DeletedDate),
  }));
}

async function collectLabs(fileNum, sessionId = null) {
  const rows = await db.query(
    `
    SELECT
      pr.SessionId,
      COUNT(DISTINCT pr.Id) AS PathologyResultCount,
      COUNT(rv.Id) AS ValueRowCount,
      MIN(pr.CreatedDate) AS FirstCreatedDate,
      MAX(pr.CreatedDate) AS LastCreatedDate
    FROM dbo.ViewPathologyResult pr WITH (NOLOCK)
    LEFT JOIN dbo.CN_PathologyResultValue rv WITH (NOLOCK) ON rv.ResultId = pr.Id
    WHERE pr.DeletedDate IS NULL
      AND LTRIM(RTRIM(CONVERT(VARCHAR(50), pr.FileNum))) = LTRIM(RTRIM(@fileNum))
      ${sessionId != null ? 'AND pr.SessionId = @sessionId' : ''}
    GROUP BY pr.SessionId
    ORDER BY MAX(pr.CreatedDate) DESC
    `,
    { fileNum, sessionId },
  );
  return rows.map((r) => ({
    sessionId: numOrNull(r.SessionId),
    pathologyResultCount: Number(r.PathologyResultCount || 0),
    valueRowCount: Number(r.ValueRowCount || 0),
    firstCreatedDate: mapDate(r.FirstCreatedDate),
    lastCreatedDate: mapDate(r.LastCreatedDate),
  }));
}

async function collectPrescriptions(fileNum, sessionId = null) {
  const rows = await db.query(
    `
    SELECT
      rx.SessionId,
      COUNT(1) AS RxLineCount,
      COUNT(DISTINCT rx.ID) AS RxDistinctRows,
      COUNT(DISTINCT rx.SubSessionId) AS SubSessionCount,
      MIN(rx.CreatedDate) AS FirstCreatedDate,
      MAX(rx.CreatedDate) AS LastCreatedDate
    FROM dbo.ViewRX rx WITH (NOLOCK)
    INNER JOIN dbo.CR_Patient p WITH (NOLOCK) ON p.ContactId = rx.PatientID
    WHERE rx.DeletedDate IS NULL
      AND LTRIM(RTRIM(CONVERT(VARCHAR(50), p.FileNum))) = LTRIM(RTRIM(@fileNum))
      ${sessionId != null ? 'AND rx.SessionId = @sessionId' : ''}
    GROUP BY rx.SessionId
    ORDER BY MAX(rx.CreatedDate) DESC
    `,
    { fileNum, sessionId },
  );
  return rows.map((r) => ({
    sessionId: numOrNull(r.SessionId),
    rxLineCount: Number(r.RxLineCount || 0),
    rxDistinctRows: Number(r.RxDistinctRows || 0),
    subSessionCount: Number(r.SubSessionCount || 0),
    firstCreatedDate: mapDate(r.FirstCreatedDate),
    lastCreatedDate: mapDate(r.LastCreatedDate),
  }));
}

async function collectCase({ fileNum, sessionId = null }) {
  const cleanFileNum = String(fileNum || '').trim();
  const sid = sessionId == null || sessionId === '' ? null : Number(sessionId);
  const [patients, imaging, cnFiles, labs, prescriptions] = await Promise.all([
    collectPatients(cleanFileNum),
    collectImaging(cleanFileNum, sid),
    collectCnFiles(cleanFileNum, sid),
    collectLabs(cleanFileNum, sid),
    collectPrescriptions(cleanFileNum, sid),
  ]);
  const result = {
    fileNum: cleanFileNum,
    sessionId: sid,
    patients,
    imaging,
    cnFiles,
    labs,
    prescriptions,
  };
  const snapshot = snapshotFromCase(result);
  result.sourceHash = sourceHash(snapshot);
  result.sourceSnapshot = snapshot;
  return result;
}

module.exports = {
  collectCase,
  collectPatients,
  collectImaging,
  collectCnFiles,
  collectLabs,
  collectPrescriptions,
  typeName,
};
