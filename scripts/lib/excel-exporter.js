'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { ensureDirectory } = require('./file-utils');
const { expandLanguageRows, localizedValue } = require('./language');
const { selectFormalRecords } = require('./qa-gate');

async function exportExcelArtifacts(options) {
  const {
    qaArtifact,
    config,
    profile,
    outputDir,
    dryRun = false,
    workbookLoader = defaultWorkbookLoader,
  } = options;
  const plan = buildExportPlan(qaArtifact, profile);
  if (dryRun) return { dry_run: true, plan, files: [] };

  await ensureDirectory(outputDir);
  const fileStem = safeFileStem(qaArtifact.company);
  const productionPath = path.join(outputDir, `01_${fileStem}_ProductionBase_Import.xlsx`);
  const rndPath = path.join(outputDir, `02_${fileStem}_RDCenter_Import.xlsx`);
  const newSupplierPath = path.join(outputDir, `03_${fileStem}_NewSupplier_Import.xlsx`);
  const reviewPath = path.join(outputDir, `04_${fileStem}_Review.xlsx`);

  const productionRecords = selectFormalRecords(qaArtifact, 'PRODUCTION_BASE');
  const rndRecords = selectFormalRecords(qaArtifact, 'RND_CENTER');
  const newSupplierRecords = selectFormalRecords(qaArtifact, 'NEW_SUPPLIER');
  const languages = profile.languagePolicy?.outputLanguageTypes || [0, 1, 8];

  const productionRows = expandLanguageRows(
    productionRecords,
    mapProductionRow,
    { languages },
  );
  const rndRows = expandLanguageRows(rndRecords, mapRndRow, { languages });
  const newSupplierRows = expandLanguageRows(
    newSupplierRecords,
    (record, languageType) => mapNewSupplierRow(record, languageType, profile),
    { languages },
  );

  await renderFromTemplate({
    templatePath: config.productionBaseTemplate,
    outputPath: productionPath,
    sheetName: profile.templates.productionBase.sheet,
    columns: profile.templates.productionBase.columns.map((column) => column.name),
    rows: productionRows,
    workbookLoader,
  });
  await renderFromTemplate({
    templatePath: config.rndCenterTemplate,
    outputPath: rndPath,
    sheetName: profile.templates.rndCenter.sheet,
    columns: profile.templates.rndCenter.columns.map((column) => column.name),
    rows: rndRows,
    workbookLoader,
  });
  await renderFromTemplate({
    templatePath: config.newSupplierTemplate,
    outputPath: newSupplierPath,
    sheetName: profile.templates.newSupplier.sheet,
    columns: profile.templates.newSupplier.columns,
    rows: newSupplierRows,
    workbookLoader,
  });
  await renderReviewWorkbook(qaArtifact, reviewPath);

  return {
    dry_run: false,
    plan: { ...plan, templates_loaded: true },
    files: [productionPath, rndPath, newSupplierPath, reviewPath],
  };
}

function buildExportPlan(qaArtifact, profile) {
  const languages = profile.languagePolicy?.outputLanguageTypes || [0, 1, 8];
  const production = selectFormalRecords(qaArtifact, 'PRODUCTION_BASE');
  const rnd = selectFormalRecords(qaArtifact, 'RND_CENTER');
  const suppliers = selectFormalRecords(qaArtifact, 'NEW_SUPPLIER');
  const review = (qaArtifact.records || []).filter((record) => record.qa_status !== 'APPROVED');
  return {
    templates_loaded: false,
    language_types: languages,
    production_base: { logical_records: production.length, excel_rows: production.length * languages.length },
    rnd_center: { logical_records: rnd.length, excel_rows: rnd.length * languages.length },
    new_supplier: { logical_records: suppliers.length, excel_rows: suppliers.length * languages.length },
    review_required: review.length,
  };
}

function mapProductionRow(record, languageType) {
  const exactExistingName = record.NeedNewSupplier === 'NO' ? record.final_supplier_name : null;
  return {
    CompanyName: localizedValue(record.localized?.company_name || record.company_name, languageType),
    ProBaseName: exactExistingName || localizedValue(record.localized?.site_name, languageType, { fallback: record.standard_site_name }),
    Country: excelIdentifier(record.region_match?.country_id),
    Province: excelIdentifier(record.region_match?.province_id),
    City: excelIdentifier(record.region_match?.city_id),
    MainProduct: localizedValue(record.localized?.main_product, languageType),
    操作状态: record.operation_status || '',
  };
}

function mapRndRow(record, languageType) {
  const exactExistingName = record.NeedNewSupplier === 'NO' ? record.final_supplier_name : null;
  return {
    CompanyName: localizedValue(record.localized?.company_name || record.company_name, languageType),
    RdCenterName: exactExistingName || localizedValue(record.localized?.site_name, languageType, { fallback: record.standard_site_name }),
    Country: excelIdentifier(record.region_match?.country_id),
    Province: excelIdentifier(record.region_match?.province_id),
    City: excelIdentifier(record.region_match?.city_id),
    RDContent: localizedValue(record.localized?.rd_content, languageType),
    操作状态: record.operation_status || '',
  };
}

function mapNewSupplierRow(record, languageType, profile) {
  const fields = { ...(record.new_supplier?.fields || {}) };
  applyCanonicalFieldAliases(fields, profile.templates.newSupplier.canonicalFieldMap || {});
  const output = {};
  for (const column of profile.templates.newSupplier.columns) {
    output[column] = localizedValue(fields[column], languageType, { fallback: fields[column] ?? '' });
  }
  output.CompanyName = localizedValue(
    fields.CompanyName || record.localized?.site_name,
    languageType,
    { fallback: record.standard_site_name },
  );
  output.DataType = fields.DataType;
  output.StreetAddress = fields.StreetAddress || record.address || record.geography?.detailed_address || '';
  output.LocationCountry = excelIdentifier(fields.LocationCountry || record.region_match?.country_id);
  output.Province = excelIdentifier(fields.Province || record.region_match?.province_id);
  output.City = excelIdentifier(fields.City || record.region_match?.city_id);
  output.PostCode = textIdentifier(fields.PostCode || record.geography?.post_code);
  output.MainProduct = localizedValue(
    fields.MainProduct || (record.dataset === 'RND_CENTER' ? record.localized?.rd_content : record.localized?.main_product),
    languageType,
  );
  output.IsHidden = fields.IsHidden === '' || fields.IsHidden === null || fields.IsHidden === undefined
    ? ''
    : Number(fields.IsHidden);
  return output;
}

function applyCanonicalFieldAliases(fields, canonicalFieldMap) {
  for (const [canonical, actual] of Object.entries(canonicalFieldMap)) {
    if (!actual || canonical.includes('/')) continue;
    if ((fields[actual] === undefined || fields[actual] === null || fields[actual] === '') && fields[canonical] !== undefined) {
      fields[actual] = fields[canonical];
    }
  }
}

async function renderFromTemplate(options) {
  const workbook = await options.workbookLoader(options.templatePath);
  const worksheet = workbook.getWorksheet(options.sheetName);
  if (!worksheet) throw new Error(`Template sheet not found: ${options.sheetName}`);
  const actualHeaders = options.columns.map((_, index) => String(worksheet.getRow(1).getCell(index + 1).value ?? ''));
  if (!arraysEqual(actualHeaders, options.columns)) {
    throw new Error(
      `Template header mismatch in ${options.sheetName}: expected ${JSON.stringify(options.columns)}, got ${JSON.stringify(actualHeaders)}`,
    );
  }
  const styleTemplate = captureRowStyle(worksheet.getRow(2), options.columns.length);
  if (worksheet.rowCount > 1) worksheet.spliceRows(2, worksheet.rowCount - 1);
  for (const rowObject of options.rows) {
    const values = options.columns.map((column) => normalizeCellValue(rowObject[column]));
    const row = worksheet.addRow(values);
    applyRowStyle(row, styleTemplate);
  }
  for (const other of [...workbook.worksheets]) {
    if (other.name !== options.sheetName) workbook.removeWorksheet(other.id);
  }
  await writeWorkbookAtomic(workbook, options.outputPath);
}

async function renderReviewWorkbook(qaArtifact, outputPath) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Review');
  const headers = [
    'record_id', 'Dataset', 'RecordType', 'StandardSiteName', 'QAStatus',
    'NeedNewSupplier', 'MatchedSupplierName', 'RegionStatus', 'Issues', 'Sources',
  ];
  worksheet.addRow(headers);
  for (const record of qaArtifact.records || []) {
    worksheet.addRow([
      record.record_id,
      record.dataset,
      record.record_type,
      record.standard_site_name,
      record.qa_status,
      record.NeedNewSupplier,
      record.supplier_match?.supplier_name || '',
      record.region_match?.status || '',
      JSON.stringify(record.issues || []),
      JSON.stringify(record.sources || []),
    ]);
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: 'J1' };
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  const widths = [24, 18, 16, 42, 18, 20, 42, 18, 70, 70];
  worksheet.columns.forEach((column, index) => { column.width = widths[index]; });
  worksheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: 'top', wrapText: rowNumber > 1 };
  });
  await writeWorkbookAtomic(workbook, outputPath);
}

async function defaultWorkbookLoader(target) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(target);
  return workbook;
}

async function writeWorkbookAtomic(workbook, outputPath) {
  await ensureDirectory(path.dirname(outputPath));
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp.xlsx`;
  await workbook.xlsx.writeFile(temporary);
  await fsp.rename(temporary, outputPath);
}

function captureRowStyle(row, width) {
  const cells = [];
  for (let column = 1; column <= width; column += 1) {
    const cell = row.getCell(column);
    cells.push({
      style: cloneStyle(cell.style),
      numFmt: cell.numFmt,
      alignment: cloneStyle(cell.alignment),
    });
  }
  return { height: row.height, cells };
}

function applyRowStyle(row, template) {
  if (template.height) row.height = template.height;
  template.cells.forEach((item, index) => {
    const cell = row.getCell(index + 1);
    if (item.style) cell.style = cloneStyle(item.style);
    if (item.numFmt) cell.numFmt = item.numFmt;
    if (item.alignment) cell.alignment = cloneStyle(item.alignment);
  });
}

function cloneStyle(value) {
  if (!value || !Object.keys(value).length) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function excelIdentifier(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  if (/^\d{1,15}$/u.test(text)) return Number(text);
  return text;
}

function textIdentifier(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function safeFileStem(value) {
  return String(value || 'Company')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/\s+/gu, '_')
    .replace(/[. ]+$/gu, '')
    .slice(0, 80) || 'Company';
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

module.exports = {
  applyCanonicalFieldAliases,
  buildExportPlan,
  defaultWorkbookLoader,
  exportExcelArtifacts,
  mapNewSupplierRow,
  mapProductionRow,
  mapRndRow,
  renderFromTemplate,
  safeFileStem,
};
