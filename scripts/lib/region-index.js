'use strict';

const {
  getField,
  normalizeIdentifier,
  normalizeLookup,
  normalizeRegionName,
  normalizeWhitespace,
} = require('./normalize');

const DEFAULT_REGION_FIELDS = Object.freeze({
  id: ['id', 'ID', 'RegionID', 'RegionId'],
  name: ['name', 'Name', 'RegionName'],
  level: ['level', 'Level', 'RegionLevel'],
  parentId: ['parentid', 'ParentId', 'ParentID', 'parent_id'],
  areaCode: ['areacode', 'AreaCode', 'area_code'],
  languageType: ['languagetype', 'LanguageType', 'language_type'],
  internalPrimaryKey: [
    'internalprimarykey',
    'InternalPrimaryKey',
    'internal_primary_key',
    'Key',
  ],
});

const DEFAULT_LANGUAGE_PRIORITY = Object.freeze(['0', '1', '8']);

function buildRegionIndex(rows, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Region rows must be an array');

  const fields = { ...DEFAULT_REGION_FIELDS, ...(options.fields || {}) };
  const languagePriority = (options.languagePriority || DEFAULT_LANGUAGE_PRIORITY)
    .map(normalizeIdentifier);
  const rootParentValues = new Set(
    (options.rootParentValues || ['', '0', '-1', 'null'])
      .map((value) => normalizeIdentifier(value).toLocaleLowerCase('und')),
  );
  const issues = [];

  const localizedRows = rows.map((source, rowIndex) => {
    const id = normalizeIdentifier(getField(source, fields.id));
    const name = normalizeWhitespace(getField(source, fields.name));
    const level = normalizeIdentifier(getField(source, fields.level));
    const parentId = normalizeIdentifier(getField(source, fields.parentId));
    const areaCode = normalizeIdentifier(getField(source, fields.areaCode));
    const languageType = normalizeIdentifier(getField(source, fields.languageType));
    const internalPrimaryKey = normalizeIdentifier(
      getField(source, fields.internalPrimaryKey),
    );

    if (!id) issues.push(issue('MISSING_REGION_ID', rowIndex, { name }));
    if (!name) issues.push(issue('MISSING_REGION_NAME', rowIndex, { id }));

    return {
      id,
      name,
      normalizedName: normalizeRegionName(name),
      level,
      parentId,
      areaCode,
      languageType,
      internalPrimaryKey,
      rowIndex,
      source,
    };
  });

  const grouped = new Map();
  for (const row of localizedRows) {
    const groupKey = row.internalPrimaryKey || (row.id ? `id:${row.id}` : `row:${row.rowIndex}`);
    pushMapArray(grouped, groupKey, row);
  }

  const canonicalRecords = [];
  const byInternalPrimaryKey = new Map();
  const groupByVariantId = new Map();

  for (const [groupKey, variants] of grouped) {
    variants.sort((left, right) => {
      const leftPriority = languageRank(left.languageType, languagePriority);
      const rightPriority = languageRank(right.languageType, languagePriority);
      return leftPriority - rightPriority || left.rowIndex - right.rowIndex;
    });

    const preferred = variants[0];
    const distinctIds = uniqueNonBlank(variants.map((row) => row.id));
    const distinctParents = uniqueNonBlank(variants.map((row) => row.parentId));
    const distinctLevels = uniqueNonBlank(variants.map((row) => row.level));
    const distinctAreaCodes = uniqueNonBlank(variants.map((row) => row.areaCode));

    // Localized rows may legitimately have different physical row IDs. The
    // internal primary key is the language-independent database identity.
    if (distinctParents.length > 1) {
      issues.push(issue('INCONSISTENT_LOCALIZED_PARENT', preferred.rowIndex, {
        internalPrimaryKey: preferred.internalPrimaryKey,
        parentIds: distinctParents,
      }));
    }
    if (distinctLevels.length > 1) {
      issues.push(issue('INCONSISTENT_LOCALIZED_LEVEL', preferred.rowIndex, {
        internalPrimaryKey: preferred.internalPrimaryKey,
        levels: distinctLevels,
      }));
    }

    const canonical = {
      id: preferred.internalPrimaryKey || preferred.id || distinctIds[0] || '',
      name: preferred.name,
      normalizedName: preferred.normalizedName,
      level: preferred.level || distinctLevels[0] || '',
      parentId: preferred.parentId || distinctParents[0] || '',
      rawParentId: preferred.parentId || distinctParents[0] || '',
      areaCode: preferred.areaCode || distinctAreaCodes[0] || '',
      languageType: preferred.languageType,
      internalPrimaryKey: preferred.internalPrimaryKey || groupKey,
      variantIds: uniqueNonBlank([preferred.internalPrimaryKey, ...distinctIds]),
      names: Object.fromEntries(
        variants
          .filter((row) => row.languageType && row.name)
          .map((row) => [row.languageType, row.name]),
      ),
      variants,
      source: preferred.source,
    };
    canonicalRecords.push(canonical);
    if (preferred.internalPrimaryKey) {
      byInternalPrimaryKey.set(preferred.internalPrimaryKey, canonical);
    }
    for (const id of distinctIds) pushUniqueMap(groupByVariantId, id, canonical);
  }

  const groupByCanonicalId = new Map();
  for (const record of canonicalRecords) {
    if (!record.id) continue;
    if (groupByCanonicalId.has(record.id) && groupByCanonicalId.get(record.id) !== record) {
      issues.push(issue('DUPLICATE_CANONICAL_ID', record.variants[0].rowIndex, {
        id: record.id,
      }));
    } else {
      groupByCanonicalId.set(record.id, record);
    }
  }

  for (const record of canonicalRecords) {
    const rawParentId = record.rawParentId;
    if (!rawParentId || rootParentValues.has(rawParentId.toLocaleLowerCase('und'))) {
      record.parentId = '';
      continue;
    }

    const parent = chooseOne(groupByVariantId.get(rawParentId))
      || groupByCanonicalId.get(rawParentId)
      || byInternalPrimaryKey.get(rawParentId);
    if (!parent) {
      issues.push(issue('MISSING_PARENT', record.variants[0].rowIndex, {
        id: record.id,
        parentId: rawParentId,
      }));
      record.parentId = rawParentId;
    } else {
      record.parentId = parent.id;
    }
  }

  const byId = new Map();
  const byParent = new Map();
  const byAreaCode = new Map();
  const byNormalizedName = new Map();

  for (const record of canonicalRecords) {
    for (const id of uniqueNonBlank([record.id, ...record.variantIds])) {
      if (!byId.has(id)) byId.set(id, record);
    }
    if (record.parentId) pushUniqueMap(byParent, record.parentId, record);
    if (record.areaCode) pushUniqueMap(byAreaCode, normalizeAreaCode(record.areaCode), record);
    for (const variant of record.variants) {
      if (variant.normalizedName) {
        pushUniqueMap(byNormalizedName, variant.normalizedName, record);
      }
      if (variant.areaCode) {
        pushUniqueMap(byAreaCode, normalizeAreaCode(variant.areaCode), record);
      }
    }
  }

  const index = {
    type: 'region-index',
    fields,
    languagePriority,
    rootParentValues: [...rootParentValues],
    sourceRows: rows,
    localizedRows,
    canonicalRecords,
    byId,
    byParent,
    byAreaCode,
    byNormalizedName,
    byInternalPrimaryKey,
    issues,
  };

  for (const record of canonicalRecords) {
    const chain = getParentChain(record.id, index);
    if (chain.status === 'CYCLE') {
      issues.push(issue('PARENT_CYCLE', record.variants[0].rowIndex, {
        id: record.id,
        path: chain.ids,
      }));
    }
  }
  return index;
}

function matchRegion(query, index, options = {}) {
  assertRegionIndex(index);
  if (!query || typeof query !== 'object') {
    return regionResult('UNRESOLVED', [], ['EMPTY_REGION_QUERY']);
  }

  const requestedId = normalizeIdentifier(query.id ?? query.regionId);
  if (requestedId) {
    const record = index.byId.get(requestedId)
      || index.byInternalPrimaryKey.get(requestedId);
    if (!record) return regionResult('UNRESOLVED', [], ['UNKNOWN_REGION_ID']);
    const parentCheck = checkRequestedParent(record, query, index, options);
    if (!parentCheck.ok) return regionResult('INVALID_PARENT', [record], [parentCheck.reason]);
    return regionResult('RESOLVED', [record], [], record);
  }

  const names = asArray(query.name ?? query.names)
    .map(normalizeRegionName)
    .filter(Boolean);
  const areaCode = normalizeAreaCode(query.areaCode);
  let candidates = [];

  for (const name of names) {
    candidates.push(...(index.byNormalizedName.get(name) || []));
  }
  if (!names.length && areaCode) candidates.push(...(index.byAreaCode.get(areaCode) || []));
  candidates = uniqueRecords(candidates);

  if (areaCode) {
    const areaCandidates = new Set(index.byAreaCode.get(areaCode) || []);
    candidates = candidates.filter((candidate) => areaCandidates.has(candidate));
  }

  const requestedLevel = normalizeIdentifier(query.level);
  if (requestedLevel) {
    const normalizedLevel = normalizeLookup(requestedLevel);
    candidates = candidates.filter(
      (candidate) => normalizeLookup(candidate.level) === normalizedLevel,
    );
  }

  const requestedParent = normalizeIdentifier(query.parentId ?? query.parentRegionId);
  if (requestedParent) {
    const canonicalParentId = canonicalizeRegionId(requestedParent, index);
    candidates = candidates.filter((candidate) => {
      if (candidate.parentId === canonicalParentId) return true;
      if (!options.allowAncestorParent) return false;
      const chain = getParentChain(candidate.id, index);
      return chain.ids.includes(canonicalParentId);
    });
  }

  if (!candidates.length) return regionResult('UNRESOLVED', [], ['NO_REGION_MATCH']);
  if (candidates.length > 1) {
    return regionResult('AMBIGUOUS', candidates, ['MULTIPLE_REGION_MATCHES']);
  }
  return regionResult('RESOLVED', candidates, [], candidates[0]);
}

function resolveRegionHierarchy(parts, index, options = {}) {
  assertRegionIndex(index);
  if (!Array.isArray(parts) || !parts.length) {
    return {
      status: 'UNRESOLVED',
      matches: [],
      failedAt: 0,
      reasons: ['EMPTY_REGION_HIERARCHY'],
    };
  }

  const matches = [];
  let previous = null;
  for (let position = 0; position < parts.length; position += 1) {
    const part = { ...parts[position] };
    if (previous && !part.parentId && !part.parentRegionId) part.parentId = previous.id;
    const result = matchRegion(part, index, options);
    if (result.status !== 'RESOLVED') {
      return {
        status: result.status,
        matches,
        failedAt: position,
        reasons: result.reasons,
        candidates: result.candidates,
      };
    }
    previous = result.record;
    matches.push(result.record);
  }

  return {
    status: 'RESOLVED',
    matches,
    canonicalIds: matches.map((record) => record.id),
    leaf: matches[matches.length - 1],
    reasons: [],
  };
}

function getParentChain(regionId, index) {
  assertRegionIndex(index);
  const startId = canonicalizeRegionId(regionId, index);
  const records = [];
  const ids = [];
  const seen = new Set([startId]);
  let current = index.byId.get(startId);

  while (current && current.parentId) {
    const parentId = canonicalizeRegionId(current.parentId, index);
    ids.push(parentId);
    if (seen.has(parentId)) return { status: 'CYCLE', ids, records };
    seen.add(parentId);
    const parent = index.byId.get(parentId);
    if (!parent) return { status: 'MISSING_PARENT', ids, records };
    records.push(parent);
    current = parent;
  }
  return { status: 'VALID', ids, records };
}

function validateParentChain(regionId, expectedAncestorIds, index, options = {}) {
  const chain = getParentChain(regionId, index);
  if (chain.status !== 'VALID') return { valid: false, ...chain };

  const expected = asArray(expectedAncestorIds)
    .map((id) => canonicalizeRegionId(id, index))
    .filter(Boolean);
  const actualRootToParent = [...chain.ids].reverse();
  const ordered = options.ordered !== false;
  let valid;
  if (ordered) {
    valid = isOrderedSubsequence(expected, actualRootToParent);
  } else {
    valid = expected.every((id) => actualRootToParent.includes(id));
  }
  if (options.exact) valid = valid && arraysEqual(expected, actualRootToParent);
  return {
    valid,
    status: valid ? 'VALID' : 'PARENT_MISMATCH',
    expected,
    actual: actualRootToParent,
    records: chain.records,
  };
}

function canonicalizeRegionId(value, index) {
  const id = normalizeIdentifier(value);
  if (!id) return '';
  return index.byId.get(id)?.id
    || index.byInternalPrimaryKey.get(id)?.id
    || id;
}

function serializeRegionIndex(index) {
  assertRegionIndex(index);
  return {
    sourceRows: index.sourceRows,
    options: {
      fields: index.fields,
      languagePriority: index.languagePriority,
      rootParentValues: index.rootParentValues,
    },
  };
}

function deserializeRegionIndex(payload) {
  if (!payload || !Array.isArray(payload.sourceRows)) {
    throw new TypeError('Invalid serialized region index');
  }
  return buildRegionIndex(payload.sourceRows, payload.options || {});
}

function checkRequestedParent(record, query, index, options) {
  const requestedParent = normalizeIdentifier(query.parentId ?? query.parentRegionId);
  if (!requestedParent) return { ok: true };
  const canonicalParentId = canonicalizeRegionId(requestedParent, index);
  if (record.parentId === canonicalParentId) return { ok: true };
  if (options.allowAncestorParent) {
    const chain = getParentChain(record.id, index);
    if (chain.ids.includes(canonicalParentId)) return { ok: true };
  }
  return { ok: false, reason: 'REGION_PARENT_MISMATCH' };
}

function normalizeAreaCode(value) {
  return normalizeIdentifier(value).toLocaleLowerCase('und');
}

function regionResult(status, candidates, reasons, record = null) {
  return {
    status,
    record,
    canonicalId: record?.id || null,
    canonicalName: record?.name || null,
    candidates,
    reasons,
  };
}

function pushMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function pushUniqueMap(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function uniqueRecords(records) {
  return [...new Set(records)];
}

function uniqueNonBlank(values) {
  return [...new Set(values.filter(Boolean))];
}

function chooseOne(values) {
  return Array.isArray(values) && values.length === 1 ? values[0] : null;
}

function languageRank(value, priority) {
  const rank = priority.indexOf(normalizeIdentifier(value));
  return rank === -1 ? priority.length : rank;
}

function issue(code, rowIndex, details = {}) {
  return { code, rowIndex, ...details };
}

function asArray(value) {
  if (value === null || value === undefined || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function isOrderedSubsequence(expected, actual) {
  let cursor = 0;
  for (const item of actual) {
    if (expected[cursor] === item) cursor += 1;
  }
  return cursor === expected.length;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function assertRegionIndex(index) {
  if (!index || index.type !== 'region-index') {
    throw new TypeError('Expected an index created by buildRegionIndex');
  }
}

module.exports = {
  DEFAULT_LANGUAGE_PRIORITY,
  DEFAULT_REGION_FIELDS,
  buildRegionIndex,
  canonicalizeRegionId,
  deserializeRegionIndex,
  getParentChain,
  matchRegion,
  resolveRegionHierarchy,
  serializeRegionIndex,
  validateParentChain,
};
