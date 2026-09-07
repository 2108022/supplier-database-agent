'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ExcelJS = require('exceljs');

const { exportExcelArtifacts } = require('../scripts/lib/excel-exporter');
const { mergeRecords } = require('../scripts/lib/file-utils');
const { expandLanguageRows } = require('../scripts/lib/language');
const { MasterDataCache } = require('../scripts/lib/master-cache');
const { buildNewSupplierRequests } = require('../scripts/lib/new-supplier');
const { runQa, selectFormalRecords } = require('../scripts/lib/qa-gate');
const { buildRegionIndex, matchRegion } = require('../scripts/lib/region-index');
const { RegionResolver } = require('../scripts/lib/region-resolver');
const { buildSupplierIndex, matchSupplier } = require('../scripts/lib/supplier-index');

const profile = {
  languagePolicy: { outputLanguageTypes: [0, 1, 8] },
  dataTypes: {
    LEGAL_ENTITY: { status: 'confirmed', value: 0 },
    PLANT_SITE: { status: 'unresolved', value: null },
    RND_SITE: { status: 'unresolved', value: null },
  },
  templates: {
    productionBase: {
      sheet: 'productionbase',
      columns: ['Key', 'CompanyName', 'ProBaseName', 'Country', 'Province', 'City', 'MainProduct', 'LanguageType', '操作状态']
        .map((name, index) => ({ position: index + 1, name })),
    },
    rndCenter: {
      sheet: 'rdcenterbase',
      columns: ['Key', 'CompanyName', 'RdCenterName', 'Country', 'Province', 'City', 'RDContent', 'LanguageType', '操作状态']
        .map((name, index) => ({ position: index + 1, name })),
    },
    newSupplier: {
      sheet: 'supplierbase',
      columns: ['Key', 'CompanyName', 'DataType', 'LocationCountry', 'Province', 'City', 'MainProduct', 'LanguageType'],
      canonicalFieldMap: {},
    },
  },
};

test('region multilingual rows resolve to one canonical internalprimarykey', () => {
  const index = buildRegionIndex(regionRows());
  assert.equal(index.byId.get('110').id, '10');
  assert.equal(index.byId.get('210').id, '10');
  assert.equal(matchRegion({ name: 'China', level: 2 }, index).canonicalId, '10');
  assert.equal(matchRegion({ name: '中国', level: 2 }, index).canonicalId, '10');

  const resolver = new RegionResolver(index);
  const chinese = resolver.resolveRecord({ geography: hierarchy('中国', '江苏省', '苏州市') });
  const english = resolver.resolveRecord({ geography: hierarchy('China', 'Jiangsu', 'Suzhou') });
  assert.equal(chinese.status, 'MATCHED');
  assert.equal(english.status, 'MATCHED');
  assert.deepEqual(
    [chinese.country_id, chinese.province_id, chinese.city_id],
    ['10', '20', '30'],
  );
  assert.deepEqual(
    [english.country_id, english.province_id, english.city_id],
    ['10', '20', '30'],
  );
});

test('LanguageType 0/1/8 rows keep one Key and identical canonical region IDs', () => {
  const rows = expandLanguageRows([
    { record_id: 'pb-1', region: { country: '10', province: '20', city: '30' } },
  ], (record, languageType) => ({
    CompanyName: languageType === 0 ? '示例' : 'Example',
    Country: record.region.country,
    Province: record.region.province,
    City: record.region.city,
  }));
  assert.deepEqual(rows.map((row) => row.LanguageType), [0, 1, 8]);
  assert.equal(new Set(rows.map((row) => row.Key)).size, 1);
  assert.equal(new Set(rows.map((row) => `${row.Country}/${row.Province}/${row.City}`)).size, 1);
});

test('generic words plus the same city cannot match AAM, Brembo, or Schaeffler', () => {
  const index = buildSupplierIndex([
    supplier('1', 'American Axle & Manufacturing, Inc. (AAM)', '100', 'Driveline systems'),
    supplier('2', 'Brembo S.p.A.', '100', 'Brake systems'),
    supplier('3', 'Schaeffler Technologies AG & Co. KG', '100', 'Bearings'),
  ]);
  const result = matchSupplier({
    record_id: 'pb-generic',
    StandardSiteName: 'Automotive Components Manufacturing Plant',
    LegalEntityName: 'Unrelated Holdings Ltd.',
    RecordType: 'PLANT_SITE',
    IsAdditionalSite: true,
    CityID: '100',
    MainProduct: 'automotive components',
  }, index);
  assert.notEqual(result.status, 'MATCHED');
  assert.equal(result.NeedNewSupplier, 'YES');
});

test('an additional site cannot downgrade to its parent legal entity even through an alias', () => {
  const index = buildSupplierIndex([
    { id: 'parent-1', companyname: 'Proseat GmbH & Co. KG', RecordType: 'LEGAL_ENTITY', city: '100' },
  ], {
    aliases: [{
      Alias: 'Proseat GmbH & Co. KG-Schwarzheide Plant',
      SupplierName: 'Proseat GmbH & Co. KG',
    }],
  });
  const result = matchSupplier({
    record_id: 'pb-site',
    StandardSiteName: 'Proseat GmbH & Co. KG-Schwarzheide Plant',
    LegalEntityName: 'Proseat GmbH & Co. KG',
    RecordType: 'PLANT_SITE',
    IsAdditionalSite: true,
    CityID: '100',
  }, index);
  assert.notEqual(result.status, 'MATCHED');
  assert.equal(result.NeedNewSupplier, 'YES');
  assert.ok(result.blockedCandidates.some((candidate) => candidate.SupplierName === 'Proseat GmbH & Co. KG'));
});

test('confirmed match emits the supplier master name byte-for-byte', () => {
  const exact = 'BROSE SITECH, UNIPESSOAL, LDA ';
  const index = buildSupplierIndex([{ id: '7', companyname: exact, LocationCountry: '57' }]);
  const result = matchSupplier({
    StandardSiteName: 'brose sitech unipessoal lda',
    LegalEntityName: 'brose sitech unipessoal lda',
    RecordType: 'LEGAL_ENTITY',
    CountryID: '57',
  }, index);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.SupplierName, exact);
});

test('reviewed aliases are connected to actual supplier master entries', () => {
  const index = buildSupplierIndex([{ id: '9', companyname: 'Canonical Name, Inc.' }], {
    aliases: [{ Alias: 'External Trading Name', SupplierName: 'Canonical Name, Inc.' }],
  });
  const result = matchSupplier({
    StandardSiteName: 'External Trading Name',
    LegalEntityName: 'External Trading Name',
    RecordType: 'LEGAL_ENTITY',
  }, index);
  assert.equal(index.hookStats.aliasesConnected, 1);
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.SupplierName, 'Canonical Name, Inc.');
});

test('a NEW Site enters new-supplier requests and keeps unresolved DataType explicit', () => {
  const request = buildNewSupplierRequests({
    company: 'Example',
    records: [{
      record_id: 'pb-new-site',
      dataset: 'PRODUCTION_BASE',
      record_type: 'PLANT_SITE',
      NeedNewSupplier: 'YES',
      standard_site_name: 'Example GmbH-City Plant',
      legal_entity_name: 'Example GmbH',
      parent_legal_entity: 'Example GmbH',
      is_independent_legal_entity: false,
      address: '1 Example Road',
      geography: { post_code: '00100' },
      region_match: { country_id: '10', province_id: '20', city_id: '30' },
      localized: {
        site_name: { 0: 'Example GmbH-City Plant', 1: 'Example GmbH-City Plant', 8: 'Example GmbH-City Plant' },
        main_product: { 0: '座椅', 1: 'Seats', 8: 'Seats' },
      },
      sources: [{ url: 'https://example.invalid/site' }],
    }],
  }, profile);
  assert.equal(request.records.length, 1);
  assert.equal(request.records[0].record_type, 'PLANT_SITE');
  assert.equal(request.records[0].data_type.status, 'unresolved');
  assert.equal(request.records[0].prefilled_fields.DataType, null);
  assert.ok(request.records[0].forbidden_parent_inheritance_fields.includes('CRN'));
});

test('REVIEW_REQUIRED records never enter formal import selections', () => {
  const artifact = {
    company: 'Example',
    records: [
      matchedRecord('ok-1'),
      {
        ...matchedRecord('review-1'),
        NeedNewSupplier: 'REVIEW_REQUIRED',
        supplier_match: { status: 'REVIEW_REQUIRED', reasons: ['AMBIGUOUS_SUPPLIER_IDENTITY'] },
      },
    ],
  };
  const qa = runQa(artifact, { records: [] }, profile);
  assert.equal(qa.records[0].qa_status, 'APPROVED');
  assert.equal(qa.records[1].qa_status, 'REVIEW_REQUIRED');
  assert.deepEqual(selectFormalRecords(qa, 'PRODUCTION_BASE').map((record) => record.record_id), ['ok-1']);
});

test('non-independent Site parent registration facts are rejected by QA', () => {
  const record = {
    ...matchedRecord('site-leak'),
    record_type: 'PLANT_SITE',
    is_additional_site: true,
    is_independent_legal_entity: false,
    standard_site_name: 'Example GmbH-City Plant',
    legal_entity_name: 'Example GmbH',
    NeedNewSupplier: 'YES',
    supplier_match: { status: 'NEW', supplier_name: null },
    final_supplier_name: 'Example GmbH-City Plant',
  };
  const siteProfile = JSON.parse(JSON.stringify(profile));
  siteProfile.dataTypes.PLANT_SITE = { status: 'confirmed', value: 5 };
  const qa = runQa({ company: 'Example', records: [record] }, {
    records: [{
      record_id: 'site-leak',
      record_type: 'PLANT_SITE',
      status: 'COMPLETED',
      fields: { DataType: 5, CRN: 'PARENT-CRN', TIN: 'PARENT-TIN', ManagePeople: 10000 },
      review: [],
    }],
  }, siteProfile);
  assert.equal(qa.records[0].qa_status, 'REVIEW_REQUIRED');
  assert.ok(qa.records[0].issues.some((issue) => issue.code === 'PARENT_DATA_LEAKAGE_TO_SITE'));
});

test('dry-run export never invokes an Excel template loader', async () => {
  let called = 0;
  const result = await exportExcelArtifacts({
    qaArtifact: { company: 'Example', records: [] },
    config: {},
    profile,
    outputDir: 'unused',
    dryRun: true,
    workbookLoader: async () => { called += 1; throw new Error('must not load'); },
  });
  assert.equal(called, 0);
  assert.equal(result.dry_run, true);
  assert.equal(result.plan.templates_loaded, false);
});

test('supplier and region caches invalidate independently and load once per run', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'supplier-cache-test-'));
  const supplierPath = path.join(temp, 'supplier.csv');
  const regionPath = path.join(temp, 'region.csv');
  await fs.writeFile(supplierPath, 'id,name\n1,A\n', 'utf8');
  await fs.writeFile(regionPath, 'id,name\n1,X\n', 'utf8');
  const counts = { supplier: 0, region: 0 };
  const first = new MasterDataCache({ cacheDir: path.join(temp, 'cache') });
  const supplierFirst = await first.getRows('supplier-master', supplierPath, async () => {
    counts.supplier += 1;
    return [{ id: '1', name: 'A' }];
  });
  await first.getRows('supplier-master', supplierPath, async () => {
    counts.supplier += 1;
    return [];
  });
  await first.getRows('region-master', regionPath, async () => {
    counts.region += 1;
    return [{ id: '1', name: 'X' }];
  });
  assert.equal(supplierFirst.cacheHit, false);
  assert.deepEqual(counts, { supplier: 1, region: 1 });

  await fs.writeFile(regionPath, 'id,name\n1,X\n2,Y\n', 'utf8');
  const second = new MasterDataCache({ cacheDir: path.join(temp, 'cache') });
  const supplierSecond = await second.getRows('supplier-master', supplierPath, async () => {
    counts.supplier += 1;
    return [];
  });
  const regionSecond = await second.getRows('region-master', regionPath, async () => {
    counts.region += 1;
    return [{ id: '1', name: 'X' }, { id: '2', name: 'Y' }];
  });
  assert.equal(supplierSecond.cacheHit, true);
  assert.equal(regionSecond.cacheHit, false);
  assert.deepEqual(counts, { supplier: 1, region: 2 });
});

test('single record merge replaces only that record', () => {
  const merged = mergeRecords(
    { company: 'Example', records: [{ record_id: 'a', value: 1 }, { record_id: 'b', value: 2 }] },
    { company: 'Example', records: [{ record_id: 'b', value: 3 }] },
    'b',
  );
  assert.deepEqual(merged.records, [{ record_id: 'a', value: 1 }, { record_id: 'b', value: 3 }]);
});

test('final renderer uses template columns, expands 0/1/8, and excludes Review records', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'supplier-export-test-'));
  const productionTemplate = path.join(temp, 'production.xlsx');
  const rndTemplate = path.join(temp, 'rnd.xlsx');
  const supplierTemplate = path.join(temp, 'supplier.xlsx');
  await createTemplate(productionTemplate, 'productionbase', profile.templates.productionBase.columns.map((column) => column.name));
  await createTemplate(rndTemplate, 'rdcenterbase', profile.templates.rndCenter.columns.map((column) => column.name));
  await createTemplate(supplierTemplate, 'supplierbase', profile.templates.newSupplier.columns);

  const approved = matchedRecord('approved');
  const review = { ...matchedRecord('held'), qa_status: 'REVIEW_REQUIRED', formal_outputs: [] };
  const qa = {
    company: 'Example Co.',
    records: [{ ...approved, qa_status: 'APPROVED', formal_outputs: ['PRODUCTION_BASE'] }, review],
  };
  const result = await exportExcelArtifacts({
    qaArtifact: qa,
    config: {
      productionBaseTemplate: productionTemplate,
      rndCenterTemplate: rndTemplate,
      newSupplierTemplate: supplierTemplate,
    },
    profile,
    outputDir: path.join(temp, 'output'),
  });
  assert.equal(result.files.length, 4);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(result.files[0]);
  const rows = workbook.getWorksheet('productionbase').getRows(2, 3);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.getCell(8).value), [0, 1, 8]);
  assert.equal(new Set(rows.map((row) => row.getCell(1).value)).size, 1);
  assert.equal(new Set(rows.map((row) => `${row.getCell(4).value}/${row.getCell(5).value}/${row.getCell(6).value}`)).size, 1);
  assert.ok(rows.every((row) => row.getCell(3).value === approved.final_supplier_name));
});

function regionRows() {
  return [
    region('1', '亚洲', '1', null, '0', '1'),
    region('101', 'Asia', '1', null, '1', '1'),
    region('201', 'Asia', '1', null, '8', '1'),
    region('10', '中国', '2', '1', '0', '10'),
    region('110', 'China', '2', '1', '1', '10'),
    region('210', 'China', '2', '1', '8', '10'),
    region('20', '江苏省', '3', '10', '0', '20'),
    region('120', 'Jiangsu', '3', '10', '1', '20'),
    region('220', 'Jiangsu', '3', '10', '8', '20'),
    region('30', '苏州市', '4', '20', '0', '30'),
    region('130', 'Suzhou', '4', '20', '1', '30'),
    region('230', 'Suzhou', '4', '20', '8', '30'),
  ];
}

function region(id, name, level, parentid, languagetype, internalprimarykey) {
  return { id, name, level, parentid: parentid ?? 'NULL', areacode: '', languagetype, internalprimarykey };
}

function hierarchy(country, province, city) {
  return {
    country: { name: country, level: 2 },
    province: { name: province, level: 3 },
    city: { name: city, level: 4 },
    area: null,
  };
}

function supplier(id, companyname, city, MainProduct) {
  return { id, companyname, LocationCountry: '10', Province: '20', city, MainProduct, RecordType: 'LEGAL_ENTITY' };
}

function matchedRecord(recordId) {
  return {
    record_id: recordId,
    dataset: 'PRODUCTION_BASE',
    record_type: 'LEGAL_ENTITY',
    company_name: 'Example Group',
    legal_entity_name: 'Canonical Supplier, Inc.',
    standard_site_name: 'Canonical Supplier, Inc.',
    final_supplier_name: 'CANONICAL Supplier, Inc. ',
    is_additional_site: false,
    issues: [],
    region_match: { status: 'MATCHED', country_id: '10', province_id: '20', city_id: '30', issues: [] },
    NeedNewSupplier: 'NO',
    supplier_match: { status: 'MATCHED', supplier_id: '1', supplier_name: 'CANONICAL Supplier, Inc. ', reasons: [] },
    localized: {
      site_name: { 0: '示例供应商', 1: 'Canonical Supplier, Inc.', 8: 'Canonical Supplier, Inc.' },
      main_product: { 0: '制动系统', 1: 'Brake systems', 8: 'Brake systems' },
      rd_content: { 0: '', 1: '', 8: '' },
    },
    sources: [],
  };
}

async function createTemplate(target, sheetName, headers) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.addRow(headers);
  worksheet.addRow(headers.map(() => 'sample'));
  await workbook.xlsx.writeFile(target);
}
