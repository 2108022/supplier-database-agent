'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { stableStringify } = require('./normalize');

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureDirectory(target) {
  await fsp.mkdir(target, { recursive: true });
  return target;
}

async function readJson(target, fallback = undefined) {
  try {
    return JSON.parse(await fsp.readFile(target, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJsonAtomic(target, value) {
  await ensureDirectory(path.dirname(target));
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, `${stableStringify(value)}\n`, 'utf8');
  await fsp.rename(temporary, target);
  return target;
}

async function sha256File(target) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha256');
    const stream = fs.createReadStream(target);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

async function statFingerprint(target, includeHash = false) {
  const stat = await fsp.stat(target);
  const result = {
    path: path.resolve(target),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
  if (includeHash) result.sha256 = await sha256File(target);
  return result;
}

function sameStat(left, right) {
  return Boolean(
    left
    && right
    && Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs),
  );
}

function slugifyCompany(value) {
  const original = String(value || '').normalize('NFKC').trim();
  if (!original) throw new Error('Company name is required');
  let slug = original
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/[. ]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!slug || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(slug)) {
    slug = `company-${crypto.createHash('sha256').update(original).digest('hex').slice(0, 10)}`;
  }
  return slug.slice(0, 100);
}

function mergeRecords(existingArtifact, changedArtifact, recordId) {
  if (!recordId || !existingArtifact || !Array.isArray(existingArtifact.records)) {
    return changedArtifact;
  }
  const changed = new Map(
    (changedArtifact.records || []).map((record) => [String(record.record_id), record]),
  );
  if (!changed.has(String(recordId))) {
    throw new Error(`Stage did not produce requested record_id: ${recordId}`);
  }
  const merged = [];
  let replaced = false;
  for (const record of existingArtifact.records) {
    if (String(record.record_id) === String(recordId)) {
      merged.push(changed.get(String(recordId)));
      replaced = true;
    } else {
      merged.push(record);
    }
  }
  if (!replaced) merged.push(changed.get(String(recordId)));
  return { ...changedArtifact, records: merged };
}

function pickRecord(records, recordId) {
  if (!recordId) return records;
  const selected = records.filter((record) => String(record.record_id) === String(recordId));
  if (selected.length !== 1) {
    throw new Error(`Expected exactly one upstream record_id=${recordId}; found ${selected.length}`);
  }
  return selected;
}

module.exports = {
  ensureDirectory,
  mergeRecords,
  pathExists,
  pickRecord,
  readJson,
  sameStat,
  sha256File,
  slugifyCompany,
  statFingerprint,
  writeJsonAtomic,
};
