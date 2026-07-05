function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstValue(row, names, fallback = '') {
  if (!row) return fallback;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && row[name] != null && row[name] !== '') {
      return row[name];
    }
  }
  return fallback;
}

function formatDateParts(value) {
  const d = value ? new Date(value) : new Date();
  if (!Number.isFinite(d.getTime())) return formatDateParts(new Date());
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: String(d.getMonth() + 1).padStart(2, '0'),
    year: String(d.getFullYear()),
  };
}

function birthYear(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isFinite(d.getTime())) return String(d.getFullYear());
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : '';
}

function normalizeSex(value) {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return '';
  if (raw === 'f' || raw === 'female' || raw.includes('nữ') || raw.includes('nu')) return 'Nữ';
  if (raw === 'm' || raw === 'male' || raw.includes('nam')) return 'Nam';
  return cleanText(value);
}

function progressBarcode(progressId) {
  return `G${String(progressId).padStart(8, '0')}`;
}

function compactDoctor(qualification, doctorName) {
  const q = cleanText(qualification);
  const d = cleanText(doctorName);
  if (!q) return d;
  if (!d) return q;
  if (d.toLowerCase().startsWith(q.toLowerCase())) return d;
  return `${q}. ${d}`.replace(/\.\./g, '.');
}

function stripNotePrefix(value, prefix) {
  const text = cleanText(value);
  if (!text) return '';
  return text.replace(new RegExp(`^\\s*${prefix}\\s*:?\\s*`, 'i'), '').trim();
}

module.exports = {
  cleanText,
  numOrNull,
  firstValue,
  formatDateParts,
  birthYear,
  normalizeSex,
  progressBarcode,
  compactDoctor,
  stripNotePrefix,
};
