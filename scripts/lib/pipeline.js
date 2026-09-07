'use strict';

const { companyPaths } = require('./config');
const { exportExcelArtifacts } = require('./excel-exporter');
const {
  ensureDirectory,
  mergeRecords,
  pathExists,
  pickRecord,
  readJson,
  writeJsonAtomic,
} = require('./file-utils');
const { buildNewSupplierRequests, syncPendingEnrichment, validateEnrichmentScope } = require('./new-supplier');
const { runQa } = require('./qa-gate');
const { ReferenceStore } = require('./reference-store');
const { RegionResolver } = require('./region-resolver');
const { normalizeResearchArtifact } = require('./research-normalizer');
const { matchSupplierRecords } = require('./supplier-matcher');

const STAGES = Object.freeze(['normalize', 'regions', 'suppliers', 'new-suppliers', 'qa', 'export']);

class SupplierPipeline {
  constructor(options) {
    this.company = options.company;
    this.config = options.config;
    this.paths = companyPaths(options.config, options.company);
    this.manifest = options.manifest;
    this.dryRun = Boolean(options.dryRun);
    this.recordId = options.recordId || null;
    this.references = options.references || new ReferenceStore(options.config, {
      dryRun: this.dryRun,
      forceCache: Boolean(options.forceCache),
      manifest: this.manifest,
    });
  }

  async run(stage = 'all') {
    await ensureDirectory(this.paths.workDir);
    const stages = normalizeStages(stage);
    const results = {};
    for (const stageName of stages) {
      results[stageName] = await this[`run_${stageName.replace('-', '_')}`]();
    }
    for (const warning of this.references.warnings) this.manifest?.warn(warning);
    return results;
  }

  async run_normalize() {
    return this.executeStage('normalize', async () => {
      const research = await requiredJson(this.paths.research, 'research.json is missing. Run the combined research skill first.');
      assertCompany(research, this.company, this.paths.research);
      const full = normalizeResearchArtifact(research, { company: this.company });
      full.records = pickRecord(full.records, this.recordId);
      const output = await this.mergeAndWrite(this.paths.normalized, full);
      return { artifact: output, details: { records: full.records.length, output: this.paths.normalized } };
    });
  }

  async run_regions() {
    return this.executeStage('regions', async () => {
      const upstream = await requiredJson(this.paths.normalized, 'normalized.json is missing. Run --stage normalize first.');
      assertCompany(upstream, this.company, this.paths.normalized);
      const records = pickRecord(upstream.records || [], this.recordId);
      const index = await this.references.getRegionIndex();
      const resolver = new RegionResolver(index);
      const changed = {
        artifact_type: 'region_matches',
        schema_version: 1,
        company: upstream.company,
        generated_at: new Date().toISOString(),
        records: records.map((record) => ({ ...record, region_match: resolver.resolveRecord(record) })),
        stats: resolver.stats,
      };
      const output = await this.mergeAndWrite(this.paths.regionMatches, changed);
      output.stats = {
        ...resolver.stats,
        artifact_total: output.records.length,
        artifact_matched: output.records.filter((record) => record.region_match?.status === 'MATCHED').length,
        artifact_review_required: output.records.filter((record) => record.region_match?.status !== 'MATCHED').length,
      };
      await writeJsonAtomic(this.paths.regionMatches, output);
      return {
        artifact: output,
        details: { records: changed.records.length, cache: resolver.stats, output: this.paths.regionMatches },
      };
    });
  }

  async run_suppliers() {
    return this.executeStage('suppliers', async () => {
      const upstream = await requiredJson(this.paths.regionMatches, 'region_matches.json is missing. Run --stage regions first.');
      assertCompany(upstream, this.company, this.paths.regionMatches);
      const selected = { ...upstream, records: pickRecord(upstream.records || [], this.recordId) };
      const index = await this.references.getSupplierIndex();
      const changed = matchSupplierRecords(selected, index);
      const output = await this.mergeAndWrite(this.paths.supplierMatches, changed);
      output.stats = {
        matched: output.records.filter((record) => record.NeedNewSupplier === 'NO').length,
        new: output.records.filter((record) => record.NeedNewSupplier === 'YES').length,
        review_required: output.records.filter((record) => record.NeedNewSupplier === 'REVIEW_REQUIRED').length,
        alias_hooks: { ...index.hookStats },
      };
      await writeJsonAtomic(this.paths.supplierMatches, output);
      return {
        artifact: output,
        details: {
          records: changed.records.length,
          stats: changed.stats,
          supplier_master_rows: index.entries.length,
          output: this.paths.supplierMatches,
        },
      };
    });
  }

  async run_new_suppliers() {
    return this.executeStage('new-suppliers', async () => {
      const upstream = await requiredJson(this.paths.supplierMatches, 'supplier_matches.json is missing. Run --stage suppliers first.');
      assertCompany(upstream, this.company, this.paths.supplierMatches);
      if (this.recordId) pickRecord(upstream.records || [], this.recordId);
      const profile = await this.references.getTemplateProfile();
      const requests = buildNewSupplierRequests(upstream, profile);
      await writeJsonAtomic(this.paths.newSupplierRequests, requests);
      const existingEnrichment = await readJson(this.paths.newSupplierEnrichment, null);
      let enrichment = syncPendingEnrichment(requests, existingEnrichment);
      const scope = validateEnrichmentScope(requests, enrichment);
      if (!scope.valid) throw new Error(`Invalid new-supplier enrichment scope: ${JSON.stringify(scope.issues)}`);
      await writeJsonAtomic(this.paths.newSupplierEnrichment, enrichment);
      return {
        artifact: requests,
        details: {
          requested_records: this.recordId ? Number(requests.records.some((record) => record.record_id === this.recordId)) : requests.records.length,
          total_requests: requests.records.length,
          enrichment_status: summarizeEnrichment(enrichment),
          output: this.paths.newSupplierRequests,
        },
      };
    });
  }

  async run_qa() {
    return this.executeStage('qa', async () => {
      const upstream = await requiredJson(this.paths.supplierMatches, 'supplier_matches.json is missing. Run --stage suppliers first.');
      assertCompany(upstream, this.company, this.paths.supplierMatches);
      const selected = { ...upstream, records: pickRecord(upstream.records || [], this.recordId) };
      const enrichment = await readJson(this.paths.newSupplierEnrichment, {
        artifact_type: 'new_supplier_enrichment',
        company: this.company,
        records: [],
      });
      const selectedIds = new Set(selected.records.map((record) => String(record.record_id)));
      const selectedEnrichment = {
        ...enrichment,
        records: (enrichment.records || []).filter((record) => selectedIds.has(String(record.record_id))),
      };
      const profile = await this.references.getTemplateProfile();
      const changed = runQa(selected, selectedEnrichment, profile);
      const output = await this.mergeAndWrite(this.paths.qa, changed);
      output.stats = calculateMergedQaStats(output.records);
      await writeJsonAtomic(this.paths.qa, output);
      this.manifest?.setQaStatistics(output.stats);
      return {
        artifact: output,
        details: { records: changed.records.length, stats: output.stats, output: this.paths.qa },
      };
    });
  }

  async run_export() {
    return this.executeStage('export', async () => {
      const qa = await requiredJson(this.paths.qa, 'qa.json is missing. Run --stage qa first.');
      assertCompany(qa, this.company, this.paths.qa);
      const profile = await this.references.getTemplateProfile();
      const result = await exportExcelArtifacts({
        qaArtifact: qa,
        config: this.config,
        profile,
        outputDir: this.paths.outputDir,
        dryRun: this.dryRun,
      });
      if (this.dryRun) await writeJsonAtomic(this.paths.exportPlan, result.plan);
      return {
        artifact: result,
        details: {
          dry_run: this.dryRun,
          plan: result.plan,
          files: result.files,
          output: this.dryRun ? this.paths.exportPlan : this.paths.outputDir,
        },
      };
    });
  }

  async executeStage(name, operation) {
    const token = this.manifest?.startStage(name);
    const result = await operation();
    if (token) this.manifest.endStage(token, result.details || {});
    return result.artifact;
  }

  async mergeAndWrite(target, changed) {
    const existing = this.recordId ? await readJson(target, null) : null;
    const merged = mergeRecords(existing, changed, this.recordId);
    await writeJsonAtomic(target, merged);
    return merged;
  }
}

function normalizeStages(stage) {
  const normalized = String(stage || 'all').trim().toLocaleLowerCase('und').replace(/_/gu, '-');
  if (normalized === 'all') return [...STAGES];
  const aliases = {
    region: 'regions',
    supplier: 'suppliers',
    'new-supplier': 'new-suppliers',
  };
  const selected = aliases[normalized] || normalized;
  if (!STAGES.includes(selected)) throw new Error(`Unknown stage ${stage}. Expected all or: ${STAGES.join(', ')}`);
  return [selected];
}

async function requiredJson(target, message) {
  if (!await pathExists(target)) throw new Error(`${message} Expected path: ${target}`);
  return readJson(target);
}

function assertCompany(artifact, expected, sourcePath) {
  if (artifact.company && artifact.company !== expected) {
    throw new Error(`Company mismatch in ${sourcePath}: expected ${expected}, got ${artifact.company}`);
  }
}

function summarizeEnrichment(artifact) {
  const counts = {};
  for (const record of artifact.records || []) {
    const status = record.status || 'UNKNOWN';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function calculateMergedQaStats(records) {
  const approved = records.filter((record) => record.qa_status === 'APPROVED');
  return {
    total: records.length,
    approved: approved.length,
    review_required: records.filter((record) => record.qa_status === 'REVIEW_REQUIRED').length,
    rejected: records.filter((record) => record.qa_status === 'REJECTED').length,
    production_base: records.filter((record) => record.dataset === 'PRODUCTION_BASE').length,
    rnd_center: records.filter((record) => record.dataset === 'RND_CENTER').length,
    existing_supplier: records.filter((record) => record.NeedNewSupplier === 'NO').length,
    new_legal_entity: records.filter((record) => record.NeedNewSupplier === 'YES' && record.record_type === 'LEGAL_ENTITY').length,
    new_plant_site: records.filter((record) => record.NeedNewSupplier === 'YES' && record.record_type === 'PLANT_SITE').length,
    new_rnd_site: records.filter((record) => record.NeedNewSupplier === 'YES' && record.record_type === 'RND_SITE').length,
    formal_production_base: approved.filter((record) => record.formal_outputs?.includes('PRODUCTION_BASE')).length,
    formal_rnd_center: approved.filter((record) => record.formal_outputs?.includes('RND_CENTER')).length,
    formal_new_supplier: approved.filter((record) => record.formal_outputs?.includes('NEW_SUPPLIER')).length,
  };
}

module.exports = {
  STAGES,
  SupplierPipeline,
  calculateMergedQaStats,
  normalizeStages,
};
