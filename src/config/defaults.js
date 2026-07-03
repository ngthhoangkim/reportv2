module.exports = {
  app: {
    port: 3000,
  },
  worker: {
    pollSeconds: 30,
    lookbackHours: 48,
    retryLimit: 3,
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
