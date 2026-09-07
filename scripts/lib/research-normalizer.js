'use strict';

const crypto = require('node:crypto');

const { getField, normalizeLookup, normalizeWhitespace } = require('./normalize');
const { normalizeRecordType } = require('./supplier-index');

function normalizeResearchArtifact(artifact, options = {}) {
  if (!artifact || typeof artifact !== 'object') throw new TypeError('research artifact must be an object');
  const company = normalizeWhitespace(artifact.company || options.company);
  if (!company) throw new Error('research.json must contain company');
  if (!Array.isArray(artifact.records)) throw new Error('research.json must contain records[]');
  const seen = new Set();
  const records = artifact.records.map((record, index) => {
    const normalized = normalizeResearchRecord(record, { company, index });
    if (seen.has(normalized.record_id)) {
      throw new Error(`Duplicate normalized record_id: ${normalized.record_id}`);
    }
    seen.add(normalized.record_id);
    return normalized;
  });
  return {
    artifact_type: 'normalized',
    schema_version: 1,
    company,
    generated_at: new Date().toISOString(),
    source_generated_at: artifact.generated_at || null,
    records,
  };
}

function normalizeResearchRecord(record, context = {}) {
  if (!record || typeof record !== 'object') throw new TypeError('research record must be an object');
  const issues = [...asArray(record.issues)];
  const dataset = normalizeDataset(first(record, [
    'dataset', 'Dataset', 'DataSet', 'record_dataset', 'RecordDataset', 'FacilityDataset',
  ]), record);
  const legalEntityName = normalizeWhitespace(first(record, [
    'legal_entity_name', 'LegalEntityName', 'ParentLegalEntity', 'OperatingLegalEntity',
  ]));
  if (!legalEntityName) issues.push(issue('MISSING_LEGAL_ENTITY_NAME', 'Legal entity is required'));

  const suppliedSiteName = normalizeWhitespace(first(record, [
    'standard_site_name', 'StandardSiteName', 'ProBaseName', 'RdCenterName',
    'R&D Center Name', 'RDCenterName', 'site_name', 'SiteName', 'FacilityName',
  ]));
  let recordType = normalizeRecordType(first(record, [
    'record_type', 'RecordType', 'EntityType', 'FacilityType',
  ]));
  if (!recordType) {
    recordType = inferRecordType(dataset, legalEntityName, suppliedSiteName);
    issues.push(issue('RECORD_TYPE_INFERRED', `RecordType inferred as ${recordType}; confirm during review`, 'WARNING'));
  }

  const explicitAdditional = first(record, ['is_additional_site', 'IsAdditionalSite', 'AdditionalSite']);
  const isAdditionalSite = explicitAdditional === undefined || explicitAdditional === null
    ? (recordType === 'PLANT_SITE' || recordType === 'RND_SITE')
    : truthy(explicitAdditional);
  const standardSiteName = buildStandardSiteName({
    legalEntityName,
    suppliedSiteName,
    recordType,
    isAdditionalSite,
  });
  if (!standardSiteName) issues.push(issue('MISSING_STANDARD_SITE_NAME', 'StandardSiteName could not be built'));

  const geography = normalizeGeography(record);
  if (!geography.country.name && !geography.country.id) {
    issues.push(issue('MISSING_COUNTRY', 'Country is required for region mapping'));
  }
  const localized = normalizeLocalized(record, standardSiteName);
  const companyName = normalizeWhitespace(first(record, [
    'company_name', 'CompanyName', 'group_name', 'GroupName', 'Group',
  ])) || context.company;
  const sources = asArray(first(record, ['sources', 'Sources', 'Source']))
    .map(normalizeSource)
    .filter(Boolean);
  const sourceStatus = normalizeWhitespace(first(record, ['status', 'Status', 'QAStatus']));
  if (normalizeLookup(sourceStatus).includes('review required')) {
    issues.push(issue('SOURCE_REVIEW_REQUIRED', 'Research stage marked this record for review'));
  }

  const identity = {
    company: context.company,
    dataset,
    recordType,
    legalEntityName,
    standardSiteName,
    address: normalizeWhitespace(first(record, ['address', 'Address', 'DetailedAddress', 'StreetAddress'])),
    country: geography.country.id || geography.country.name,
    province: geography.province.id || geography.province.name,
    city: geography.city.id || geography.city.name,
  };
  const suppliedRecordId = normalizeWhitespace(first(record, ['record_id', 'RecordID', 'RecordId']));
  const recordId = suppliedRecordId || deterministicRecordId(identity);

  return {
    record_id: recordId,
    dataset,
    record_type: recordType,
    company_name: companyName,
    group_name: normalizeWhitespace(first(record, ['group_name', 'GroupName', 'Group'])) || companyName,
    legal_entity_name: legalEntityName,
    parent_legal_entity: normalizeWhitespace(first(record, ['parent_legal_entity', 'ParentLegalEntity'])) || legalEntityName,
    standard_site_name: standardSiteName,
    supplied_site_name: suppliedSiteName || null,
    is_additional_site: isAdditionalSite,
    is_independent_legal_entity: normalizeOptionalBoolean(first(record, [
      'is_independent_legal_entity', 'IsIndependentLegalEntity', 'SeparateLegalEntity',
    ])),
    address: identity.address || null,
    geography,
    localized,
    sources,
    evidence_level: normalizeWhitespace(first(record, ['evidence_level', 'EvidenceLevel'])) || null,
    source_status: sourceStatus || null,
    remark: normalizeWhitespace(first(record, ['remark', 'Remark', 'Notes'])) || null,
    issues,
  };
}

function normalizeDataset(raw, record) {
  const value = normalizeLookup(raw).replace(/\s+/gu, '_');
  if (['production_base', 'production', 'plant', 'factory'].includes(value)) return 'PRODUCTION_BASE';
  if (['rnd_center', 'rd_center', 'r_d_center', 'research_center', 'research_and_development'].includes(value)) {
    return 'RND_CENTER';
  }
  const keys = Object.keys(record).map((key) => normalizeLookup(key));
  if (keys.some((key) => /rd|r d|research/.test(key))) return 'RND_CENTER';
  if (keys.some((key) => /probase|production|plant|factory/.test(key))) return 'PRODUCTION_BASE';
  throw new Error(`Unrecognized dataset: ${raw ?? ''}`);
}

function inferRecordType(dataset, legalEntityName, siteName) {
  const same = normalizeLookup(legalEntityName) && normalizeLookup(legalEntityName) === normalizeLookup(siteName);
  if (!siteName || same) return 'LEGAL_ENTITY';
  return dataset === 'RND_CENTER' ? 'RND_SITE' : 'PLANT_SITE';
}

function buildStandardSiteName({ legalEntityName, suppliedSiteName, recordType, isAdditionalSite }) {
  if (recordType === 'LEGAL_ENTITY' || !isAdditionalSite) return legalEntityName || suppliedSiteName;
  if (!suppliedSiteName) return legalEntityName;
  const legalNormalized = normalizeLookup(legalEntityName);
  const siteNormalized = normalizeLookup(suppliedSiteName);
  if (!legalEntityName || siteNormalized === legalNormalized || siteNormalized.startsWith(`${legalNormalized} `)) {
    return suppliedSiteName;
  }
  return `${legalEntityName}-${suppliedSiteName}`;
}

function normalizeGeography(record) {
  const nested = record.geography && typeof record.geography === 'object' ? record.geography : {};
  return {
    country: geographyPart(nested.country, first(record, ['Country', 'LocationCountry', 'country']), first(record, [
      'CountryID', 'CountryId', 'LocationCountryID', 'location_country_id',
    ]), first(record, ['CountryLevel', 'country_level']) || 2),
    province: geographyPart(nested.province || nested.first_administrative_division, first(record, [
      'Province', 'FirstAdministrativeDivision', 'State', 'province',
    ]), first(record, ['ProvinceID', 'ProvinceId', 'province_id']), first(record, ['ProvinceLevel', 'province_level']) || 3),
    city: geographyPart(nested.city || nested.second_administrative_division, first(record, [
      'City', 'SecondAdministrativeDivision', 'city',
    ]), first(record, ['CityID', 'CityId', 'city_id']), first(record, ['CityLevel', 'city_level']) || 4),
    area: geographyPart(nested.area || nested.third_administrative_division, first(record, [
      'Area', 'ThirdAdministrativeDivision', 'District', 'area',
    ]), first(record, ['AreaID', 'AreaId', 'area_id']), first(record, ['AreaLevel', 'area_level']) || 5),
    detailed_address: normalizeWhitespace(
      nested.detailed_address
      || nested.address
      || first(record, ['DetailedAddress', 'StreetAddress', 'Address', 'address']),
    ) || null,
    post_code: normalizeWhitespace(nested.post_code || first(record, ['PostCode', 'PostalCode'])) || null,
  };
}

function geographyPart(nested, flatName, flatId, defaultLevel) {
  const object = nested && typeof nested === 'object' ? nested : {};
  let name = object.name ?? object.value ?? flatName;
  let id = object.id ?? object.region_id ?? flatId;
  if (!id && looksNumericId(name)) {
    id = name;
    name = '';
  }
  return {
    name: normalizeWhitespace(name) || null,
    id: normalizeWhitespace(id) || null,
    area_code: normalizeWhitespace(object.area_code ?? object.areacode) || null,
    level: normalizeWhitespace(object.level ?? defaultLevel) || null,
  };
}

function normalizeLocalized(record, standardSiteName) {
  const nested = record.localized && typeof record.localized === 'object'
    ? record.localized
    : record.localized_names && typeof record.localized_names === 'object'
      ? { site_name: record.localized_names }
      : {};
  const site = normalizeLanguageMap(nested.site_name || nested.names || {
    0: first(record, ['SiteNameCN', 'ProBaseNameCN', 'RdCenterNameCN', 'NameCN']),
    1: first(record, ['SiteNameEN', 'ProBaseNameEN', 'RdCenterNameEN', 'NameEN']),
    8: first(record, ['SiteNameENUS', 'NameENUS']),
  }, standardSiteName);
  const products = normalizeLanguageMap(nested.main_product || nested.products || {
    0: first(record, ['SimplifiedProductCN', 'MainProductCN', 'SimplifiedProduct', 'MainProduct']),
    1: first(record, ['SimplifiedProductEN', 'MainProductEN', 'DetailedProductEN']),
    8: first(record, ['MainProductENUS']),
  }, '');
  const rdContent = normalizeLanguageMap(nested.rd_content || nested.rd_scope || {
    0: first(record, ['SimplifiedR&DScopeCN', 'RDContentCN', 'SimplifiedR&DScope', 'RDContent']),
    1: first(record, ['SimplifiedR&DScopeEN', 'RDContentEN', 'DetailedR&DScopeEN']),
    8: first(record, ['RDContentENUS']),
  }, '');
  return { site_name: site, main_product: products, rd_content: rdContent };
}

function normalizeLanguageMap(value, fallback) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : { 0: value };
  const zh = normalizeWhitespace(input[0] ?? input['0'] ?? input.zh ?? input.cn ?? input.local ?? fallback);
  const en = normalizeWhitespace(input[1] ?? input['1'] ?? input.en ?? input['en-US'] ?? input[8] ?? input['8'] ?? zh);
  const enUs = normalizeWhitespace(input[8] ?? input['8'] ?? input['en-US'] ?? en);
  return { 0: zh || fallback || '', 1: en || zh || fallback || '', 8: enUs || en || zh || fallback || '' };
}

function deterministicRecordId(identity) {
  const prefix = identity.dataset === 'RND_CENTER' ? 'rd' : 'pb';
  const normalized = Object.keys(identity).sort().map((key) => `${key}=${normalizeLookup(identity[key])}`).join('|');
  return `${prefix}-${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
}

function normalizeSource(source) {
  if (!source) return null;
  if (typeof source === 'string') return { url: source };
  if (typeof source !== 'object') return { value: String(source) };
  return { ...source };
}

function first(record, names) {
  return getField(record, names);
}

function asArray(value) {
  if (value === null || value === undefined || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function looksNumericId(value) {
  return /^\d+$/u.test(normalizeWhitespace(value));
}

function truthy(value) {
  return value === true || ['1', 'true', 'yes', 'y'].includes(normalizeLookup(value));
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  return truthy(value);
}

function issue(code, message, severity = 'REVIEW') {
  return { code, message, severity };
}

module.exports = {
  buildStandardSiteName,
  deterministicRecordId,
  normalizeDataset,
  normalizeResearchArtifact,
  normalizeResearchRecord,
};
