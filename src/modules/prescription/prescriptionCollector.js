const db = require('../../db/sqlServer');
const logger = require('../logging/logger');
const {
  birthYear,
  cleanText,
  compactDoctor,
  firstValue,
  formatDateParts,
  normalizeSex,
  numOrNull,
  progressBarcode,
  stripNotePrefix,
} = require('./prescriptionUtils');

async function optionalQuery(sql, params, fallback = []) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    logger.job('warn', 'optional prescription query failed', { error: err.message });
    return fallback;
  }
}

function progressPredicate(progressId) {
  return progressId != null ? 'AND vp.Id = @progressId' : '';
}

function sessionPredicate(sessionId) {
  return sessionId != null ? 'AND vs.Id = @sessionId' : '';
}

function joinAddressParts(parts, separator = ' ') {
  return parts
    .map((part) => cleanText(part).replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(separator);
}

function fullAddress(row) {
  const direct = cleanText(firstValue(row, ['Address', 'FullAddress']));
  if (direct) return direct.replace(/\s+/g, ' ');
  const line = joinAddressParts([firstValue(row, ['AddressNo']), firstValue(row, ['Street'])]);
  return joinAddressParts([
    line,
    firstValue(row, ['Ward']),
    firstValue(row, ['District']),
    firstValue(row, ['City']),
  ], ', ');
}

async function collectPrescriptionProgresses({ fileNum, sessionId = null, progressId = null }) {
  const cleanFileNum = String(fileNum || '').trim();
  const sid = sessionId == null || sessionId === '' ? null : Number(sessionId);
  const pid = progressId == null || progressId === '' ? null : Number(progressId);
  const rows = await db.query(
    `
    SELECT
      vp.Id AS ProgressId,
      s.PatientID,
      vp.SubSessionId,
      vp.DoctorId,
      vp.DoctorName,
      vp.MainDisease,
      vp.VisitDate,
      vp.FinishDate,
      vs.Id AS SessionId,
      p.FileNum,
      vs.CardCode
    FROM dbo.ViewProgress vp WITH (NOLOCK)
    INNER JOIN dbo.CR_SubSession ss WITH (NOLOCK) ON ss.Id = vp.SubSessionId
    INNER JOIN dbo.CR_Session s WITH (NOLOCK) ON s.Id = ss.SessionId
    INNER JOIN dbo.CR_Patient p WITH (NOLOCK) ON p.ContactId = s.PatientID
    INNER JOIN dbo.ViewSession vs WITH (NOLOCK) ON vs.Id = ss.SessionId
    WHERE LTRIM(RTRIM(CONVERT(VARCHAR(50), p.FileNum))) = LTRIM(RTRIM(@fileNum))
      ${sessionPredicate(sid)}
      ${progressPredicate(pid)}
      AND EXISTS (
        SELECT 1
        FROM dbo.ViewRX rx WITH (NOLOCK)
        WHERE rx.DeletedDate IS NULL
          AND (
            rx.ProgressID = vp.Id
            OR (
              (rx.ProgressID IS NULL OR rx.ProgressID = 0)
              AND rx.SubSessionId = vp.SubSessionId
              AND (rx.DoctorId = vp.DoctorId OR vp.DoctorId IS NULL)
            )
          )
      )
    ORDER BY vp.Id ASC
    `,
    { fileNum: cleanFileNum, sessionId: sid, progressId: pid },
  );
  const seen = new Set();
  return rows.map((row) => ({
    progressId: numOrNull(row.ProgressId),
    sessionId: numOrNull(row.SessionId),
    subSessionId: numOrNull(row.SubSessionId),
    patientId: numOrNull(row.PatientID),
    doctorId: numOrNull(row.DoctorId),
    doctorName: cleanText(row.DoctorName),
    mainDisease: cleanText(row.MainDisease),
    visitDate: row.FinishDate || row.VisitDate || null,
    fileNum: row.FileNum != null ? String(row.FileNum).trim() : cleanFileNum,
    patientName: '',
    dob: null,
    sex: '',
    address: '',
    cardCode: cleanText(row.CardCode),
  })).filter((row) => {
    if (!row.progressId || seen.has(row.progressId)) return false;
    seen.add(row.progressId);
    return true;
  });
}

async function collectPersonDetails(patientId) {
  if (patientId == null) return {};
  const rows = await optionalQuery(
    `
    SELECT TOP 1 *
    FROM dbo.PersonView WITH (NOLOCK)
    WHERE ContactId = @patientId
    `,
    { patientId },
  );
  const row = rows[0] || {};
  return {
    patientName: cleanText(firstValue(row, ['FullName', 'PatientName', 'Name'])),
    dob: firstValue(row, ['Dob', 'DOB', 'BirthDate', 'DateOfBirth'], null),
    sex: cleanText(firstValue(row, ['Sex', 'Gender'])),
    address: fullAddress(row),
  };
}

async function collectDoctorQualification(doctorId) {
  if (doctorId == null) return '';
  const rows = await optionalQuery(
    `
    SELECT TOP 1 Qualification
    FROM dbo.ViewStaff WITH (NOLOCK)
    WHERE ContactId = @doctorId
    `,
    { doctorId },
  );
  return cleanText(rows[0] && rows[0].Qualification);
}

async function collectPathologyFallback(progressId) {
  const rows = await optionalQuery(
    `
    SELECT TOP 1 PathologyResult
    FROM dbo.CN_Progress WITH (NOLOCK)
    WHERE ID = @progressId
    `,
    { progressId },
  );
  return cleanText(rows[0] && rows[0].PathologyResult);
}

async function collectGeneralExam(subSessionId) {
  if (subSessionId == null) return {};
  const rows = await optionalQuery(
    `
    SELECT TOP 1 *
    FROM dbo.CN_GeneralExam WITH (NOLOCK)
    WHERE SubSessionId = @subSessionId
    ORDER BY ID DESC
    `,
    { subSessionId },
  );
  const row = rows[0] || {};
  const systolic = firstValue(row, ['SystolicBloodPressure', 'BloodPressureHigh', 'Systolic', 'BPHigh']);
  const diastolic = firstValue(row, ['DiastolicBloodPressure', 'BloodPressureLow', 'Diastolic', 'BPLow']);
  const bloodPressure = firstValue(row, ['BloodPressure', 'BP'], '');
  return {
    pulse: cleanText(firstValue(row, ['Pulse', 'HeartRate', 'HR', 'Mach'])),
    temperature: cleanText(firstValue(row, ['Temperature', 'Temp', 'NhietDo'])),
    respiratoryRate: cleanText(firstValue(row, ['RespiratoryRate', 'BreathingRate', 'Resp', 'RR', 'NhipTho'])),
    bloodPressure: cleanText(bloodPressure || (systolic && diastolic ? `${systolic}/${diastolic}` : '')),
  };
}

async function collectNotes({ progressId, subSessionId }) {
  const rows = await optionalQuery(
    `
    SELECT *
    FROM dbo.CN_Note WITH (NOLOCK)
    WHERE TypeCde IN (2, 8)
      AND (
        ProgressId = @progressId
        OR SubSessionId = @subSessionId
      )
    ORDER BY ID DESC
    `,
    { progressId, subSessionId },
  );
  const clinical = rows.find((row) => Number(row.TypeCde) === 8);
  const advice = rows.find((row) => Number(row.TypeCde) === 2);
  return {
    clinical: stripNotePrefix(firstValue(clinical, ['Note', 'Content', 'Text', 'Description', 'Value']), 'Lâm sàng'),
    advice: cleanText(firstValue(advice, ['Note', 'Content', 'Text', 'Description', 'Value'])),
  };
}

async function collectManagementFallback(sessionId) {
  const rows = await optionalQuery(
    `
    SELECT TOP 1 *
    FROM dbo.ViewProgressNote WITH (NOLOCK)
    WHERE SessionId = @sessionId
    `,
    { sessionId },
  );
  return cleanText(firstValue(rows[0], ['Management', 'Advice', 'Note']));
}

function mapMedication(row, index) {
  const itemName = cleanText(firstValue(row, ['ItemName', 'Name', 'Item', 'ITEM']));
  const property = cleanText(firstValue(row, ['Property', 'Ingredient', 'ActiveIngredient']));
  const note = cleanText(firstValue(row, ['Note', 'UsageNote', 'Comment', 'Reason', 'REASON']));
  const instructions = cleanText(firstValue(row, ['Instructions', 'INSTRUCTIONS', 'Instruction', 'Usage', 'CachDung']));
  const dose = cleanText(firstValue(row, ['Dosage', 'Dose', 'DOSE', 'QuantityUsage']));
  const doseUnit = cleanText(firstValue(row, ['UnitUsage', 'UsageUnitName', 'DoseUnitName', 'UnitName']));
  const frequency = cleanText(firstValue(row, ['Frequency', 'FREQUENCY', 'FrequencyName', 'TimesPerDay']));
  const quantity = cleanText(firstValue(row, ['Quantity', 'QUANTITY', 'Qty', 'Amount']));
  const unit = cleanText(firstValue(row, ['UnitName', 'UNITNAME', 'Unit', 'InventoryUnitName']));
  return {
    index,
    rxId: numOrNull(row.ID),
    scriptNo: cleanText(row.ScriptNo),
    itemName,
    property,
    note,
    quantity,
    unit,
    dose,
    doseUnit: doseUnit || unit,
    frequency: frequency ? `${frequency} lần/ngày` : '',
    instructions,
  };
}

async function collectMedications({ sessionId, progressId, subSessionId, doctorId }) {
  const rows = await db.query(
    `
    SELECT
      rx.*,
      pr.ID AS PrescriptionRowId,
      pr.ScriptNo
    FROM dbo.ViewRX rx WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1 ID, ScriptNo
      FROM dbo.CN_Prescription pr WITH (NOLOCK)
      WHERE pr.RxId = rx.ID
        AND pr.DeletedDate IS NULL
      ORDER BY pr.ID DESC
    ) pr
    WHERE rx.DeletedDate IS NULL
      AND rx.SessionId = @sessionId
      AND (
        rx.ProgressID = @progressId
        OR (
          (rx.ProgressID IS NULL OR rx.ProgressID = 0)
          AND rx.SubSessionId = @subSessionId
          AND (rx.DoctorId = @doctorId OR @doctorId IS NULL)
        )
      )
    ORDER BY rx.CreatedDate ASC, rx.ID ASC
    `,
    { sessionId, progressId, subSessionId, doctorId },
  );
  const seen = new Set();
  return rows
    .filter((row) => {
      const id = numOrNull(row.ID);
      if (id == null) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((row, index) => mapMedication(row, index + 1));
}

function medicationBlock(items) {
  return items.map((item) => {
    const amount = [item.quantity, item.unit].filter(Boolean).join(' ');
    const top = [`${item.index}/`, amount].filter(Boolean).join(' ');
    const note = item.note || (item.property ? `(${item.property})` : '');
    const dose = [item.dose, item.doseUnit].filter(Boolean).join(' ');
    const doseLine = [
      item.frequency ? `Ngày ${item.frequency}` : '',
      dose ? `mỗi lần ${dose}` : '',
    ].filter(Boolean).join(', ');
    return [top, item.itemName, note, doseLine, item.instructions].filter(Boolean).join('\n');
  }).join('\n\n');
}

function buildBackConclusion(data) {
  return [
    'Tiền căn:',
    '',
    'Lâm sàng:',
    data.LamSang || '',
    'CLS bất thường:',
    'Chẩn đoán:',
    data.ChanDoan || '',
    'Hướng điều trị và các chế độ tiếp theo:',
    data.Advice || '',
  ].join('\n').trim();
}

function buildTemplateData(base, extras) {
  const date = formatDateParts(base.visitDate);
  const diagnosis = cleanText(base.mainDisease || extras.pathologyFallback);
  const doctor = compactDoctor(extras.doctorQualification, base.doctorName);
  const data = {
    So: String(base.progressId),
    SO: String(base.progressId),
    MaPhieu: progressBarcode(base.progressId),
    Barcode: `*${progressBarcode(base.progressId)}*`,
    MaBN: base.fileNum,
    PatientID: base.fileNum,
    PatientBarcode: `*${base.fileNum}*`,
    PatientName: base.patientName,
    Address: base.address,
    Dtb: birthYear(base.dob),
    G: normalizeSex(base.sex),
    BHYT: base.cardCode,
    Conclusion: diagnosis,
    ChanDoan: diagnosis,
    LamSang: extras.notes.clinical,
    LoiDan: extras.notes.advice || extras.managementFallback,
    Advice: extras.notes.advice || extras.managementFallback,
    HR: extras.exam.pulse,
    Temp: extras.exam.temperature,
    BP: extras.exam.bloodPressure,
    RR: extras.exam.respiratoryRate,
    Date: date.day,
    Month: date.month,
    Mont: date.month,
    Year: date.year,
    Doctor: doctor,
    MedicationBlock: medicationBlock(extras.medications),
    medications: extras.medications,
  };
  data.BackConclusion = buildBackConclusion(data);
  return data;
}

async function collectPrescriptionData(options) {
  const progresses = await collectPrescriptionProgresses(options);
  const results = [];
  for (const progress of progresses) {
    const [personDetails, doctorQualification, pathologyFallback, exam, notes, managementFallback, medications] = await Promise.all([
      collectPersonDetails(progress.patientId),
      collectDoctorQualification(progress.doctorId),
      collectPathologyFallback(progress.progressId),
      collectGeneralExam(progress.subSessionId),
      collectNotes({ progressId: progress.progressId, subSessionId: progress.subSessionId }),
      collectManagementFallback(progress.sessionId),
      collectMedications(progress),
    ]);
    Object.assign(progress, personDetails);
    results.push({
      ...progress,
      medications,
      templateData: buildTemplateData(progress, {
        doctorQualification,
        pathologyFallback,
        exam,
        notes,
        managementFallback,
        medications,
      }),
    });
  }
  return results;
}

module.exports = {
  collectPrescriptionData,
  collectPrescriptionProgresses,
  medicationBlock,
};
