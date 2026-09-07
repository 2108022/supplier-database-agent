#!/usr/bin/env node
'use strict';

const path = require('node:path');

const { loadConfig } = require('./lib/config');
const { ensureDirectory, pathExists, writeJsonAtomic } = require('./lib/file-utils');
const { ReferenceStore, validateTemplateHeaders } = require('./lib/reference-store');

async function initializeReferences(options = {}) {
  const config = await loadConfig(options);
  await ensureDirectory(config.cacheDir);
  const profile = await (new ReferenceStore(config)).getTemplateProfile();
  const required = [
    config.supplierMaster,
    config.regionMaster,
    config.productionBaseTemplate,
    config.rndCenterTemplate,
    config.newSupplierTemplate,
  ];
  const missing = [];
  for (const target of required) if (!await pathExists(target)) missing.push(target);
  if (missing.length) throw new Error(`Missing required reference role(s): ${missing.join(', ')}`);

  const store = new ReferenceStore(config, { forceCache: Boolean(options.forceCache) });
  const embeddedHistory = await store.ensureEmbeddedHistoryCache();
  const [regionIndex, supplierIndex] = await Promise.all([
    store.getRegionIndex(),
    store.getSupplierIndex(),
  ]);

  const templateChecks = {
    productionBase: await validateTemplateHeaders(
      config.productionBaseTemplate,
      profile.templates.productionBase.sheet,
      profile.templates.productionBase.columns.map((column) => column.name),
    ),
    rndCenter: await validateTemplateHeaders(
      config.rndCenterTemplate,
      profile.templates.rndCenter.sheet,
      profile.templates.rndCenter.columns.map((column) => column.name),
    ),
    newSupplier: await validateTemplateHeaders(
      config.newSupplierTemplate,
      profile.templates.newSupplier.sheet,
      profile.templates.newSupplier.columns,
    ),
  };
  const invalidTemplates = Object.values(templateChecks).filter((check) => !check.ok);
  if (invalidTemplates.length) throw new Error(`Template header validation failed: ${JSON.stringify(invalidTemplates)}`);

  const report = {
    initialized_at: new Date().toISOString(),
    root: config.rootDir,
    references_unchanged: true,
    logical_reference_roles: {
      supplier_master: {
        requested_filename_present: await pathExists(path.join(config.rootDir, 'references', 'supplier_master.xlsx')),
        actual_path: config.supplierMaster,
        format: path.extname(config.supplierMaster).slice(1).toLowerCase(),
        rows: supplierIndex.entries.length,
        fields: supplierIndex.sourceHeaders || Object.keys(supplierIndex.sourceRows[0] || {}),
        fingerprint: supplierIndex.cache.fingerprint,
      },
      region_master: {
        actual_path: config.regionMaster,
        rows: regionIndex.localizedRows.length,
        canonical_regions: regionIndex.canonicalRecords.length,
        fields: Object.keys(regionIndex.sourceRows[0] || {}),
        fingerprint: regionIndex.cache.fingerprint,
      },
      productionbase_import_template: templateChecks.productionBase,
      rndcenter_import_template: templateChecks.rndCenter,
      new_supplier_import_template: templateChecks.newSupplier,
    },
    indexes: {
      region: {
        byId: regionIndex.byId.size,
        byParent: regionIndex.byParent.size,
        byAreaCode: regionIndex.byAreaCode.size,
        byNormalizedName: regionIndex.byNormalizedName.size,
        issues: regionIndex.issues.length,
      },
      supplier: {
        byId: supplierIndex.byId.size,
        byExactName: supplierIndex.byExactName.size,
        byCoreName: supplierIndex.byCoreName.size,
        aliases: supplierIndex.hookStats,
        issues: supplierIndex.issues.length,
        issue_samples: supplierIndex.issues.slice(0, 20),
      },
    },
    reviewed_history: {
      cached_rows: embeddedHistory.rows.length,
      source: embeddedHistory.source,
      connected: supplierIndex.hookStats.aliasesConnected,
    },
    data_types: profile.dataTypes,
    cache_events: store.cacheEvents,
    warnings: [
      ...store.warnings,
      ...(path.extname(config.supplierMaster).toLowerCase() === '.xlsx'
        ? []
        : ['supplier_master.xlsx is absent; the compatible local supplier_master.csv is active']),
    ],
  };
  const reportPath = path.join(config.cacheDir, 'reference-initialization-report.json');
  await writeJsonAtomic(reportPath, report);
  return { report, reportPath };
}

if (require.main === module) {
  initializeReferences({ forceCache: process.argv.includes('--force-cache') })
    .then(({ report, reportPath }) => {
      process.stdout.write(`${JSON.stringify({
        status: 'INITIALIZED',
        report: reportPath,
        supplier_rows: report.logical_reference_roles.supplier_master.rows,
        region_rows: report.logical_reference_roles.region_master.rows,
        canonical_regions: report.logical_reference_roles.region_master.canonical_regions,
        reviewed_aliases_connected: report.reviewed_history.connected,
        data_types: report.data_types,
        warnings: report.warnings,
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  initializeReferences,
};
