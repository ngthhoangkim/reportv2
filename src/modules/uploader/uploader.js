const fs = require('fs');
const path = require('path');
const { config } = require('../../config/env');
const state = require('../state/stateStore');
const logger = require('../logging/logger');

function uploadEndpoint() {
  if (!config.s3.baseUrl) return '';
  return `${config.s3.baseUrl.replace(/\/+$/, '')}/api/v1/s3/upload-multiple`;
}

async function uploadPdf(pdfPath, options = {}) {
  const endpoint = uploadEndpoint();
  if (!endpoint) {
    return { skipped: true, reason: 'S3_UPLOAD_API_BASE is empty' };
  }

  const prefix = options.prefix || config.s3.prefix;
  const buffer = await fs.promises.readFile(pdfPath);
  const form = new FormData();
  form.append('prefix', prefix);
  form.append('files', new Blob([buffer], { type: 'application/pdf' }), path.basename(pdfPath));

  try {
    const res = await fetch(endpoint, { method: 'POST', body: form });
    const text = await res.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw response body
    }
    if (!res.ok) {
      throw new Error(`Upload failed ${res.status}: ${text.slice(0, 300)}`);
    }
    logger.upload('info', 'pdf uploaded', { pdfPath, endpoint, prefix, status: res.status });
    return { ok: true, status: res.status, body };
  } catch (err) {
    const failed = {
      pdfPath,
      endpoint,
      prefix,
      error: err.message,
      retryAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    state.appendJsonl('failed-uploads.jsonl', failed);
    logger.upload('error', 'pdf upload failed', failed);
    return { ok: false, ...failed };
  }
}

async function retryFailedUploads(limit = 20) {
  const failed = state.readJsonlRecent('failed-uploads.jsonl', limit).reverse();
  const results = [];
  for (const item of failed) {
    if (item.pdfPath && fs.existsSync(item.pdfPath)) {
      results.push(await uploadPdf(item.pdfPath, { prefix: item.prefix }));
    }
  }
  return results;
}

module.exports = { uploadPdf, retryFailedUploads, uploadEndpoint };
