const db = require('../../db/sqlServer');

function mapCandidate(row) {
  return {
    fileNum: row.FileNum != null ? String(row.FileNum).trim() : '',
    sessionId: row.SessionId == null ? null : Number(row.SessionId),
    progressId: row.ProgressId == null ? null : Number(row.ProgressId),
    source: row.Source,
    lastChangedAt: row.LastChangedAt ? new Date(row.LastChangedAt).toISOString() : null,
  };
}

function upperBound(predicate, toDate) {
  return toDate ? `AND ${predicate} <= @toDate` : '';
}

async function collectCandidatesSince(fromDate, types = null, toDate = null) {
  const enabled = new Set(types && types.length ? types : ['cdha', 'cn_files', 'prescription']);
  const queries = [];

  if (enabled.has('cdha') || enabled.has('pacs')) {
    const changedAt = 'COALESCE(r.UpdatedDate, r.FinishDate, r.CreatedDate)';
    queries.push(`
      SELECT DISTINCT
        v.FileNum,
        v.SessionId,
        NULL AS ProgressId,
        'cdha' AS Source,
        MAX(COALESCE(r.UpdatedDate, r.FinishDate, r.CreatedDate)) AS LastChangedAt
      FROM dbo.CN_ImagingResult r WITH (NOLOCK)
      INNER JOIN dbo.ViewImagingResult v WITH (NOLOCK) ON v.Id = r.Id
      WHERE r.DeletedDate IS NULL
        AND ${changedAt} >= @fromDate
        ${upperBound(changedAt, toDate)}
      GROUP BY v.FileNum, v.SessionId
    `);
  }

  if (enabled.has('cn_files')) {
    const changedAt = 'COALESCE(f.UpdatedDate, f.CreatedDate, f.DateEntered, f.DocDate)';
    queries.push(`
      SELECT DISTINCT
        p.FileNum,
        ss.SessionId,
        NULL AS ProgressId,
        'cn_files' AS Source,
        MAX(COALESCE(f.UpdatedDate, f.CreatedDate, f.DateEntered, f.DocDate)) AS LastChangedAt
      FROM dbo.CN_FILES f WITH (NOLOCK)
      INNER JOIN dbo.CR_Patient p WITH (NOLOCK) ON p.ContactId = f.PatientID
      LEFT JOIN dbo.CR_SubSession ss WITH (NOLOCK) ON ss.Id = f.SubSessionId
      WHERE f.DeletedDate IS NULL
        AND ${changedAt} >= @fromDate
        ${upperBound(changedAt, toDate)}
      GROUP BY p.FileNum, ss.SessionId
    `);
  }

  if (enabled.has('prescription')) {
    queries.push(`
      SELECT DISTINCT
        p.FileNum,
        rx.SessionId,
        rx.ProgressID AS ProgressId,
        'prescription' AS Source,
        MAX(rx.CreatedDate) AS LastChangedAt
      FROM dbo.ViewRX rx WITH (NOLOCK)
      INNER JOIN dbo.CR_Patient p WITH (NOLOCK) ON p.ContactId = rx.PatientID
      WHERE rx.DeletedDate IS NULL
        AND rx.CreatedDate >= @fromDate
        ${upperBound('rx.CreatedDate', toDate)}
      GROUP BY p.FileNum, rx.SessionId, rx.ProgressID
    `);
  }

  if (!queries.length) return [];
  const sql = queries.join('\nUNION ALL\n');
  const params = toDate ? { fromDate, toDate } : { fromDate };
  const rows = await db.query(sql, params);
  const seen = new Map();
  for (const row of rows.map(mapCandidate).filter((r) => r.fileNum)) {
    const key = row.source === 'prescription'
      ? `${row.source}::${row.fileNum}::${row.sessionId == null ? 'all' : row.sessionId}::${row.progressId == null ? 'all' : row.progressId}`
      : `${row.fileNum}::${row.sessionId == null ? 'all' : row.sessionId}`;
    const prev = seen.get(key);
    if (!prev || String(row.lastChangedAt || '') > String(prev.lastChangedAt || '')) {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values());
}

module.exports = { collectCandidatesSince };
