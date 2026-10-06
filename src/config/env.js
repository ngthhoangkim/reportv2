const path = require('path');
require('dotenv').config();
const defaults = require('./defaults');

function envString(key, fallback = '') {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return String(raw).trim();
}

function envBool(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return String(raw).toLowerCase().trim() === 'true';
}

function envNumber(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolvePath(value, fallback) {
  const p = envString(value, fallback);
  if (!p) return '';
  return path.isAbsolute(p) || /^\\\\/.test(p) ? p : path.resolve(process.cwd(), p);
}

const config = {
  db: {
    authMode: envString('DB_AUTH_MODE', 'sql').toLowerCase(),
    server: envString('DB_SERVER', 'localhost'),
    port: envNumber('DB_PORT', 1433),
    database: envString('DB_DATABASE', 'Hospital_NM'),
    user: envString('DB_USER', ''),
    password: envString('DB_PASSWORD', ''),
    encrypt: envBool('DB_ENCRYPT', true),
    trustServerCertificate: envBool('DB_TRUST_SERVER_CERTIFICATE', true),
    connectTimeoutMs: envNumber('DB_CONNECT_TIMEOUT_MS', 15000),
    requestTimeoutMs: envNumber('DB_REQUEST_TIMEOUT_MS', 120000),
    idleCloseSeconds: envNumber('DB_IDLE_CLOSE_SECONDS', defaults.db.idleCloseSeconds),
  },
  app: {
    port: envNumber('APP_PORT', envNumber('PORT', defaults.app.port)),
  },
  paths: {
    sourceImageDir: resolvePath('PATHS_SOURCE_IMAGE_DIR', path.join(process.cwd(), 'img')),
    fallbackImageDir: resolvePath('PATHS_FALLBACK_IMAGE_DIR', path.join(process.cwd(), 'documents2')),
    localImageDir: resolvePath('PATHS_LOCAL_IMAGE_DIR', path.join(process.cwd(), 'Documents')),
    templates: resolvePath('PATHS_TEMPLATES', path.join(process.cwd(), 'Templates')),
    output: resolvePath('PATHS_OUTPUT', path.join(process.cwd(), 'output')),
    stateDir: path.join(process.cwd(), 'data', 'state'),
    logsDir: path.join(process.cwd(), 'logs'),
    tmpDir: path.join(process.cwd(), 'tmp'),
  },
  s3: {
    baseUrl: envString('S3_UPLOAD_API_BASE', ''),
    prefix: envString('S3_UPLOAD_PREFIX', 'khambenh/'),
    cleanupAfterUpload: envBool('CLEANUP_AFTER_UPLOAD', true),
  },
  worker: {
    enabled: envBool('WORKER_ENABLED', true),
    scheduleTimes: envString('WORKER_SCHEDULE_TIMES', defaults.worker.scheduleTimes.join(','))
      .split(/[;,|]/)
      .map((s) => s.trim())
      .filter(Boolean),
    pollSeconds: envNumber('WORKER_POLL_SECONDS', 0),
    initialLookbackHours: envNumber('WORKER_INITIAL_LOOKBACK_HOURS', defaults.worker.initialLookbackHours),
    cursorOverlapMinutes: envNumber('WORKER_CURSOR_OVERLAP_MINUTES', defaults.worker.cursorOverlapMinutes),
    settleSeconds: envNumber('WORKER_SETTLE_SECONDS', defaults.worker.settleSeconds),
    retryLimit: defaults.worker.retryLimit,
  },
  cleanup: {
    intervalSeconds: envNumber('CLEANUP_INTERVAL_SECONDS', defaults.cleanup.intervalSeconds),
    tmpStaleSeconds: envNumber('CLEANUP_TMP_STALE_SECONDS', defaults.cleanup.tmpStaleSeconds),
    outputStaleSeconds: envNumber('CLEANUP_OUTPUT_STALE_SECONDS', defaults.cleanup.outputStaleSeconds),
    logRetentionDays: envNumber('LOG_RETENTION_DAYS', defaults.cleanup.logRetentionDays),
  },
  word: {
    timeoutMs: envNumber('WORD_CONVERT_TIMEOUT_MS', defaults.word.timeoutMs),
  },
  media: {
    printedImagesOnly: envBool('PRINTED_IMAGES_ONLY', true),
    pacsFetchTimeoutMs: envNumber('PACS_FETCH_TIMEOUT_MS', 45000),
    generateCnFiles: envBool('GENERATE_CN_FILES', true),
    includeCnFilesHistory: envBool('INCLUDE_CN_FILES_HISTORY', false),
  },
  prescription: {
    templateFront: resolvePath('PRESCRIPTION_TEMPLATE_FRONT', path.join(process.cwd(), 'Templates', 'ToaThuocV2', 'TT_MAT_1.doc')),
    templateBack: resolvePath('PRESCRIPTION_TEMPLATE_BACK', path.join(process.cwd(), 'Templates', 'ToaThuocV2', 'TT_MAT_2.doc')),
    outputDir: resolvePath('PRESCRIPTION_OUTPUT_DIR', path.join(process.cwd(), 'output', 'prescriptions')),
    s3Prefix: envString('PRESCRIPTION_S3_PREFIX', 'khambenh/toathuoc/'),
  },
  archives: {
    passwords: envString('CN_FILES_ZIP_PASSWORDS', envString('CN_FILES_ZIP_PASSWORD', ''))
      .split(/[;,|]/)
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

module.exports = { config, envString, envBool, envNumber };
