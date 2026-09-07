'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { readTabularFile, readXlsxRows } = require('./data-io');
const { pathExists, readJson, sameStat, sha256File, statFingerprint, writeJsonAtomic } = require('./file-utils');
const { MasterDataCache } = require('./master-cache');
const { buildRegionIndex } = require('./region-index');
const {
  attachReviewedHistory,
  attachSupplierAliases,
  buildSupplierIndex,
} = require('./supplier-index');
const { loadPersistentSupplierIndex } = require('./supplier-index-cache');

class ReferenceStore {
  constructor(config, options = {}) {
    this.config = config;
    this.dryRun = Boolean(options.dryRun);
    this.forceCache = Boolean(options.forceCache);
    this.manifest = options.manifest || null;
    this.memo = new Map();
    this.warnings = [];
    this.cacheEvents = [];
    this.masterCache = new MasterDataCache({
      cacheDir: config.cacheDir,
      onEvent: (event) => this.recordCache(event),
    });
  }

  async getTemplateProfile() {
    return this.memoize('template-profile', () => readJson(this.config.templateProfile));
  }

  async getRegionIndex() {
    return this.memoize('region-index', async () => {
      const cached = await this.masterCache.getRows(
        'region-master',
        this.config.regionMaster,
        (target) => readTabularFile(target),
        { force: this.forceCache },
      );
      const index = buildRegionIndex(cached.rows);
      index.cache = { hit: cached.cacheHit, fingerprint: cached.fingerprint, path: cached.cachePath };
      return index;
    });
  }

  async getSupplierIndex() {
    return this.memoize('supplier-index', async () => {
      const profile = await this.getTemplateProfile();
      const recordTypeMap = {};
      for (const [recordType, setting] of Object.entries(profile.dataTypes || {})) {
        if (setting.status === 'confirmed' && setting.value !== null) {
          recordTypeMap[String(setting.value)] = recordType;
        }
      }
      const persistent = await loadPersistentSupplierIndex({
        sourcePath: this.config.supplierMaster,
        cacheDir: this.config.cacheDir,
        force: this.forceCache,
        onEvent: (event) => this.recordCache(event),
        build: async () => {
          const cached = await this.masterCache.getRows(
            'supplier-master',
            this.config.supplierMaster,
            (target) => readTabularFile(target, {
              requiredHeaders: ['id', 'companyname', 'MainProduct'],
            }),
            { force: this.forceCache },
          );
          return {
            index: buildSupplierIndex(cached.rows, { recordTypeMap }),
            fingerprint: cached.fingerprint,
            sourceHeaders: Object.keys(cached.rows[0] || {}),
          };
        },
      });
      const index = persistent.index;
      const hooks = await this.getMatchingHooks();
      attachSupplierAliases(index, hooks.aliases);
      attachReviewedHistory(index, hooks.reviewHistory);
      index.cache = { hit: persistent.cacheHit, fingerprint: persistent.fingerprint, path: persistent.cachePath };
      index.hookSources = hooks.sources;
      return index;
    });
  }

  async getMatchingHooks() {
    return this.memoize('matching-hooks', async () => {
      const aliases = [];
      const reviewHistory = [];
      const sources = [];

      const embedded = await this.loadEmbeddedHistoryCache();
      aliases.push(...embedded.rows);
      if (embedded.source) sources.push(embedded.source);

      for (const target of this.config.supplierAliasCandidates || []) {
        if (!await pathExists(target)) continue;
        aliases.push(...await readTabularFile(target));
        sources.push({ type: 'supplier-alias', path: target });
      }
      for (const target of this.config.reviewedHistoryCandidates || []) {
        if (!await pathExists(target)) continue;
        reviewHistory.push(...await readTabularFile(target));
        sources.push({ type: 'reviewed-history', path: target });
      }
      return { aliases, reviewHistory, sources };
    });
  }

  async ensureEmbeddedHistoryCache() {
    const cachePath = this.embeddedHistoryCachePath();
    const templatePath = this.config.productionBaseTemplate;
    if (!await pathExists(templatePath)) {
      return { rows: [], source: null, warning: 'production template is missing' };
    }
    const stat = await statFingerprint(templatePath, false);
    const cached = await readJson(cachePath, null);
    if (cached && sameStat(cached.fingerprint, stat) && Array.isArray(cached.rows)) {
      return {
        rows: cached.rows,
        source: { type: 'embedded-reviewed-alias-cache', path: cachePath, cacheHit: true },
      };
    }
    const rows = await extractEmbeddedReviewedAliases(templatePath);
    const fingerprint = { ...stat, sha256: await sha256File(templatePath) };
    await writeJsonAtomic(cachePath, {
      formatVersion: 1,
      source: templatePath,
      sheet: 'Sheet2',
      fingerprint,
      rows,
    });
    this.memo.delete('matching-hooks');
    return {
      rows,
      source: { type: 'embedded-reviewed-alias-cache', path: cachePath, cacheHit: false },
    };
  }

  async loadEmbeddedHistoryCache() {
    const cachePath = this.embeddedHistoryCachePath();
    const cached = await readJson(cachePath, null);
    if (!cached || !Array.isArray(cached.rows)) {
      if (this.dryRun) {
        this.warnings.push('Reviewed history cache is missing; dry-run did not load the production Excel template.');
        return { rows: [], source: null };
      }
      return this.ensureEmbeddedHistoryCache();
    }

    if (!await pathExists(this.config.productionBaseTemplate)) {
      this.warnings.push('Production template is missing; using the last local reviewed-history cache.');
      return {
        rows: cached.rows,
        source: { type: 'embedded-reviewed-alias-cache', path: cachePath, cacheHit: true, staleCheck: 'source-missing' },
      };
    }
    const stat = await statFingerprint(this.config.productionBaseTemplate, false);
    if (sameStat(cached.fingerprint, stat)) {
      return {
        rows: cached.rows,
        source: { type: 'embedded-reviewed-alias-cache', path: cachePath, cacheHit: true },
      };
    }
    if (this.dryRun) {
      this.warnings.push('Reviewed history cache is stale; dry-run did not load the changed production Excel template.');
      return { rows: [], source: null };
    }
    return this.ensureEmbeddedHistoryCache();
  }

  embeddedHistoryCachePath() {
    return path.join(this.config.cacheDir, 'embedded-reviewed-supplier-aliases.v1.json');
  }

  recordCache(event) {
    this.cacheEvents.push(event);
    this.manifest?.recordCache(event);
  }

  async memoize(key, loader) {
    if (!this.memo.has(key)) this.memo.set(key, Promise.resolve().then(loader));
    return this.memo.get(key);
  }
}

async function extractEmbeddedReviewedAliases(templatePath) {
  const rows = await readXlsxRows(templatePath, {
    sheetName: 'Sheet2',
    requiredHeaders: ['原公司名称', '供应商表中的名称（严格保留大小写）'],
  });
  return rows
    .map((row) => ({
      Alias: row['原公司名称'],
      SupplierName: row['供应商表中的名称（严格保留大小写）'],
      Status: 'confirmed',
      Source: 'productionbase_import_template.xlsx/Sheet2',
    }))
    .filter((row) => {
      const target = String(row.SupplierName || '').trim();
      return row.Alias && target && !/^未找到|待确认|无对应/iu.test(target);
    });
}

async function validateTemplateHeaders(templatePath, sheetName, expectedHeaders) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    return { ok: false, reason: `Missing sheet: ${sheetName}`, actualHeaders: [] };
  }
  const actualHeaders = [];
  const headerRow = worksheet.getRow(1);
  for (let column = 1; column <= expectedHeaders.length; column += 1) {
    actualHeaders.push(String(headerRow.getCell(column).value ?? ''));
  }
  const ok = expectedHeaders.length === actualHeaders.length
    && expectedHeaders.every((header, index) => header === actualHeaders[index]);
  return { ok, expectedHeaders, actualHeaders, sheetName, templatePath };
}

module.exports = {
  ReferenceStore,
  extractEmbeddedReviewedAliases,
  validateTemplateHeaders,
};
