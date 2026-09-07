'use strict';

const { normalizeLookup } = require('./normalize');
const { SITE_FORBIDDEN_INHERITANCE_FIELDS } = require('./new-supplier');

const READY_ENRICHMENT_STATUSES = new Set(['completed', 'ready', 'approved', 'qa passed', 'qa_passed']);

function runQa(supplierArtifact, enrichmentArtifact, templateProfile) {
  if (!supplierArtifact || !Array.isArray(supplierArtifact.records)) {
    throw new TypeError('supplier match artifact must contain records[]');
  }
  const enrichmentById = new Map(
    (enrichmentArtifact?.records || []).map((record) => [String(record.record_id), record]),
  );
  const records = supplierArtifact.records.map((record) => {
    const enrichment = enrichmentById.get(String(record.record_id)) || null;
    return qaRecord(record, enrichment, templateProfile);
  });
  const stats = buildQaStats(records);
  return {
    artifact_type: 'qa',
    schema_version: 1,
    company: supplierArtifact.company,
    generated_at: new Date().toISOString(),
    records,
    stats,
  };
}

function qaRecord(record, enrichment, templateProfile) {
  const issues = [];
  for (const sourceIssue of record.issues || []) {
    if (normalizeLookup(sourceIssue.severity) === 'warning') continue;
    issues.push(normalizeIssue(sourceIssue, 'NORMALIZATION'));
  }
  if (record.region_match?.status !== 'MATCHED') {
    issues.push({
      code: 'REGION_NOT_CONFIRMED',
      stage: 'REGION',
      detail: record.region_match?.issues || [],
    });
  }
  if (record.NeedNewSupplier === 'REVIEW_REQUIRED' || record.supplier_match?.status === 'REVIEW_REQUIRED') {
    issues.push({
      code: 'SUPPLIER_MATCH_REVIEW_REQUIRED',
      stage: 'SUPPLIER_MATCH',
      detail: record.supplier_match?.reasons || [],
    });
  }
  if (record.NeedNewSupplier === 'NO') {
    if (!record.supplier_match?.supplier_name) {
      issues.push({ code: 'MATCHED_SUPPLIER_NAME_MISSING', stage: 'SUPPLIER_MATCH' });
    } else if (record.final_supplier_name !== record.supplier_match.supplier_name) {
      issues.push({ code: 'MASTER_SUPPLIER_NAME_NOT_PRESERVED_EXACTLY', stage: 'SUPPLIER_MATCH' });
    }
  }

  const isSite = record.record_type === 'PLANT_SITE' || record.record_type === 'RND_SITE';
  if (
    isSite
    && record.is_additional_site
    && record.supplier_match?.status === 'MATCHED'
    && normalizeLookup(record.supplier_match.supplier_name) === normalizeLookup(record.legal_entity_name)
    && normalizeLookup(record.standard_site_name) !== normalizeLookup(record.legal_entity_name)
  ) {
    issues.push({ code: 'ADDITIONAL_SITE_DOWNGRADED_TO_PARENT', stage: 'SUPPLIER_MATCH' });
  }

  if (record.NeedNewSupplier === 'YES') {
    if (!enrichment) {
      issues.push({ code: 'NEW_SUPPLIER_ENRICHMENT_MISSING', stage: 'NEW_SUPPLIER' });
    } else {
      if (!READY_ENRICHMENT_STATUSES.has(normalizeLookup(enrichment.status))) {
        issues.push({ code: 'NEW_SUPPLIER_ENRICHMENT_NOT_READY', stage: 'NEW_SUPPLIER', status: enrichment.status || null });
      }
      validateDataType(record, enrichment, templateProfile, issues);
      validateSiteIsolation(record, enrichment, issues);
      for (const reviewIssue of enrichment.review || []) {
        issues.push(normalizeIssue(reviewIssue, 'NEW_SUPPLIER'));
      }
    }
  } else if (enrichment) {
    issues.push({ code: 'ENRICHMENT_RAN_WITHOUT_NEED_NEW_SUPPLIER_YES', stage: 'NEW_SUPPLIER' });
  }

  const qaStatus = issues.length ? 'REVIEW_REQUIRED' : 'APPROVED';
  const formalOutputs = [];
  if (qaStatus === 'APPROVED') {
    formalOutputs.push(record.dataset === 'RND_CENTER' ? 'RND_CENTER' : 'PRODUCTION_BASE');
    if (record.NeedNewSupplier === 'YES') formalOutputs.push('NEW_SUPPLIER');
  }
  return {
    ...record,
    qa_status: qaStatus,
    issues,
    formal_outputs: formalOutputs,
    new_supplier: enrichment,
  };
}

function validateDataType(record, enrichment, profile, issues) {
  const rule = profile.dataTypes?.[record.record_type];
  if (!rule || rule.status !== 'confirmed' || rule.value === null || rule.value === undefined) {
    issues.push({
      code: 'UNRESOLVED_DATATYPE',
      stage: 'NEW_SUPPLIER',
      record_type: record.record_type,
    });
    return;
  }
  const actual = enrichment.fields?.DataType;
  if (actual === '' || actual === null || actual === undefined) {
    issues.push({ code: 'DATATYPE_MISSING', stage: 'NEW_SUPPLIER', expected: rule.value });
  } else if (String(actual) !== String(rule.value)) {
    issues.push({ code: 'DATATYPE_MISMATCH', stage: 'NEW_SUPPLIER', expected: rule.value, actual });
  }
}

function validateSiteIsolation(record, enrichment, issues) {
  const isSite = record.record_type === 'PLANT_SITE' || record.record_type === 'RND_SITE';
  if (!isSite || record.is_independent_legal_entity === true) return;
  const fields = enrichment.fields || {};
  const violations = SITE_FORBIDDEN_INHERITANCE_FIELDS.filter((field) => !blank(fields[field]));
  if (violations.length) {
    issues.push({
      code: 'PARENT_DATA_LEAKAGE_TO_SITE',
      stage: 'NEW_SUPPLIER',
      fields: violations,
    });
  }
  const employeeScope = normalizeLookup(fields.EmployeeScope || enrichment.field_scopes?.Employees || enrichment.field_scopes?.ManagePeople);
  if (employeeScope.includes('group') || employeeScope.includes('集团')) {
    issues.push({ code: 'GROUP_EMPLOYEES_USED_FOR_SITE', stage: 'NEW_SUPPLIER' });
  }
}

function selectFormalRecords(qaArtifact, outputType) {
  return (qaArtifact.records || []).filter(
    (record) => record.qa_status === 'APPROVED' && record.formal_outputs?.includes(outputType),
  );
}

function buildQaStats(records) {
  const approved = records.filter((record) => record.qa_status === 'APPROVED');
  const review = records.filter((record) => record.qa_status === 'REVIEW_REQUIRED');
  return {
    total: records.length,
    approved: approved.length,
    review_required: review.length,
    rejected: records.filter((record) => record.qa_status === 'REJECTED').length,
    production_base: records.filter((record) => record.dataset === 'PRODUCTION_BASE').length,
    rnd_center: records.filter((record) => record.dataset === 'RND_CENTER').length,
    existing_supplier: records.filter((record) => record.NeedNewSupplier === 'NO').length,
    new_legal_entity: records.filter((record) => record.NeedNewSupplier === 'YES' && record.record_type === 'LEGAL_ENTITY').length,
    new_plant_site: records.filter((record) => record.NeedNewSupplier === 'YES' && record.record_type === 'PLANT_SITE').length,
    new_rnd_site: records.filter((record) => record.NeedNewSupplier === 'YES' && record.record_type === 'RND_SITE').length,
    formal_production_base: approved.filter((record) => record.formal_outputs.includes('PRODUCTION_BASE')).length,
    formal_rnd_center: approved.filter((record) => record.formal_outputs.includes('RND_CENTER')).length,
    formal_new_supplier: approved.filter((record) => record.formal_outputs.includes('NEW_SUPPLIER')).length,
  };
}

function normalizeIssue(value, stage) {
  if (!value || typeof value !== 'object') return { code: String(value || 'UNSPECIFIED_ISSUE'), stage };
  return { stage, ...value };
}

function blank(value) {
  return value === null || value === undefined || value === '';
}

module.exports = {
  READY_ENRICHMENT_STATUSES,
  buildQaStats,
  qaRecord,
  runQa,
  selectFormalRecords,
};
