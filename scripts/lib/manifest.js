'use strict';

const crypto = require('node:crypto');

const { readJson, writeJsonAtomic } = require('./file-utils');

class ManifestRecorder {
  constructor(options = {}) {
    this.path = options.path;
    this.company = options.company;
    this.run = {
      run_id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      completed_at: null,
      command: options.command || null,
      dry_run: Boolean(options.dryRun),
      record_id: options.recordId || null,
      stages: [],
      cache: [],
      qa_statistics: null,
      warnings: [],
      status: 'RUNNING',
    };
  }

  startStage(name, details = {}) {
    return { name, details, started: process.hrtime.bigint(), startedAt: new Date().toISOString() };
  }

  endStage(token, details = {}) {
    const durationMs = Number(process.hrtime.bigint() - token.started) / 1e6;
    const stage = {
      name: token.name,
      started_at: token.startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: round(durationMs),
      ...token.details,
      ...details,
    };
    this.run.stages.push(stage);
    return stage;
  }

  recordCache(event) {
    this.run.cache.push(sanitizeCacheEvent(event));
  }

  setQaStatistics(stats) {
    this.run.qa_statistics = stats ? { ...stats } : null;
  }

  warn(message) {
    if (message && !this.run.warnings.includes(String(message))) this.run.warnings.push(String(message));
  }

  async finish(status = 'COMPLETED', error = null) {
    this.run.status = status;
    this.run.completed_at = new Date().toISOString();
    if (error) this.run.error = error instanceof Error ? error.message : String(error);
    if (!this.path) return this.run;
    const existing = await readJson(this.path, { company: this.company, runs: [] });
    const manifest = {
      manifest_version: 1,
      company: this.company,
      latest_run_id: this.run.run_id,
      latest_status: this.run.status,
      updated_at: this.run.completed_at,
      runs: [...(existing.runs || []), this.run].slice(-50),
    };
    await writeJsonAtomic(this.path, manifest);
    return manifest;
  }
}

function sanitizeCacheEvent(event) {
  const output = {
    dataset: event.dataset,
    layer: event.layer,
    hit: Boolean(event.hit),
    reason: event.reason || null,
    row_count: event.rowCount ?? null,
    duration_ms: event.durationMs === undefined ? null : round(event.durationMs),
  };
  if (event.fingerprint) {
    output.fingerprint = {
      size: event.fingerprint.size,
      mtime_ms: event.fingerprint.mtimeMs,
      sha256: event.fingerprint.sha256 || null,
    };
  }
  return output;
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

module.exports = {
  ManifestRecorder,
};
