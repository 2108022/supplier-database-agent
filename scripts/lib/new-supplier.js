'use strict';

const { localizedValue } = require('./language');

const LEGAL_ENTITY_FIELDS = Object.freeze([
  'CompanyAbbreviation', 'WebSite', 'Employees', 'EmployeesAsOf',
  'RegisterCapitalSum', 'RegisterCapitalType', 'RegisterCapitalUnit',
  'EstablishedDate', 'CEO', 'LegalRepresentative', 'CRN', 'TIN',
  'Phone', 'Email', 'CompanyNature', 'Ownership', 'UltimateOwnership',
]);

const SITE_FORBIDDEN_INHERITANCE_FIELDS = Object.freeze([
  'CRN', 'TIN', 'RegisterCapitalSum', 'RegisterCapital', 'CEO',
  'LegalRepresentative', 'Employees', 'ManagePeople',
]);

function buildNewSupplierRequests(artifact, templateProfile) {
  if (!artifact || !Array.isArray(artifact.records)) throw new TypeError('supplier artifact must contain records[]');
  const records = artifact.records
    .filter((record) => record.NeedNewSupplier === 'YES')
    .map((record) => buildRequest(record, templateProfile));
  return {
    artifact_type: 'new_supplier_requests',
    schema_version: 1,
    company: artifact.company,
    generated_at: new Date().toISOString(),
    records,
    stats: {
      total: records.length,
      LEGAL_ENTITY: records.filter((record) => record.record_type === 'LEGAL_ENTITY').length,
      PLANT_SITE: records.filter((record) => record.record_type === 'PLANT_SITE').length,
      RND_SITE: records.filter((record) => record.record_type === 'RND_SITE').length,
    },
  };
}

function buildRequest(record, templateProfile) {
  const dataType = templateProfile.dataTypes?.[record.record_type] || { status: 'unresolved', value: null };
  const isSite = record.record_type === 'PLANT_SITE' || record.record_type === 'RND_SITE';
  const baseFields = {
    CompanyName: { ...record.localized.site_name },
    DataType: dataType.status === 'confirmed' ? dataType.value : null,
    StreetAddress: record.address || record.geography?.detailed_address || '',
    LocationCountry: record.region_match?.country_id || '',
    Province: record.region_match?.province_id || '',
    City: record.region_match?.city_id || '',
    PostCode: record.geography?.post_code || '',
    MainProduct: record.dataset === 'RND_CENTER'
      ? { ...record.localized.rd_content }
      : { ...record.localized.main_product },
  };
  return {
    record_id: record.record_id,
    NeedNewSupplier: 'YES',
    record_type: record.record_type,
    standard_site_name: record.standard_site_name,
    legal_entity_name: record.legal_entity_name,
    parent_legal_entity: record.parent_legal_entity || record.legal_entity_name,
    is_independent_legal_entity: record.is_independent_legal_entity,
    data_type: dataType,
    verified_research: {
      address: record.address,
      geography: record.geography,
      localized: record.localized,
      sources: record.sources,
    },
    prefilled_fields: baseFields,
    fields_to_research: isSite && record.is_independent_legal_entity !== true
      ? []
      : LEGAL_ENTITY_FIELDS.filter((field) => !baseFields[field]),
    forbidden_parent_inheritance_fields: isSite && record.is_independent_legal_entity !== true
      ? [...SITE_FORBIDDEN_INHERITANCE_FIELDS]
      : [],
    review_issues: dataType.status === 'confirmed'
      ? []
      : [{ code: 'UNRESOLVED_DATATYPE', record_type: record.record_type }],
  };
}

function createPendingEnrichment(requestArtifact) {
  return {
    artifact_type: 'new_supplier_enrichment',
    schema_version: 1,
    company: requestArtifact.company,
    generated_at: new Date().toISOString(),
    records: requestArtifact.records.map((request) => ({
      record_id: request.record_id,
      record_type: request.record_type,
      status: 'PENDING_ENRICHMENT',
      fields: { ...request.prefilled_fields },
      sources: request.verified_research.sources || [],
      review: [...request.review_issues],
    })),
  };
}

function syncPendingEnrichment(requestArtifact, existingArtifact) {
  const existing = new Map(
    (existingArtifact?.records || []).map((record) => [String(record.record_id), record]),
  );
  const pending = createPendingEnrichment(requestArtifact);
  return {
    ...pending,
    generated_at: new Date().toISOString(),
    records: pending.records.map((record) => existing.get(String(record.record_id)) || record),
  };
}

function validateEnrichmentScope(requestArtifact, enrichmentArtifact) {
  const requested = new Map(requestArtifact.records.map((record) => [record.record_id, record]));
  const issues = [];
  for (const record of enrichmentArtifact.records || []) {
    if (!requested.has(record.record_id)) {
      issues.push({ code: 'ENRICHMENT_WITHOUT_NEW_SUPPLIER_REQUEST', record_id: record.record_id });
      continue;
    }
    if (record.record_type && record.record_type !== requested.get(record.record_id).record_type) {
      issues.push({ code: 'ENRICHMENT_RECORD_TYPE_CHANGED', record_id: record.record_id });
    }
  }
  return { valid: issues.length === 0, issues };
}

function languageField(fields, name, languageType) {
  return localizedValue(fields?.[name], languageType, { fallback: '' });
}

module.exports = {
  LEGAL_ENTITY_FIELDS,
  SITE_FORBIDDEN_INHERITANCE_FIELDS,
  buildNewSupplierRequests,
  createPendingEnrichment,
  languageField,
  syncPendingEnrichment,
  validateEnrichmentScope,
};
