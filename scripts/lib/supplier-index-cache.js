'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { pathExists, sameStat, sha256File, statFingerprint } = require('./file-utils');

const SUPPLIER_INDEX_CACHE_VERSION = 1;

async function loadPersistentSupplierIndex(options) {
  const {
    sourcePath,
    cacheDir,
    force = false,
    build,
    onEvent = null,
  } = options;
  const cachePath = path.join(cacheDir, `supplier-master.index.v${SUPPLIER_INDEX_CACHE_VERSION}.json`);
  const currentStat = await statFingerprint(sourcePath, false);
  let payload = null;
  if (!force && await pathExists(cachePath)) {
    try {
      payload = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
    } catch (error) {
      onEvent?.({ dataset: 'supplier-index', layer: 'disk', hit: false, reason: 'invalid-cache', error: error.message });
    }
  }

  if (validPayload(payload) && sameStat(payload.fingerprint, currentStat)) {
    const index = hydrateSupplierIndex(payload);
    onEvent?.({
      dataset: 'supplier-index', layer: 'disk', hit: true, reason: 'size-and-mtime-match',
      rowCount: index.entries.length, fingerprint: payload.fingerprint,
    });
    return { index, cachePath, cacheHit: true, fingerprint: payload.fingerprint };
  }

  if (validPayload(payload) && payload.fingerprint?.sha256 && !force) {
    const currentHash = await sha256File(sourcePath);
    if (currentHash === payload.fingerprint.sha256) {
      payload.fingerprint = { ...currentStat, sha256: currentHash };
      await writePayload(cachePath, payload);
      const index = hydrateSupplierIndex(payload);
      onEvent?.({
        dataset: 'supplier-index', layer: 'disk', hit: true, reason: 'hash-match-mtime-refreshed',
        rowCount: index.entries.length, fingerprint: payload.fingerprint,
      });
      return { index, cachePath, cacheHit: true, fingerprint: payload.fingerprint };
    }
  }

  payload = null;
  const started = process.hrtime.bigint();
  const built = await build();
  const serialized = serializeSupplierIndexCompact(built.index, built.fingerprint, built.sourceHeaders);
  await writePayload(cachePath, serialized);
  onEvent?.({
    dataset: 'supplier-index', layer: 'disk', hit: false,
    reason: force ? 'forced-rebuild' : payload ? 'source-changed' : 'cache-missing',
    rowCount: built.index.entries.length,
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    fingerprint: built.fingerprint,
  });
  return { index: built.index, cachePath, cacheHit: false, fingerprint: built.fingerprint };
}

function serializeSupplierIndexCompact(index, fingerprint, sourceHeaders = []) {
  const entryPosition = new Map(index.entries.map((entry, position) => [entry, position]));
  return {
    formatVersion: SUPPLIER_INDEX_CACHE_VERSION,
    type: 'supplier-index-compact',
    fingerprint,
    fields: index.fields,
    recordTypeMap: index.recordTypeMap,
    sourceHeaders,
    issues: index.issues,
    entries: index.entries.map(serializeEntry),
    lookups: {
      byId: serializeLookup(index.byId, entryPosition, true),
      byExactName: serializeLookup(index.byExactName, entryPosition, false),
      byCoreName: serializeLookup(index.byCoreName, entryPosition, false),
      byToken: serializeLookup(index.byToken, entryPosition, false),
      byAcronym: serializeLookup(index.byAcronym, entryPosition, false),
    },
  };
}

function hydrateSupplierIndex(payload) {
  const entries = payload.entries;
  const hydrate = (position) => hydrateEntry(entries[position]);
  return {
    type: 'supplier-index',
    fields: payload.fields || {},
    recordTypeMap: payload.recordTypeMap || {},
    sourceRows: [],
    sourceHeaders: payload.sourceHeaders || [],
    entries,
    byId: new LazyEntryLookup(payload.lookups.byId, hydrate, true),
    byExactName: new LazyEntryLookup(payload.lookups.byExactName, hydrate, false),
    byCoreName: new LazyEntryLookup(payload.lookups.byCoreName, hydrate, false),
    byToken: new LazyEntryLookup(payload.lookups.byToken, hydrate, false),
    byAcronym: new LazyEntryLookup(payload.lookups.byAcronym, hydrate, false),
    byAlias: new Map(),
    reviewedPositive: new Map(),
    reviewedNegative: new Set(),
    issues: payload.issues || [],
    hookStats: { aliasesRead: 0, aliasesConnected: 0, reviewRowsRead: 0, reviewRowsConnected: 0 },
  };
}

class LazyEntryLookup {
  constructor(pairs, hydrate, single) {
    this.data = Object.create(null);
    for (const [key, value] of pairs || []) this.data[key] = value;
    this.hydrate = hydrate;
    this.single = single;
    this.size = (pairs || []).length;
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  get(key) {
    if (!this.has(key)) return undefined;
    const value = this.data[key];
    if (this.single) return this.hydrate(value);
    return value.map(this.hydrate);
  }
}

function serializeEntry(entry) {
  return {
    id: entry.id,
    supplierName: entry.supplierName,
    normalizedName: entry.normalizedName,
    coreName: entry.coreName,
    recordType: entry.recordType,
    dataType: entry.dataType,
    regionIds: [...entry.regionIds],
    regionHierarchy: entry.regionHierarchy,
    locationNames: entry.locationNames,
    locationTokens: [...entry.locationTokens],
    products: entry.products,
    productTokens: [...entry.productTokens],
    distinctiveTokens: [...entry.distinctiveTokens],
    acronym: entry.acronym,
    rowIndex: entry.rowIndex,
  };
}

function hydrateEntry(entry) {
  if (!(entry.regionIds instanceof Set)) entry.regionIds = new Set(entry.regionIds || []);
  if (!(entry.locationTokens instanceof Set)) entry.locationTokens = new Set(entry.locationTokens || []);
  if (!(entry.productTokens instanceof Set)) entry.productTokens = new Set(entry.productTokens || []);
  if (!(entry.distinctiveTokens instanceof Set)) entry.distinctiveTokens = new Set(entry.distinctiveTokens || []);
  return entry;
}

function serializeLookup(map, entryPosition, single) {
  const output = [];
  for (const [key, value] of map) {
    if (single) {
      const position = entryPosition.get(value);
      if (position !== undefined) output.push([key, position]);
    } else {
      const positions = value.map((entry) => entryPosition.get(entry)).filter((position) => position !== undefined);
      output.push([key, positions]);
    }
  }
  return output;
}

function validPayload(payload) {
  return Boolean(
    payload
    && payload.formatVersion === SUPPLIER_INDEX_CACHE_VERSION
    && payload.type === 'supplier-index-compact'
    && Array.isArray(payload.entries)
    && payload.lookups,
  );
}

async function writePayload(target, payload) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(payload), 'utf8');
  await fsp.rename(temporary, target);
}

module.exports = {
  SUPPLIER_INDEX_CACHE_VERSION,
  LazyEntryLookup,
  hydrateSupplierIndex,
  loadPersistentSupplierIndex,
  serializeSupplierIndexCompact,
};
