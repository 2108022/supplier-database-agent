'use strict';

const { matchSupplier } = require('./supplier-index');

function matchSupplierRecords(artifact, supplierIndex, options = {}) {
  if (!artifact || !Array.isArray(artifact.records)) throw new TypeError('region match artifact must contain records[]');
  const records = artifact.records.map((record) => {
    const matchInput = {
      record_id: record.record_id,
      StandardSiteName: record.standard_site_name,
      LegalEntityName: record.legal_entity_name,
      RecordType: record.record_type,
      IsAdditionalSite: record.is_additional_site,
      CountryID: record.region_match?.country_id,
      ProvinceID: record.region_match?.province_id,
      CityID: record.region_match?.city_id,
      MainProduct: record.localized?.main_product?.[1]
        || record.localized?.rd_content?.[1]
        || record.localized?.main_product?.[0]
        || record.localized?.rd_content?.[0]
        || '',
    };
    const decision = matchSupplier(matchInput, supplierIndex, options.matcher || {});
    return {
      ...record,
      NeedNewSupplier: decision.NeedNewSupplier,
      final_supplier_name: decision.status === 'MATCHED'
        ? decision.MatchedSupplierName
        : record.standard_site_name,
      supplier_match: {
        status: decision.status,
        supplier_id: decision.MatchedSupplierID,
        supplier_name: decision.MatchedSupplierName,
        confidence: decision.confidence,
        evidence: decision.evidence || [],
        reasons: decision.reasons || [],
        candidates: decision.candidates || (decision.candidate ? [decision.candidate] : []),
        blocked_candidates: decision.blockedCandidates || [],
      },
    };
  });
  return {
    artifact_type: 'supplier_matches',
    schema_version: 1,
    company: artifact.company,
    generated_at: new Date().toISOString(),
    records,
    stats: {
      matched: records.filter((record) => record.NeedNewSupplier === 'NO').length,
      new: records.filter((record) => record.NeedNewSupplier === 'YES').length,
      review_required: records.filter((record) => record.NeedNewSupplier === 'REVIEW_REQUIRED').length,
      alias_hooks: { ...supplierIndex.hookStats },
    },
  };
}

module.exports = {
  matchSupplierRecords,
};
