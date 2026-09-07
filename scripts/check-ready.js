#!/usr/bin/env node
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { initializeReferences } = require('./init-references');
const { loadConfig } = require('./lib/config');
const { pathExists } = require('./lib/file-utils');

async function checkReady(options = {}) {
  const config = await loadConfig(options);
  const checks = [];
  for (const relative of [
    'AGENTS.md', 'README.md', 'PROJECT_MAP.md', 'VERSION', 'CHANGELOG.md',
    'config/template-profile.json', 'schemas/research.schema.json',
    'scripts/run-company.js', 'tests/core-pipeline.test.js',
  ]) {
    const target = path.join(config.rootDir, relative);
    checks.push({ name: `file:${relative}`, ok: await pathExists(target), path: target });
  }
  const { report } = await initializeReferences({ rootDir: config.rootDir });
  checks.push({
    name: 'reference-roles',
    ok: Object.keys(report.logical_reference_roles).length === 5,
  });
  checks.push({
    name: 'template-headers',
    ok: ['productionbase_import_template', 'rndcenter_import_template', 'new_supplier_import_template']
      .every((key) => report.logical_reference_roles[key].ok),
  });
  checks.push({
    name: 'region-indexes',
    ok: ['byId', 'byParent', 'byAreaCode', 'byNormalizedName']
      .every((key) => report.indexes.region[key] > 0),
  });
  checks.push({
    name: 'reviewed-history-connected',
    ok: report.reviewed_history.cached_rows === 0 || report.reviewed_history.connected > 0,
    detail: report.reviewed_history,
  });

  const scriptNames = await recursiveFiles(path.join(config.rootDir, 'scripts'));
  const forbidden = scriptNames.filter((target) => {
    const name = path.basename(target).toLowerCase();
    return /^build_.+_research\./u.test(name) || /.+_matcher\.(js|mjs|cjs|py)$/u.test(name);
  });
  checks.push({ name: 'no-company-specific-programs', ok: forbidden.length === 0, detail: forbidden });

  const blockers = checks.filter((check) => !check.ok);
  const warnings = [
    ...report.warnings,
    ...Object.entries(report.data_types)
      .filter(([, rule]) => rule.status !== 'confirmed')
      .map(([recordType]) => `${recordType} DataType is unresolved; only that formal new-site import path remains review-gated.`),
  ];
  return {
    checked_at: new Date().toISOString(),
    ready_for_first_company: blockers.length === 0,
    checks,
    blockers,
    warnings,
  };
}

async function recursiveFiles(root) {
  const output = [];
  if (!await pathExists(root)) return output;
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await recursiveFiles(target));
    else if (entry.isFile()) output.push(target);
  }
  return output;
}

if (require.main === module) {
  checkReady()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ready_for_first_company) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  checkReady,
};
