#!/usr/bin/env node
'use strict';

const { companyPaths, loadConfig } = require('./lib/config');
const { ManifestRecorder } = require('./lib/manifest');
const { SupplierPipeline } = require('./lib/pipeline');

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.company) throw new Error(`Company name is required.\n${usage()}`);
  const config = await loadConfig({ rootDir: args.rootDir });
  const paths = companyPaths(config, args.company);
  const manifest = new ManifestRecorder({
    path: paths.manifest,
    company: args.company,
    command: ['node', 'scripts/run-company.js', ...argv].join(' '),
    dryRun: args.dryRun,
    recordId: args.recordId,
  });
  try {
    const pipeline = new SupplierPipeline({
      company: args.company,
      config,
      manifest,
      dryRun: args.dryRun,
      recordId: args.recordId,
      forceCache: args.forceCache,
    });
    const results = await pipeline.run(args.stage);
    await manifest.finish('COMPLETED');
    process.stdout.write(`${JSON.stringify({
      status: 'COMPLETED',
      company: args.company,
      stage: args.stage,
      dry_run: args.dryRun,
      record_id: args.recordId,
      work_dir: paths.workDir,
      output_dir: paths.outputDir,
      completed_stages: Object.keys(results),
      qa: results.qa?.stats || null,
      export: results.export || null,
    }, null, 2)}\n`);
  } catch (error) {
    await manifest.finish('FAILED', error);
    throw error;
  }
}

function parseArgs(argv) {
  const result = {
    company: null,
    stage: 'all',
    recordId: null,
    dryRun: false,
    forceCache: false,
    rootDir: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') result.help = true;
    else if (value === '--dry-run') result.dryRun = true;
    else if (value === '--force-cache') result.forceCache = true;
    else if (value === '--company') result.company = requireValue(argv, ++index, value);
    else if (value === '--stage') result.stage = requireValue(argv, ++index, value);
    else if (value === '--record-id') result.recordId = requireValue(argv, ++index, value);
    else if (value === '--root') result.rootDir = requireValue(argv, ++index, value);
    else if (value.startsWith('--')) throw new Error(`Unknown option: ${value}`);
    else if (!result.company) result.company = value;
    else throw new Error(`Unexpected positional argument: ${value}`);
  }
  return result;
}

function requireValue(argv, index, option) {
  if (index >= argv.length || argv[index].startsWith('--')) throw new Error(`${option} requires a value`);
  return argv[index];
}

function usage() {
  return [
    'Usage: node scripts/run-company.js <company> [options]',
    '',
    'Options:',
    '  --stage <all|normalize|regions|suppliers|new-suppliers|qa|export>',
    '  --record-id <id>   Re-run one logical record and merge it into stage artifacts',
    '  --dry-run          Run through QA and write an export plan without loading Excel templates',
    '  --force-cache      Rebuild supplier and region row caches independently',
    '  --root <path>      Override project root (mainly for tests)',
  ].join('\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
