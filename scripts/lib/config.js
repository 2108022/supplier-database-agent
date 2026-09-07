'use strict';

const path = require('node:path');

const { pathExists, readJson, slugifyCompany } = require('./file-utils');

const DEFAULTS = Object.freeze({
  supplierMaster: 'references/supplier_master.xlsx',
  supplierMasterFallbacks: ['references/supplier_master.csv'],
  regionMaster: 'references/region_master.csv',
  productionBaseTemplate: 'references/productionbase_import_template.xlsx',
  rndCenterTemplate: 'references/rndcenter_import_template.xlsx',
  newSupplierTemplate: 'references/new_supplier_import_template.xlsx',
  templateProfile: 'config/template-profile.json',
  outputDir: 'output',
  workDir: 'work',
  cacheDir: 'cache',
  supplierAliasCandidates: [
    'references/supplier_alias.csv',
    'references/supplier_alias.xlsx',
    'references/supplier_aliases.csv',
    'references/supplier_aliases.xlsx',
    'references/supplier_aliases.json',
  ],
  reviewedHistoryCandidates: [
    'references/reviewed_match_history.csv',
    'references/reviewed_match_history.xlsx',
    'references/reviewed_match_history.json',
  ],
});

async function loadConfig(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..', '..'));
  const examplePath = path.join(rootDir, 'config', 'local.example.json');
  const localPath = path.join(rootDir, 'config', 'local.json');
  const example = await readJson(examplePath, {});
  const local = await readJson(localPath, {});
  const raw = { ...DEFAULTS, ...example, ...local, ...(options.overrides || {}) };

  const supplierCandidates = unique([
    raw.supplierMaster,
    ...(raw.supplierMasterFallbacks || []),
    'references/supplier_master.xlsx',
    'references/supplier_master.csv',
  ]).map((item) => resolveProjectPath(rootDir, item));
  const supplierMaster = await firstExisting(supplierCandidates) || supplierCandidates[0];

  const config = {
    ...raw,
    rootDir,
    supplierMaster,
    supplierMasterCandidates: supplierCandidates,
    regionMaster: resolveProjectPath(rootDir, raw.regionMaster),
    productionBaseTemplate: resolveProjectPath(rootDir, raw.productionBaseTemplate),
    rndCenterTemplate: resolveProjectPath(rootDir, raw.rndCenterTemplate),
    newSupplierTemplate: resolveProjectPath(rootDir, raw.newSupplierTemplate),
    templateProfile: resolveProjectPath(rootDir, raw.templateProfile),
    outputDir: resolveProjectPath(rootDir, raw.outputDir),
    workDir: resolveProjectPath(rootDir, raw.workDir),
    cacheDir: resolveProjectPath(rootDir, raw.cacheDir),
    supplierAliasCandidates: unique(raw.supplierAliasCandidates || DEFAULTS.supplierAliasCandidates)
      .map((item) => resolveProjectPath(rootDir, item)),
    reviewedHistoryCandidates: unique(raw.reviewedHistoryCandidates || DEFAULTS.reviewedHistoryCandidates)
      .map((item) => resolveProjectPath(rootDir, item)),
  };
  return config;
}

function companyPaths(config, company) {
  const companyDirName = slugifyCompany(company);
  const workDir = path.join(config.workDir, companyDirName);
  const outputDir = path.join(config.outputDir, companyDirName);
  return {
    companyDirName,
    workDir,
    outputDir,
    research: path.join(workDir, 'research.json'),
    normalized: path.join(workDir, 'normalized.json'),
    regionMatches: path.join(workDir, 'region_matches.json'),
    supplierMatches: path.join(workDir, 'supplier_matches.json'),
    newSupplierRequests: path.join(workDir, 'new_supplier_requests.json'),
    newSupplierEnrichment: path.join(workDir, 'new_supplier_enrichment.json'),
    qa: path.join(workDir, 'qa.json'),
    exportPlan: path.join(workDir, 'export_plan.json'),
    manifest: path.join(workDir, 'manifest.json'),
  };
}

function resolveProjectPath(rootDir, value) {
  if (!value) return value;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(rootDir, value);
}

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  DEFAULTS,
  companyPaths,
  loadConfig,
  resolveProjectPath,
};
