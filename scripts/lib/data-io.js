'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { normalizeLookup } = require('./normalize');

async function readTabularFile(target, options = {}) {
  const extension = path.extname(target).toLocaleLowerCase('und');
  if (extension === '.csv' || extension === '.tsv') {
    return readDelimited(target, { delimiter: extension === '.tsv' ? '\t' : ',', ...options });
  }
  if (extension === '.json') {
    const payload = JSON.parse(await fsp.readFile(target, 'utf8'));
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.records)) return payload.records;
    throw new Error(`JSON tabular file must be an array or contain records[]: ${target}`);
  }
  if (extension === '.xlsx' || extension === '.xlsm') {
    return readXlsxRows(target, options);
  }
  throw new Error(`Unsupported tabular file type: ${target}`);
}

async function readDelimited(target, options = {}) {
  const { parse } = require('csv-parse');
  const records = [];
  const parser = fs.createReadStream(target).pipe(parse({
    bom: true,
    columns: true,
    delimiter: options.delimiter || ',',
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: false,
  }));
  for await (const record of parser) records.push(record);
  return records;
}

async function readXlsxRows(target, options = {}) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(target);
  const worksheet = selectWorksheet(workbook, options);
  if (!worksheet) throw new Error(`No worksheet found in ${target}`);
  const headerRowNumber = Number(options.headerRow || 1);
  const headerRow = worksheet.getRow(headerRowNumber);
  const width = Math.max(headerRow.cellCount, worksheet.columnCount);
  const headers = [];
  for (let column = 1; column <= width; column += 1) {
    headers.push(cellValue(headerRow.getCell(column)));
  }
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  if (!headers.length) throw new Error(`No headers found in ${target} / ${worksheet.name}`);

  const rows = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const output = {};
    let populated = false;
    for (let column = 1; column <= headers.length; column += 1) {
      const header = headers[column - 1];
      if (!header) continue;
      const value = cellValue(row.getCell(column));
      output[String(header)] = value;
      if (value !== null && value !== undefined && value !== '') populated = true;
    }
    if (populated) rows.push(output);
  }
  return rows;
}

function selectWorksheet(workbook, options = {}) {
  if (options.sheetName) return workbook.getWorksheet(options.sheetName);
  if (Array.isArray(options.requiredHeaders) && options.requiredHeaders.length) {
    const wanted = options.requiredHeaders.map(normalizeHeader);
    for (const worksheet of workbook.worksheets) {
      const actual = [];
      const row = worksheet.getRow(Number(options.headerRow || 1));
      for (let column = 1; column <= Math.max(row.cellCount, worksheet.columnCount); column += 1) {
        actual.push(normalizeHeader(cellValue(row.getCell(column))));
      }
      if (wanted.every((header) => actual.includes(header))) return worksheet;
    }
  }
  return workbook.worksheets.find((worksheet) => worksheet.state === 'visible')
    || workbook.worksheets[0];
}

function cellValue(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || '').join('');
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return value.text;
    if (Object.prototype.hasOwnProperty.call(value, 'hyperlink')) return value.text || value.hyperlink;
  }
  return value;
}

function normalizeHeader(value) {
  return normalizeLookup(value, { stripDiacritics: false }).replace(/\s+/gu, '');
}

module.exports = {
  cellValue,
  normalizeHeader,
  readDelimited,
  readTabularFile,
  readXlsxRows,
  selectWorksheet,
};
