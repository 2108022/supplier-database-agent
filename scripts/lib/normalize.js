'use strict';

const DEFAULT_NULL_MARKERS = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'null',
  'undefined',
]);

function normalizeWhitespace(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function normalizeLookup(value, options = {}) {
  const {
    stripDiacritics = true,
    ampersandAsAnd = true,
    keep = '',
  } = options;

  let text = normalizeWhitespace(value).toLocaleLowerCase('und');
  if (stripDiacritics) {
    text = text.normalize('NFKD').replace(/\p{M}+/gu, '');
  }
  text = text
    .replace(/[\u2010-\u2015\u2212]+/gu, '-')
    .replace(/[\u2018\u2019\u201b`´]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"');
  if (ampersandAsAnd) text = text.replace(/&/gu, ' and ');

  const keepClass = keep ? escapeForCharacterClass(keep) : '';
  text = text.replace(new RegExp(`[^\\p{L}\\p{N}${keepClass}]+`, 'gu'), ' ');
  return text.replace(/\s+/gu, ' ').trim();
}

function normalizeRegionName(value) {
  return normalizeLookup(value, { stripDiacritics: true, ampersandAsAnd: true });
}

function normalizeIdentifier(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return normalizeWhitespace(value);
}

function isBlank(value, nullMarkers = DEFAULT_NULL_MARKERS) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  return nullMarkers.has(normalizeWhitespace(value).toLocaleLowerCase('und'));
}

function canonicalizeValue(value, options = {}) {
  if (isBlank(value, options.nullMarkers || DEFAULT_NULL_MARKERS)) return null;
  if (typeof value === 'string') return normalizeWhitespace(value);
  if (Array.isArray(value)) return value.map((item) => canonicalizeValue(item, options));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return stableObject(value, options);
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function stableObject(value, options = {}) {
  if (Array.isArray(value)) return value.map((item) => canonicalizeValue(item, options));
  if (!value || typeof value !== 'object') return canonicalizeValue(value, options);

  const output = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    output[key] = canonicalizeValue(value[key], options);
  }
  return output;
}

function stableStringify(value, space = 2) {
  return JSON.stringify(stableObject(value), null, space);
}

function createCaseInsensitiveKeyMap(record) {
  const map = new Map();
  if (!record || typeof record !== 'object') return map;
  for (const key of Object.keys(record)) {
    const normalized = normalizeLookup(key, { stripDiacritics: false });
    if (!map.has(normalized)) map.set(normalized, key);
  }
  return map;
}

function getField(record, fieldSpec, fallbacks = []) {
  if (!record || typeof record !== 'object') return undefined;
  if (typeof fieldSpec === 'function') return fieldSpec(record);

  const candidates = [];
  if (Array.isArray(fieldSpec)) candidates.push(...fieldSpec);
  else if (typeof fieldSpec === 'string' && fieldSpec) candidates.push(fieldSpec);
  if (Array.isArray(fallbacks)) candidates.push(...fallbacks);
  else if (fallbacks) candidates.push(fallbacks);

  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }

  const keyMap = createCaseInsensitiveKeyMap(record);
  for (const key of candidates) {
    const actualKey = keyMap.get(normalizeLookup(key, { stripDiacritics: false }));
    if (actualKey !== undefined) return record[actualKey];
  }
  return undefined;
}

function normalizeRecord(record, fieldMap, options = {}) {
  const output = {};
  for (const canonicalField of Object.keys(fieldMap).sort((a, b) => a.localeCompare(b))) {
    output[canonicalField] = canonicalizeValue(
      getField(record, fieldMap[canonicalField]),
      options,
    );
  }
  return output;
}

function tokenize(value, options = {}) {
  const normalized = normalizeLookup(value, options);
  return normalized ? normalized.split(' ') : [];
}

function escapeForCharacterClass(value) {
  return value.replace(/[\\\]\-^]/gu, '\\$&');
}

module.exports = {
  DEFAULT_NULL_MARKERS,
  canonicalizeValue,
  createCaseInsensitiveKeyMap,
  getField,
  isBlank,
  normalizeIdentifier,
  normalizeLookup,
  normalizeRecord,
  normalizeRegionName,
  normalizeWhitespace,
  stableObject,
  stableStringify,
  tokenize,
};
