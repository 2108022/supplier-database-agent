'use strict';

const {
  getField,
  normalizeIdentifier,
  normalizeLookup,
  normalizeWhitespace,
  tokenize,
} = require('./normalize');

const DEFAULT_SUPPLIER_FIELDS = Object.freeze({
  id: ['SupplierID', 'SupplierId', 'supplier_id', 'ID', 'id', 'InternalPrimaryKey'],
  name: ['SupplierName', 'supplier_name', 'CompanyName', 'name'],
  recordType: ['RecordType', 'record_type', 'EntityType', 'SupplierType'],
  dataType: ['DataType', 'datatype', 'data_type'],
  regionId: ['RegionID', 'RegionId', 'region_id', 'CityID', 'CityId'],
  countryId: ['CountryID', 'CountryId', 'country_id', 'LocationCountryID', 'LocationCountry'],
  provinceId: ['ProvinceID', 'ProvinceId', 'province_id'],
  cityId: ['CityID', 'CityId', 'city_id'],
  countryName: ['Country', 'LocationCountry', 'CountryName'],
  provinceName: ['Province', 'State', 'FirstAdministrativeDivision'],
  cityName: ['City', 'CityName', 'SecondAdministrativeDivision'],
  products: ['MainProduct', 'MainProducts', 'Product', 'Products', 'MainProductsEN'],
});

const DEFAULT_INPUT_FIELDS = Object.freeze({
  recordId: ['record_id', 'RecordID', 'RecordId', 'id'],
  name: ['StandardSiteName', 'SupplierName', 'CompanyName', 'LegalEntityName', 'name'],
  legalEntityName: ['LegalEntityName', 'ParentLegalEntity', 'CompanyName'],
  parentSupplierId: ['ParentSupplierID', 'ParentSupplierId', 'parent_supplier_id'],
  recordType: ['RecordType', 'record_type', 'EntityType'],
  isAdditionalSite: ['IsAdditionalSite', 'is_additional_site', 'AdditionalSite'],
  regionId: ['RegionID', 'RegionId', 'region_id', 'CityID', 'CityId'],
  countryId: ['CountryID', 'CountryId', 'country_id', 'LocationCountryID', 'LocationCountry'],
  provinceId: ['ProvinceID', 'ProvinceId', 'province_id'],
  cityId: ['CityID', 'CityId', 'city_id'],
  countryName: ['Country', 'LocationCountry', 'CountryName'],
  provinceName: ['Province', 'State', 'FirstAdministrativeDivision'],
  cityName: ['City', 'CityName', 'SecondAdministrativeDivision'],
  products: [
    'SimplifiedProduct',
    'DetailedProduct',
    'MainProduct',
    'MainProducts',
    'SimplifiedR&DScope',
    'DetailedR&DScope',
  ],
});

const DEFAULT_ALIAS_FIELDS = Object.freeze({
  alias: ['Alias', 'alias', 'SourceName', 'ExternalName', 'StandardSiteName'],
  supplierId: ['SupplierID', 'SupplierId', 'supplier_id', 'ResolvedSupplierID'],
  supplierName: ['SupplierName', 'supplier_name', 'ResolvedSupplierName', 'CanonicalName'],
  recordType: ['RecordType', 'record_type'],
  status: ['Status', 'status', 'Decision'],
});

const DEFAULT_REVIEW_FIELDS = Object.freeze({
  sourceName: ['SourceName', 'ExternalName', 'StandardSiteName', 'SupplierName', 'name'],
  supplierId: ['ResolvedSupplierID', 'MatchedSupplierID', 'SupplierID', 'SupplierId'],
  supplierName: ['ResolvedSupplierName', 'MatchedSupplierName', 'CanonicalName'],
  decision: ['Decision', 'ReviewDecision', 'Status', 'MatchStatus'],
  recordType: ['RecordType', 'record_type'],
});

const LEGAL_SUFFIXES = new Set([
  'ag', 'as', 'bv', 'co', 'company', 'corp', 'corporation', 'gmbh', 'inc',
  'incorporated', 'kg', 'kgaa', 'limited', 'llc', 'llp', 'ltd', 'nv', 'oy',
  'plc', 'pte', 'pty', 'sa', 'sas', 'spa', 'srl', 'the',
]);

const NON_DISTINCTIVE_TOKENS = new Set([
  ...LEGAL_SUFFIXES,
  'and', 'auto', 'automotive', 'automobile', 'automobiles', 'branch',
  'center', 'centre', 'component', 'components', 'division', 'engineering',
  'enterprise', 'enterprises', 'factory', 'global', 'group', 'industrial',
  'industries', 'industry', 'international', 'manufacturing', 'motor', 'motors',
  'part', 'parts', 'plant', 'product', 'products', 'research', 'site', 'solution',
  'solutions', 'system', 'systems', 'technology', 'technologies',
]);

const POSITIVE_REVIEW_DECISIONS = new Set([
  'accepted', 'approved', 'confirmed', 'match', 'matched', 'yes',
]);

const NEGATIVE_REVIEW_DECISIONS = new Set([
  'different entity', 'no', 'no match', 'not matched', 'rejected',
]);

function buildSupplierIndex(rows, options = {}) {
  if (!Array.isArray(rows)) throw new TypeError('Supplier rows must be an array');
  const fields = { ...DEFAULT_SUPPLIER_FIELDS, ...(options.fields || {}) };
  const recordTypeMap = options.recordTypeMap || {};
  const issues = [];

  const entries = rows.map((source, rowIndex) => {
    const rawName = getField(source, fields.name);
    // supplierName is deliberately not trimmed or rewritten. It is the exact
    // value that must be emitted after a confirmed master-data match.
    const supplierName = rawName === null || rawName === undefined ? '' : String(rawName);
    const id = normalizeIdentifier(getField(source, fields.id)) || `row:${rowIndex}`;
    const normalizedName = normalizeLookup(supplierName);
    const coreName = normalizeEntityCore(supplierName);
    const locationNames = readLocationNames(source, fields);
    const locationTokens = new Set(locationNames.flatMap((value) => tokenize(value)));
    const distinctiveTokens = getDistinctiveTokens(supplierName, locationTokens);
    const allNameTokens = tokenize(supplierName);
    const acronym = makeAcronym(allNameTokens);
    const recordType = normalizeRecordType(
      getField(source, fields.recordType),
      getField(source, fields.dataType),
      recordTypeMap,
    );

    if (!supplierName) issues.push({ code: 'MISSING_SUPPLIER_NAME', rowIndex, id });
    return {
      id,
      supplierName,
      normalizedName,
      coreName,
      recordType,
      dataType: getField(source, fields.dataType),
      regionIds: readRegionIds(source, fields),
      regionHierarchy: readRegionHierarchy(source, fields),
      locationNames,
      locationTokens,
      products: normalizeLookup(getField(source, fields.products)),
      productTokens: new Set(tokenize(getField(source, fields.products))),
      distinctiveTokens,
      acronym,
      rowIndex,
      source,
    };
  });

  const index = {
    type: 'supplier-index',
    fields,
    recordTypeMap,
    sourceRows: rows,
    entries,
    byId: new Map(),
    byExactName: new Map(),
    byCoreName: new Map(),
    byToken: new Map(),
    byAcronym: new Map(),
    byAlias: new Map(),
    reviewedPositive: new Map(),
    reviewedNegative: new Set(),
    issues,
    hookStats: {
      aliasesRead: 0,
      aliasesConnected: 0,
      reviewRowsRead: 0,
      reviewRowsConnected: 0,
    },
  };

  for (const entry of entries) {
    if (!index.byId.has(entry.id)) index.byId.set(entry.id, entry);
    else issues.push({ code: 'DUPLICATE_SUPPLIER_ID', rowIndex: entry.rowIndex, id: entry.id });
    if (entry.normalizedName) pushUniqueMap(index.byExactName, entry.normalizedName, entry);
    if (entry.coreName) pushUniqueMap(index.byCoreName, entry.coreName, entry);
    for (const token of entry.distinctiveTokens) pushUniqueMap(index.byToken, token, entry);
    if (entry.acronym.length >= 2) pushUniqueMap(index.byAcronym, entry.acronym, entry);
  }

  attachSupplierAliases(index, options.aliases || [], options.aliasFields);
  attachReviewedHistory(index, options.reviewHistory || [], options.reviewFields);
  return index;
}

function attachSupplierAliases(index, aliases, fieldOverrides = {}) {
  assertSupplierIndex(index);
  if (!Array.isArray(aliases)) throw new TypeError('Supplier aliases must be an array');
  const fields = { ...DEFAULT_ALIAS_FIELDS, ...(fieldOverrides || {}) };

  for (const [rowIndex, row] of aliases.entries()) {
    index.hookStats.aliasesRead += 1;
    const alias = normalizeLookup(getField(row, fields.alias));
    const status = normalizeLookup(getField(row, fields.status));
    if (!alias || (status && NEGATIVE_REVIEW_DECISIONS.has(status))) continue;
    const targets = findHookTargets(row, fields, index);
    if (targets.length !== 1) {
      index.issues.push({
        code: targets.length ? 'AMBIGUOUS_ALIAS_TARGET' : 'UNKNOWN_ALIAS_TARGET',
        hook: 'alias',
        rowIndex,
        alias,
      });
      continue;
    }
    pushUniqueMap(index.byAlias, alias, targets[0]);
    index.hookStats.aliasesConnected += 1;
  }
  return index;
}

function attachReviewedHistory(index, history, fieldOverrides = {}) {
  assertSupplierIndex(index);
  if (!Array.isArray(history)) throw new TypeError('Reviewed history must be an array');
  const fields = { ...DEFAULT_REVIEW_FIELDS, ...(fieldOverrides || {}) };

  for (const [rowIndex, row] of history.entries()) {
    index.hookStats.reviewRowsRead += 1;
    const sourceName = normalizeLookup(getField(row, fields.sourceName));
    const decision = normalizeLookup(getField(row, fields.decision));
    if (!sourceName || !decision) continue;
    const targets = findHookTargets(row, fields, index);

    if (POSITIVE_REVIEW_DECISIONS.has(decision)) {
      if (targets.length !== 1) {
        index.issues.push({
          code: targets.length ? 'AMBIGUOUS_REVIEW_TARGET' : 'UNKNOWN_REVIEW_TARGET',
          hook: 'review-history',
          rowIndex,
          sourceName,
        });
        continue;
      }
      pushUniqueMap(index.reviewedPositive, sourceName, targets[0]);
      index.hookStats.reviewRowsConnected += 1;
      continue;
    }

    if (NEGATIVE_REVIEW_DECISIONS.has(decision)) {
      for (const target of targets) {
        index.reviewedNegative.add(rejectionKey(sourceName, target.id));
        index.hookStats.reviewRowsConnected += 1;
      }
    }
  }
  return index;
}

function matchSupplier(record, index, options = {}) {
  assertSupplierIndex(index);
  const fields = { ...DEFAULT_INPUT_FIELDS, ...(options.fields || {}) };
  const query = prepareQuery(record, fields, index.recordTypeMap);
  const thresholds = {
    automatic: options.automaticThreshold ?? 0.78,
    review: options.reviewThreshold ?? 0.6,
    ambiguityDelta: options.ambiguityDelta ?? 0.08,
    fuzzyName: options.fuzzyNameThreshold ?? 0.76,
  };

  if (!query.normalizedName) {
    return reviewDecision(query, [], ['MISSING_TARGET_NAME']);
  }

  const candidates = new Map();
  addCandidates(candidates, index.reviewedPositive.get(query.normalizedName), 'reviewed', 1);
  addCandidates(candidates, index.byAlias.get(query.normalizedName), 'alias', 0.99);
  addCandidates(candidates, index.byExactName.get(query.normalizedName), 'exact', 1);

  if (!query.isSite) {
    addCandidates(candidates, index.byCoreName.get(query.coreName), 'core', 0.96);
  }

  if (query.acronym.length >= 2) {
    addCandidates(candidates, index.byAcronym.get(query.acronym), 'acronym', 0.91);
  }
  if (query.allNameTokens.length === 1 && query.allNameTokens[0].length >= 2) {
    addCandidates(candidates, index.byAcronym.get(query.allNameTokens[0]), 'acronym', 0.91);
  }
  for (const token of query.distinctiveTokens) {
    addCandidates(candidates, index.byToken.get(token), 'fuzzy', 0);
  }

  const scored = [];
  const blocked = [];
  for (const [entry, evidence] of candidates) {
    if (index.reviewedNegative.has(rejectionKey(query.normalizedName, entry.id))) {
      blocked.push(candidateSummary(entry, evidence, 'REVIEWED_AS_DIFFERENT_ENTITY'));
      continue;
    }
    const guard = siteParentGuard(query, entry);
    if (!guard.allowed) {
      blocked.push(candidateSummary(entry, evidence, guard.reason));
      continue;
    }

    const nameScore = Math.max(
      evidence.nameScore,
      calculateNameScore(query, entry),
    );
    const region = calculateRegionScore(query, entry);
    const productScore = jaccard(query.productTokens, entry.productTokens);
    const sharedDistinctiveTokens = intersection(
      query.distinctiveTokens,
      entry.distinctiveTokens,
    );
    const explicit = evidence.methods.has('reviewed') || evidence.methods.has('alias');
    const exact = evidence.methods.has('exact');
    const acronym = evidence.methods.has('acronym');
    const identityGate = explicit
      || exact
      || (acronym && (region.score > 0 || productScore > 0))
      || (nameScore >= thresholds.fuzzyName && sharedDistinctiveTokens.size > 0);
    const score = clamp(
      (nameScore * 0.72) + (Math.max(0, region.score) * 0.18) + (productScore * 0.1),
      0,
      1,
    );
    const qualified = identityGate
      && !region.conflict
      && (explicit || exact || score >= thresholds.automatic);

    scored.push({
      entry,
      methods: [...evidence.methods],
      nameScore,
      regionScore: region.score,
      regionConflict: region.conflict,
      productScore,
      sharedDistinctiveTokens: [...sharedDistinctiveTokens],
      score,
      qualified,
    });
  }

  scored.sort((left, right) => right.score - left.score || left.entry.rowIndex - right.entry.rowIndex);
  const qualified = scored.filter((candidate) => candidate.qualified);

  if (qualified.length) {
    const top = qualified[0];
    const runnerUp = qualified[1];
    if (runnerUp && top.score - runnerUp.score < thresholds.ambiguityDelta) {
      return reviewDecision(query, scored, ['AMBIGUOUS_SUPPLIER_IDENTITY'], blocked);
    }
    return matchedDecision(query, top, blocked);
  }

  if (scored[0] && scored[0].score >= thresholds.review) {
    return reviewDecision(query, scored, ['INSUFFICIENT_ENTITY_IDENTITY'], blocked);
  }
  return newSupplierDecision(
    query,
    scored,
    blocked.length ? ['NO_SITE_LEVEL_MATCH', 'SITE_PARENT_DOWNGRADE_BLOCKED'] : ['NO_SUPPLIER_MATCH'],
    blocked,
  );
}

function matchSuppliers(records, index, options = {}) {
  if (!Array.isArray(records)) throw new TypeError('Supplier match input must be an array');
  return records.map((record) => ({
    record,
    decision: matchSupplier(record, index, options),
  }));
}

function prepareQuery(record, fields, recordTypeMap) {
  const rawName = getField(record, fields.name);
  const name = rawName === null || rawName === undefined ? '' : String(rawName);
  const legalEntityName = normalizeWhitespace(getField(record, fields.legalEntityName));
  const recordType = normalizeRecordType(getField(record, fields.recordType), null, recordTypeMap);
  const locationNames = readLocationNames(record, fields);
  const locationTokens = new Set(locationNames.flatMap((value) => tokenize(value)));
  const allNameTokens = tokenize(name);
  const rawAdditional = getField(record, fields.isAdditionalSite);
  const isSite = recordType === 'PLANT_SITE' || recordType === 'RND_SITE';

  return {
    record,
    recordId: normalizeIdentifier(getField(record, fields.recordId)),
    name,
    normalizedName: normalizeLookup(name),
    coreName: normalizeEntityCore(name),
    legalEntityName,
    normalizedLegalEntityName: normalizeLookup(legalEntityName),
    parentSupplierId: normalizeIdentifier(getField(record, fields.parentSupplierId)),
    recordType,
    isSite,
    isAdditionalSite: isSite || isTruthy(rawAdditional),
    regionIds: readRegionIds(record, fields),
    regionHierarchy: readRegionHierarchy(record, fields),
    locationNames,
    locationTokens,
    products: normalizeLookup(getField(record, fields.products)),
    productTokens: new Set(tokenize(getField(record, fields.products))),
    distinctiveTokens: getDistinctiveTokens(name, locationTokens),
    allNameTokens,
    acronym: makeAcronym(allNameTokens),
  };
}

function siteParentGuard(query, candidate) {
  if (!query.isAdditionalSite) return { allowed: true };
  if (query.parentSupplierId && candidate.id === query.parentSupplierId) {
    return { allowed: false, reason: 'SITE_PARENT_SUPPLIER_ID_BLOCKED' };
  }
  if (candidate.recordType === 'LEGAL_ENTITY') {
    return { allowed: false, reason: 'SITE_TO_LEGAL_ENTITY_BLOCKED' };
  }
  if (
    query.normalizedLegalEntityName
    && candidate.normalizedName === query.normalizedLegalEntityName
    && query.normalizedName !== query.normalizedLegalEntityName
  ) {
    return { allowed: false, reason: 'SITE_PARENT_NAME_BLOCKED' };
  }
  return { allowed: true };
}

function matchedDecision(query, candidate, blocked) {
  return {
    status: 'MATCHED',
    MatchStatus: 'MATCHED',
    NeedNewSupplier: 'NO',
    RecordType: query.recordType || null,
    record_id: query.recordId || null,
    MatchedSupplierID: candidate.entry.id,
    MatchedSupplierName: candidate.entry.supplierName,
    SupplierName: candidate.entry.supplierName,
    confidence: candidate.score,
    evidence: candidate.methods,
    candidate: publicCandidate(candidate),
    blockedCandidates: blocked,
    reasons: [],
  };
}

function newSupplierDecision(query, scored, reasons, blocked = []) {
  return {
    status: 'NEW',
    MatchStatus: 'NEW',
    NeedNewSupplier: 'YES',
    RecordType: query.recordType || null,
    record_id: query.recordId || null,
    MatchedSupplierID: null,
    MatchedSupplierName: null,
    SupplierName: query.name,
    confidence: null,
    candidates: scored.slice(0, 5).map(publicCandidate),
    blockedCandidates: blocked,
    reasons,
  };
}

function reviewDecision(query, scored, reasons, blocked = []) {
  return {
    status: 'REVIEW_REQUIRED',
    MatchStatus: 'REVIEW_REQUIRED',
    NeedNewSupplier: 'REVIEW_REQUIRED',
    QAStatus: 'REVIEW_REQUIRED',
    RecordType: query.recordType || null,
    record_id: query.recordId || null,
    MatchedSupplierID: null,
    MatchedSupplierName: null,
    SupplierName: query.name,
    confidence: scored[0]?.score ?? null,
    candidates: scored.slice(0, 5).map(publicCandidate),
    blockedCandidates: blocked,
    reasons,
  };
}

function publicCandidate(candidate) {
  return {
    SupplierID: candidate.entry.id,
    SupplierName: candidate.entry.supplierName,
    RecordType: candidate.entry.recordType || null,
    score: candidate.score,
    nameScore: candidate.nameScore,
    regionScore: candidate.regionScore,
    productScore: candidate.productScore,
    evidence: candidate.methods,
  };
}

function candidateSummary(entry, evidence, reason) {
  return {
    SupplierID: entry.id,
    SupplierName: entry.supplierName,
    RecordType: entry.recordType || null,
    evidence: [...evidence.methods],
    reason,
  };
}

function calculateNameScore(query, entry) {
  if (query.normalizedName === entry.normalizedName) return 1;
  if (!query.isSite && query.coreName && query.coreName === entry.coreName) return 0.96;
  if (
    (query.acronym && query.acronym === entry.acronym)
    || (query.allNameTokens.length === 1 && query.allNameTokens[0] === entry.acronym)
  ) return 0.91;
  return Math.max(
    jaccard(query.distinctiveTokens, entry.distinctiveTokens),
    diceCoefficient(query.normalizedName, entry.normalizedName),
  );
}

function calculateRegionScore(query, entry) {
  const fields = ['countryId', 'provinceId', 'cityId', 'regionId'];
  let comparable = 0;
  let matching = 0;
  for (const field of fields) {
    const left = query.regionHierarchy?.[field] || '';
    const right = entry.regionHierarchy?.[field] || '';
    if (!left || !right) continue;
    comparable += 1;
    if (left !== right) return { score: -1, conflict: true };
    matching += 1;
  }
  if (comparable) return { score: matching / comparable, conflict: false };
  if (!query.regionIds.size || !entry.regionIds.size) return { score: 0, conflict: false };
  const same = intersection(query.regionIds, entry.regionIds).size > 0;
  return { score: same ? 0.5 : -1, conflict: !same };
}

function normalizeRecordType(rawType, rawDataType, recordTypeMap = {}) {
  const candidates = [rawType, rawDataType]
    .map((value) => normalizeLookup(value).replace(/\s+/gu, '_'))
    .filter(Boolean);
  for (const candidate of candidates) {
    const configured = recordTypeMap[candidate]
      || recordTypeMap[normalizeIdentifier(rawType)]
      || recordTypeMap[normalizeIdentifier(rawDataType)];
    if (configured) return normalizeRecordType(configured, null, {});
    if (['legal', 'legal_entity', 'entity', 'company'].includes(candidate)) return 'LEGAL_ENTITY';
    if (['plant', 'plant_site', 'production_base', 'production_site'].includes(candidate)) return 'PLANT_SITE';
    if (['r_d_site', 'rd_site', 'rnd_site', 'r_and_d_site', 'research_center'].includes(candidate)) {
      return 'RND_SITE';
    }
  }
  return '';
}

function normalizeEntityCore(value) {
  return tokenize(value).filter((token) => !LEGAL_SUFFIXES.has(token)).join(' ');
}

function getDistinctiveTokens(value, locationTokens = new Set()) {
  return new Set(
    tokenize(value).filter(
      (token) => token.length > 1
        && !NON_DISTINCTIVE_TOKENS.has(token)
        && !locationTokens.has(token),
    ),
  );
}

function makeAcronym(tokens) {
  const meaningful = tokens.filter((token) => token.length && !LEGAL_SUFFIXES.has(token) && token !== 'and');
  if (meaningful.length < 2) return '';
  return meaningful.map((token) => token[0]).join('');
}

function readRegionIds(record, fields) {
  const values = [fields.regionId, fields.countryId, fields.provinceId, fields.cityId]
    .map((field) => normalizeIdentifier(getField(record, field)))
    .filter(Boolean);
  return new Set(values);
}

function readRegionHierarchy(record, fields) {
  return {
    regionId: normalizeIdentifier(getField(record, fields.regionId)),
    countryId: normalizeIdentifier(getField(record, fields.countryId)),
    provinceId: normalizeIdentifier(getField(record, fields.provinceId)),
    cityId: normalizeIdentifier(getField(record, fields.cityId)),
  };
}

function readLocationNames(record, fields) {
  return [fields.countryName, fields.provinceName, fields.cityName]
    .map((field) => normalizeWhitespace(getField(record, field)))
    .filter(Boolean);
}

function findHookTargets(row, fields, index) {
  const supplierId = normalizeIdentifier(getField(row, fields.supplierId));
  if (supplierId && index.byId.has(supplierId)) return [index.byId.get(supplierId)];
  const supplierName = normalizeLookup(getField(row, fields.supplierName));
  return supplierName ? [...(index.byExactName.get(supplierName) || [])] : [];
}

function addCandidates(target, entries, method, nameScore) {
  for (const entry of entries || []) {
    if (!target.has(entry)) target.set(entry, { methods: new Set(), nameScore: 0 });
    const evidence = target.get(entry);
    evidence.methods.add(method);
    evidence.nameScore = Math.max(evidence.nameScore, nameScore);
  }
}

function pushUniqueMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function rejectionKey(sourceName, supplierId) {
  return `${sourceName}\u0000${supplierId}`;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  const shared = intersection(left, right).size;
  return shared / (left.size + right.size - shared);
}

function intersection(left, right) {
  const result = new Set();
  for (const value of left) if (right.has(value)) result.add(value);
  return result;
}

function diceCoefficient(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (!leftPairs.size || !rightPairs.size) return 0;
  let shared = 0;
  const remaining = new Map(rightPairs);
  for (const [pair, count] of leftPairs) {
    const matching = Math.min(count, remaining.get(pair) || 0);
    shared += matching;
    if (matching) remaining.set(pair, (remaining.get(pair) || 0) - matching);
  }
  const leftCount = [...leftPairs.values()].reduce((sum, count) => sum + count, 0);
  const rightCount = [...rightPairs.values()].reduce((sum, count) => sum + count, 0);
  return (2 * shared) / (leftCount + rightCount);
}

function bigrams(value) {
  const compact = normalizeLookup(value).replace(/\s+/gu, ' ');
  const output = new Map();
  for (let index = 0; index < compact.length - 1; index += 1) {
    const pair = compact.slice(index, index + 2);
    output.set(pair, (output.get(pair) || 0) + 1);
  }
  return output;
}

function isTruthy(value) {
  return value === true || ['1', 'true', 'yes', 'y'].includes(normalizeLookup(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function assertSupplierIndex(index) {
  if (!index || index.type !== 'supplier-index') {
    throw new TypeError('Expected an index created by buildSupplierIndex');
  }
}

function serializeSupplierIndex(index) {
  assertSupplierIndex(index);
  return {
    sourceRows: index.sourceRows,
    aliases: flattenAliasIndex(index.byAlias),
    reviewHistory: flattenReviewIndex(index),
    options: {
      fields: index.fields,
      recordTypeMap: index.recordTypeMap,
    },
  };
}

function deserializeSupplierIndex(payload) {
  if (!payload || !Array.isArray(payload.sourceRows)) {
    throw new TypeError('Invalid serialized supplier index');
  }
  return buildSupplierIndex(payload.sourceRows, {
    ...(payload.options || {}),
    aliases: payload.aliases || [],
    reviewHistory: payload.reviewHistory || [],
  });
}

function flattenAliasIndex(byAlias) {
  const rows = [];
  for (const [alias, entries] of byAlias) {
    for (const entry of entries) rows.push({ Alias: alias, SupplierID: entry.id });
  }
  return rows;
}

function flattenReviewIndex(index) {
  const rows = [];
  for (const [sourceName, entries] of index.reviewedPositive) {
    for (const entry of entries) {
      rows.push({ SourceName: sourceName, SupplierID: entry.id, Decision: 'MATCHED' });
    }
  }
  return rows;
}

module.exports = {
  DEFAULT_ALIAS_FIELDS,
  DEFAULT_INPUT_FIELDS,
  DEFAULT_REVIEW_FIELDS,
  DEFAULT_SUPPLIER_FIELDS,
  attachReviewedHistory,
  attachSupplierAliases,
  buildSupplierIndex,
  deserializeSupplierIndex,
  matchSupplier,
  matchSuppliers,
  normalizeEntityCore,
  normalizeRecordType,
  serializeSupplierIndex,
};
