const { config } = require('../config/env');

let pool = null;
let sqlModule = null;

const WRITE_SQL_RE = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|BACKUP|RESTORE)\b/i;
const SELECT_INTO_RE = /\bSELECT\b[\s\S]*\bINTO\b/i;

function assertReadOnly(query) {
  const q = String(query || '').replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (WRITE_SQL_RE.test(q) || SELECT_INTO_RE.test(q)) {
    throw new Error('SQL write/admin statements are blocked in reportv2');
  }
}

function getSqlModule() {
  if (sqlModule) return sqlModule;
  if (config.db.authMode === 'windows') {
    sqlModule = require('mssql/msnodesqlv8');
  } else {
    sqlModule = require('mssql');
  }
  return sqlModule;
}

function boolText(value) {
  return value ? 'yes' : 'no';
}

function buildWindowsConnectionString() {
  return [
    'Driver={ODBC Driver 17 for SQL Server}',
    `Server=${config.db.server},${config.db.port}`,
    `Database=${config.db.database}`,
    'Trusted_Connection=Yes',
    `Encrypt=${boolText(config.db.encrypt)}`,
    `TrustServerCertificate=${boolText(config.db.trustServerCertificate)}`,
  ].join(';');
}

function buildSqlLoginConfig() {
  return {
    server: config.db.server,
    port: config.db.port,
    database: config.db.database,
    authentication: {
      type: 'default',
      options: {
        userName: config.db.user,
        password: config.db.password,
      },
    },
    options: {
      encrypt: config.db.encrypt,
      trustServerCertificate: config.db.trustServerCertificate,
      connectTimeout: config.db.connectTimeoutMs,
      requestTimeout: config.db.requestTimeoutMs,
    },
  };
}

function buildConfig() {
  if (config.db.authMode === 'windows') {
    return {
      connectionString: buildWindowsConnectionString(),
      options: {
        trustedConnection: true,
        connectTimeout: config.db.connectTimeoutMs,
        requestTimeout: config.db.requestTimeoutMs,
      },
    };
  }
  return buildSqlLoginConfig();
}

async function getPool() {
  if (!pool) {
    const sql = getSqlModule();
    pool = await new sql.ConnectionPool(buildConfig()).connect();
  }
  return pool;
}

function bindParams(request, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value);
  }
  return request;
}

async function query(text, params = {}) {
  assertReadOnly(text);
  const p = await getPool();
  const result = await bindParams(p.request(), params).query(text);
  return result.recordset || [];
}

async function queryAll(text, params = {}) {
  assertReadOnly(text);
  const p = await getPool();
  const result = await bindParams(p.request(), params).query(text);
  return result.recordsets || [];
}

async function healthCheck() {
  const rows = await query('SELECT DB_NAME() AS databaseName, @@SERVERNAME AS serverName');
  return rows[0] || null;
}

async function close() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

module.exports = { query, queryAll, healthCheck, close, assertReadOnly, buildConfig };
