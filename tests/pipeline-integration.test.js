'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { companyPaths } = require('../scripts/lib/config');
const { SupplierPipeline } = require('../scripts/lib/pipeline');

test('shared pipeline runs all stages in dry-run mode without any Excel template', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'supplier-pipeline-test-'));
  const directories = ['references', 'config', 'work', 'output', 'cache'];
  await Promise.all(directories.map((name) => fs.mkdir(path.join(root, name), { recursive: true })));
  const supplierMaster = path.join(root, 'references', 'supplier_master.csv');
  const regionMaster = path.join(root, 'references', 'region_master.csv');
  const templateProfile = path.join(root, 'config', 'template-profile.json');
  await fs.writeFile(supplierMaster, [
    '"id","companyname","MainProduct","LocationCountry","Province","city","area","IsHidden"',
    '"s1","Canonical Supplier, Inc.","Brakes","10","20","30","0","0"',
    '"s2","Second Supplier GmbH","Seats","10","20","30","0","0"',
  ].join('\n'), 'utf8');
  await fs.writeFile(regionMaster, [
    'id,name,code,level,parentid,areacode,location,oldcode,languagetype,internalprimarykey',
    '1,Asia,100,1,NULL,NULL,NULL,NULL,1,1',
    '10,Country,100001,2,1,AREA-10,NULL,NULL,1,10',
    '20,Province,100001001,3,10,P-20,NULL,NULL,1,20',
    '30,City,100001001001,4,20,C-30,NULL,NULL,1,30',
  ].join('\n'), 'utf8');
  await fs.writeFile(templateProfile, JSON.stringify({
    languagePolicy: { outputLanguageTypes: [0, 1, 8] },
    dataTypes: {
      LEGAL_ENTITY: { status: 'confirmed', value: 0 },
      PLANT_SITE: { status: 'unresolved', value: null },
      RND_SITE: { status: 'unresolved', value: null },
    },
    templates: {
      productionBase: { sheet: 'productionbase', columns: [] },
      rndCenter: { sheet: 'rdcenterbase', columns: [] },
      newSupplier: { sheet: 'supplierbase', columns: [], canonicalFieldMap: {} },
    },
  }), 'utf8');

  const config = {
    rootDir: root,
    supplierMaster,
    regionMaster,
    productionBaseTemplate: path.join(root, 'references', 'missing-production-template.xlsx'),
    rndCenterTemplate: path.join(root, 'references', 'missing-rnd-template.xlsx'),
    newSupplierTemplate: path.join(root, 'references', 'missing-supplier-template.xlsx'),
    templateProfile,
    workDir: path.join(root, 'work'),
    outputDir: path.join(root, 'output'),
    cacheDir: path.join(root, 'cache'),
    supplierAliasCandidates: [],
    reviewedHistoryCandidates: [],
  };
  const paths = companyPaths(config, 'Example');
  await fs.mkdir(paths.workDir, { recursive: true });
  await fs.writeFile(paths.research, JSON.stringify({
    company: 'Example',
    records: [
      researchRecord('record-a', 'Canonical Supplier, Inc.', 'Brakes'),
      researchRecord('record-b', 'Second Supplier GmbH', 'Seats'),
    ],
  }), 'utf8');

  const pipeline = new SupplierPipeline({ company: 'Example', config, dryRun: true });
  const results = await pipeline.run('all');
  assert.equal(results.qa.stats.approved, 2);
  assert.equal(results.qa.stats.review_required, 0);
  assert.equal(results.export.dry_run, true);
  assert.equal(results.export.plan.production_base.logical_records, 2);
  assert.equal(await exists(paths.exportPlan), true);
  assert.equal((await fs.readdir(config.outputDir)).length, 0);
  assert.ok(pipeline.references.warnings.some((warning) => warning.includes('did not load')));

  const research = JSON.parse(await fs.readFile(paths.research, 'utf8'));
  research.records[1].localized.main_product[1] = 'Updated seats';
  await fs.writeFile(paths.research, JSON.stringify(research), 'utf8');
  const partial = new SupplierPipeline({
    company: 'Example',
    config,
    dryRun: true,
    recordId: 'record-b',
  });
  await partial.run('normalize');
  const normalized = JSON.parse(await fs.readFile(paths.normalized, 'utf8'));
  assert.equal(normalized.records.length, 2);
  assert.equal(normalized.records.find((record) => record.record_id === 'record-a').localized.main_product[1], 'Brakes');
  assert.equal(normalized.records.find((record) => record.record_id === 'record-b').localized.main_product[1], 'Updated seats');
});

function researchRecord(recordId, name, product) {
  return {
    record_id: recordId,
    dataset: 'PRODUCTION_BASE',
    record_type: 'LEGAL_ENTITY',
    legal_entity_name: name,
    standard_site_name: name,
    geography: {
      country: { name: 'Country', level: 2 },
      province: { name: 'Province', level: 3 },
      city: { name: 'City', level: 4 },
    },
    localized: {
      site_name: { 0: name, 1: name, 8: name },
      main_product: { 0: product, 1: product, 8: product },
    },
    sources: [{ url: 'https://example.invalid/official' }],
  };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
