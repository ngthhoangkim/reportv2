const zlib = require('zlib');
const iconv = require('iconv-lite');

function decodeRtfPayloadBytes(raw) {
  if (!raw || !raw.length) return '';
  let strictUtf8 = null;
  try {
    strictUtf8 = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    strictUtf8 = null;
  }
  if (strictUtf8 != null && /\{\\rtf/i.test(strictUtf8)) return strictUtf8;

  const head = raw.slice(0, Math.min(32768, raw.length)).toString('latin1');
  const cpMatch = /\\ansicpg(\d+)/i.exec(head);
  if (cpMatch) {
    const enc = { 1258: 'win1258', 1252: 'win1252', 65001: 'utf8' }[Number(cpMatch[1])];
    if (enc && iconv.encodingExists(enc)) {
      const decoded = iconv.decode(raw, enc);
      if (/\{\\rtf/i.test(decoded)) return decoded;
    }
  }

  if (iconv.encodingExists('win1258')) {
    const decoded = iconv.decode(raw, 'win1258');
    if (/\{\\rtf/i.test(decoded)) return decoded;
  }
  return raw.toString('utf8');
}

function decompressToString(buffer) {
  if (!buffer) return '';
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!buf.length) return '';
  try {
    return decodeRtfPayloadBytes(zlib.gunzipSync(buf));
  } catch {
    return decodeRtfPayloadBytes(buf);
  }
}

function findBalancedBraceEnd(s, openIdx) {
  if (!s || openIdx < 0 || s[openIdx] !== '{') return -1;
  let depth = 0;
  for (let i = openIdx; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripRtfHeaderGroups(rtf) {
  let s = String(rtf || '');
  const triggers = ['\\fonttbl', '\\colortbl', '\\stylesheet', '\\filetbl', '\\listtable', '\\listoverridetable', '\\rsidtbl', '\\generator', '\\info'];
  for (let guard = 0; guard < 200; guard += 1) {
    let bestStart = -1;
    let bestPos = -1;
    for (const kw of triggers) {
      const pos = s.indexOf(kw);
      if (pos < 0) continue;
      let start = pos;
      while (start > 0 && s[start] !== '{') start -= 1;
      if (s[start] !== '{') continue;
      if (bestPos < 0 || pos < bestPos) {
        bestPos = pos;
        bestStart = start;
      }
    }
    if (bestStart < 0) break;
    const end = findBalancedBraceEnd(s, bestStart);
    if (end < 0) break;
    s = `${s.slice(0, bestStart)} ${s.slice(end + 1)}`;
  }
  return s;
}

function fallbackRtfToPlainText(rtfText) {
  return stripRtfHeaderGroups(rtfText)
    .replace(/\r\n/g, '\n')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\par[d]?\s*/gi, '\n')
    .replace(/\\line\s*/gi, '\n')
    .replace(/\\tab/g, ' ')
    .replace(/\\u(-?\d+)\s*\?/g, (_, n) => {
      const code = Number(n);
      try {
        return String.fromCodePoint(code < 0 ? 65536 + code : code);
      } catch {
        return '';
      }
    })
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function rtfBufferToPlain(buffer) {
  const rtf = decompressToString(buffer);
  return rtf ? fallbackRtfToPlainText(rtf) : '';
}

module.exports = { decompressToString, fallbackRtfToPlainText, rtfBufferToPlain };
