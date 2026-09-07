'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { ensureDirectory, pathExists, sameStat, sha256File, statFingerprint } = require('./file-utils');

const CACHE_FORMAT_VERSION = 1;

class MasterDataCache {
  constructor(options = {}) {
    if (!options.cacheDir) throw new Error('cacheDir is required');
    this.cacheDir = path.resolve(options.cacheDir);
    this.memo = new Map();
    this.events = [];
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  }

  async getRows(datasetName, sourcePath, loader, options = {}) {
    const key = `${datasetName}:${path.resolve(sourcePath)}`;
    if (this.memo.has(key) && !options.force) {
      const memoized = this.memo.get(key);
      this.emit({
        dataset: datasetName,
        sourcePath: path.resolve(sourcePath),
        layer: 'memory',
        hit: true,
        rowCount: memoized.rows.length,
        fingerprint: memoized.fingerprint,
      });
      return memoized;
    }

    await ensureDirectory(this.cacheDir);
    const cachePath = path.join(this.cacheDir, `${safeName(datasetName)}.rows.v${CACHE_FORMAT_VERSION}.json`);
    const currentStat = await statFingerprint(sourcePath, false);
    let cached = null;
    if (!options.force && await pathExists(cachePath)) {
      try {
        cached = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      } catch (error) {
        this.emit({
          dataset: datasetName,
          sourcePath: path.resolve(sourcePath),
          layer: 'disk',
          hit: false,
          reason: 'invalid-cache',
          error: error.message,
        });
      }
    }

    if (
      cached
      && cached.formatVersion === CACHE_FORMAT_VERSION
      && sameStat(cached.fingerprint, currentStat)
      && Array.isArray(cached.rows)
    ) {
      const result = { rows: cached.rows, fingerprint: cached.fingerprint, cachePath, cacheHit: true };
      this.memo.set(key, result);
      this.emit({
        dataset: datasetName,
        sourcePath: path.resolve(sourcePath),
        layer: 'disk',
        hit: true,
        reason: 'size-and-mtime-match',
        rowCount: cached.rows.length,
        fingerprint: cached.fingerprint,
      });
      return result;
    }

    let currentHash = null;
    if (cached?.fingerprint?.sha256 && !options.force) {
      currentHash = await sha256File(sourcePath);
      if (currentHash === cached.fingerprint.sha256 && Array.isArray(cached.rows)) {
        const fingerprint = { ...currentStat, sha256: currentHash };
        const payload = {
          formatVersion: CACHE_FORMAT_VERSION,
          dataset: datasetName,
          fingerprint,
          rows: cached.rows,
        };
        await writeCache(cachePath, payload);
        const result = { rows: cached.rows, fingerprint, cachePath, cacheHit: true };
        this.memo.set(key, result);
        this.emit({
          dataset: datasetName,
          sourcePath: path.resolve(sourcePath),
          layer: 'disk',
          hit: true,
          reason: 'hash-match-mtime-refreshed',
          rowCount: cached.rows.length,
          fingerprint,
        });
        return result;
      }
    }

    const started = process.hrtime.bigint();
    const rows = await loader(sourcePath);
    if (!Array.isArray(rows)) throw new TypeError(`${datasetName} loader must return an array`);
    currentHash = currentHash || await sha256File(sourcePath);
    const fingerprint = { ...currentStat, sha256: currentHash };
    await writeCache(cachePath, {
      formatVersion: CACHE_FORMAT_VERSION,
      dataset: datasetName,
      fingerprint,
      rows,
    });
    const result = { rows, fingerprint, cachePath, cacheHit: false };
    this.memo.set(key, result);
    this.emit({
      dataset: datasetName,
      sourcePath: path.resolve(sourcePath),
      layer: 'disk',
      hit: false,
      reason: options.force ? 'forced-rebuild' : cached ? 'source-changed' : 'cache-missing',
      rowCount: rows.length,
      durationMs: elapsedMs(started),
      fingerprint,
    });
    return result;
  }

  invalidateMemory(datasetName) {
    for (const key of this.memo.keys()) {
      if (key.startsWith(`${datasetName}:`)) this.memo.delete(key);
    }
  }

  emit(event) {
    this.events.push(event);
    if (this.onEvent) this.onEvent(event);
  }
}

async function writeCache(target, payload) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(payload), 'utf8');
  await fsp.rename(temporary, target);
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'dataset';
}

function elapsedMs(started) {
  return Number(process.hrtime.bigint() - started) / 1e6;
}

module.exports = {
  CACHE_FORMAT_VERSION,
  MasterDataCache,
};
