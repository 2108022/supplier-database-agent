'use strict';

const DEFAULT_OUTPUT_LANGUAGES = Object.freeze([0, 1, 8]);

function expandLanguageRows(records, mapper, options = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (typeof mapper !== 'function') throw new TypeError('mapper must be a function');
  const languages = [...(options.languages || DEFAULT_OUTPUT_LANGUAGES)];
  const keyStart = Number(options.keyStart || 1);
  const rows = [];
  records.forEach((record, recordIndex) => {
    const key = record.export_key ?? record.Key ?? keyStart + recordIndex;
    const logicalRows = languages.map((languageType) => ({
      ...mapper(record, languageType),
      Key: key,
      LanguageType: Number(languageType),
    }));
    assertStableRegionIds(logicalRows, record.record_id || key);
    rows.push(...logicalRows);
  });
  return rows;
}

function localizedValue(value, languageType, options = {}) {
  if (value === null || value === undefined) return options.fallback ?? '';
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const language = Number(languageType);
  const candidates = language === 0
    ? ['0', 0, 'zh', 'zh-CN', 'cn', 'local', 'default']
    : language === 8
      ? ['8', 8, 'en', '1', 1, 'en-US', 'default', '0', 0, 'zh']
      : ['1', 1, 'en', 'en-US', '8', 8, 'default', '0', 0, 'zh'];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== null && value[key] !== undefined) {
      return value[key];
    }
  }
  return options.fallback ?? '';
}

function assertStableRegionIds(rows, recordIdentity) {
  if (rows.length < 2) return;
  const fields = ['Country', 'Province', 'City'];
  for (const field of fields) {
    const values = new Set(rows.map((row) => normalizeComparable(row[field])));
    if (values.size > 1) {
      throw new Error(`Language rows changed canonical ${field} for ${recordIdentity}`);
    }
  }
}

function normalizeComparable(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

module.exports = {
  DEFAULT_OUTPUT_LANGUAGES,
  assertStableRegionIds,
  expandLanguageRows,
  localizedValue,
};
