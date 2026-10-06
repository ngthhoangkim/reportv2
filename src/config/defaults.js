module.exports = {
  app: {
    port: 3000,
  },
  worker: {
    scheduleTimes: ['02:15', '14:15'],
    initialLookbackHours: 48,
    cursorOverlapMinutes: 15,
    settleSeconds: 60,
    retryLimit: 3,
  },
  cleanup: {
    intervalSeconds: 30,
    tmpStaleSeconds: 30 * 60,
    outputStaleSeconds: 10 * 60,
    logRetentionDays: 7,
  },
  db: {
    idleCloseSeconds: 30,
  },
  logging: {
    maxLinesRecent: 200,
  },
  reports: {
    outputNames: {
      full: '{fileNum}_{sessionId}_FullReport.pdf',
      cdha: '{fileNum}_{sessionId}_CDHA.pdf',
      prescription: '{fileNum}_{sessionId}_ToaThuoc.pdf',
      cnFile: '{fileNum}_{docTitle}_{docDate}.pdf',
    },
    reportTypes: ['cdha', 'cn_files', 'pacs', 'prescription'],
    cnFileKeywords: ['pap', 'hpv', 'ecg', 'liquid prep', 'pathtest', 'pathtezt'],
  },
  word: {
    timeoutMs: 180000,
    templateCacheDir: 'tmp/template-cache',
  },
};
