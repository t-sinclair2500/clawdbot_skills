#!/usr/bin/env node

/**
 * Ralph Self-Test Runner (no external deps)
 *
 * Validates core invariants:
 * - Only one worker can claim a step (lock exclusivity)
 * - Corrupted step files are rejected unless --force-overwrite
 * - Concurrent state updates do not lose step status updates
 * - Latest validation selection is numeric (iteration-10 > iteration-2)
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { keep: false, verbose: false };
  for (const arg of args) {
    if (arg === '--keep') out.keep = true;
    else if (arg === '--verbose') out.verbose = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown arg: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    'Usage: node scripts/ralph-self-test.mjs [--verbose] [--keep]',
    '',
    'Exit codes:',
    '  0 = all tests passed',
    '  1 = a test failed',
    ''
  ].join('\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function spawnNode(args, { cwd, verbose }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString('utf-8')));
    child.stderr.on('data', d => (stderr += d.toString('utf-8')));
    child.on('error', rejectPromise);
    child.on('close', code => {
      if (verbose) {
        const cmd = [process.execPath, ...args].join(' ');
        // eslint-disable-next-line no-console
        console.log(`\n$ ${cmd}\n(exit ${code})\n${stdout}${stderr}`);
      }
      resolvePromise({ code, stdout, stderr });
    });
  });
}

function nodePath(scriptName) {
  return join(__dirname, scriptName);
}

async function testExclusiveClaim({ cwd, stateDir, verbose }) {
  const init = spawnSync(process.execPath, [nodePath('ralph-init.mjs'), 'Self test', '--state-dir', stateDir], { cwd, encoding: 'utf-8' });
  assert(init.status === 0, `init failed: ${init.stderr || init.stdout}`);

  const stateFile = join(cwd, stateDir, 'ralph-state.json');
  const state = readJson(stateFile);
  state.steps = { 'step-1': { description: 'demo', status: 'pending' } };
  writeJson(stateFile, state);

  const workers = Array.from({ length: 12 }, (_, i) => `w${i + 1}`);
  const results = await Promise.all(
    workers.map(workerId =>
      spawnNode([nodePath('ralph-worker-claim.mjs'), 'step-1', '--state-dir', stateDir, '--worker-id', workerId], { cwd, verbose })
    )
  );

  const successes = results.filter(r => r.code === 0);
  const failures = results.filter(r => r.code !== 0);
  assert(successes.length === 1, `expected 1 successful claim, got ${successes.length}`);
  assert(failures.length === workers.length - 1, `expected ${workers.length - 1} failures, got ${failures.length}`);
}

async function testCorruptStepOverwrite({ cwd, stateDir, verbose }) {
  const init = spawnSync(process.execPath, [nodePath('ralph-init.mjs'), 'Self test', '--state-dir', stateDir], { cwd, encoding: 'utf-8' });
  assert(init.status === 0, `init failed: ${init.stderr || init.stdout}`);

  const stateFile = join(cwd, stateDir, 'ralph-state.json');
  const state = readJson(stateFile);
  state.steps = { 'step-1': { description: 'demo', status: 'pending' } };
  writeJson(stateFile, state);

  const stepsDir = join(cwd, stateDir, 'steps');
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(join(stepsDir, 'step-1.json'), '{this is not json', 'utf-8');

  const withoutForce = await spawnNode([nodePath('ralph-worker-claim.mjs'), 'step-1', '--state-dir', stateDir, '--worker-id', 'w1'], { cwd, verbose });
  assert(withoutForce.code !== 0, 'expected claim to fail without --force-overwrite');

  const withForce = await spawnNode(
    [nodePath('ralph-worker-claim.mjs'), 'step-1', '--state-dir', stateDir, '--worker-id', 'w1', '--force-overwrite'],
    { cwd, verbose }
  );
  assert(withForce.code === 0, 'expected claim to succeed with --force-overwrite');
}

async function testConcurrentStateUpdates({ cwd, stateDir, verbose }) {
  const init = spawnSync(process.execPath, [nodePath('ralph-init.mjs'), 'Self test', '--state-dir', stateDir], { cwd, encoding: 'utf-8' });
  assert(init.status === 0, `init failed: ${init.stderr || init.stdout}`);

  const stateFile = join(cwd, stateDir, 'ralph-state.json');
  const state = readJson(stateFile);
  const stepIds = Array.from({ length: 25 }, (_, i) => `step-${i + 1}`);
  state.steps = Object.fromEntries(stepIds.map(id => [id, { description: id, status: 'pending' }]));
  writeJson(stateFile, state);

  const claimResults = await Promise.all(
    stepIds.map((stepId, i) =>
      spawnNode([nodePath('ralph-worker-claim.mjs'), stepId, '--state-dir', stateDir, '--worker-id', `w${i + 1}`], { cwd, verbose })
    )
  );
  assert(claimResults.every(r => r.code === 0), 'expected all claims to succeed');

  const stateAfterClaims = readJson(stateFile);
  for (const stepId of stepIds) {
    assert(stateAfterClaims.steps?.[stepId]?.status === 'in-progress', `missing in-progress status for ${stepId}`);
  }

  const completeResults = await Promise.all(
    stepIds.map((stepId, i) =>
      spawnNode(
        [nodePath('ralph-worker-complete.mjs'), stepId, '--state-dir', stateDir, '--worker-id', `w${i + 1}`, '--result', `ok ${stepId}`],
        { cwd, verbose }
      )
    )
  );
  assert(completeResults.every(r => r.code === 0), 'expected all completes to succeed');

  const stateAfterCompletes = readJson(stateFile);
  for (const stepId of stepIds) {
    assert(stateAfterCompletes.steps?.[stepId]?.status === 'complete', `missing complete status for ${stepId}`);
  }
}

async function testLatestValidationNumeric({ cwd, stateDir, verbose }) {
  const init = spawnSync(process.execPath, [nodePath('ralph-init.mjs'), 'Self test', '--state-dir', stateDir], { cwd, encoding: 'utf-8' });
  assert(init.status === 0, `init failed: ${init.stderr || init.stdout}`);

  const stateFile = join(cwd, stateDir, 'ralph-state.json');
  const state = readJson(stateFile);
  state.steps = { 'step-1': { description: 'demo', status: 'complete' } };
  state.iteration = 10;
  writeJson(stateFile, state);

  const validationDir = join(cwd, stateDir, 'validation');
  mkdirSync(validationDir, { recursive: true });
  writeJson(join(validationDir, 'iteration-2.json'), { iteration: 2, overallComplete: false });
  writeJson(join(validationDir, 'iteration-10.json'), { iteration: 10, overallComplete: true });

  const readRes = await spawnNode([nodePath('ralph-state-read.mjs'), '--state-dir', stateDir, '--format', 'json'], { cwd, verbose });
  assert(readRes.code === 0, `state-read failed: ${readRes.stderr || readRes.stdout}`);
  const aggregated = JSON.parse(readRes.stdout);
  assert(aggregated.lastValidation?.iteration === 10, `expected lastValidation.iteration=10, got ${aggregated.lastValidation?.iteration}`);
  assert(aggregated.isComplete === true, 'expected isComplete=true based on iteration-10 validation');
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(usage());
    process.exit(0);
  }

  const root = mkdtempSync(join(tmpdir(), 'ralph-self-test-'));
  const baseCwd = resolve(root);

  const tests = [
    { name: 'exclusive claim', fn: () => testExclusiveClaim({ cwd: baseCwd, stateDir: '.ralph-a', verbose: args.verbose }) },
    { name: 'corrupt step overwrite', fn: () => testCorruptStepOverwrite({ cwd: baseCwd, stateDir: '.ralph-b', verbose: args.verbose }) },
    { name: 'concurrent state updates', fn: () => testConcurrentStateUpdates({ cwd: baseCwd, stateDir: '.ralph-c', verbose: args.verbose }) },
    { name: 'latest validation numeric', fn: () => testLatestValidationNumeric({ cwd: baseCwd, stateDir: '.ralph-d', verbose: args.verbose }) }
  ];

  // eslint-disable-next-line no-console
  console.log(`Ralph self-test: ${tests.length} checks`);
  // eslint-disable-next-line no-console
  if (args.keep) console.log(`Keeping temp dir: ${baseCwd}`);

  try {
    for (const t of tests) {
      // eslint-disable-next-line no-console
      console.log(`- ${t.name}`);
      await t.fn();
    }
    // eslint-disable-next-line no-console
    console.log('OK');
  } finally {
    if (!args.keep) {
      rmSync(baseCwd, { recursive: true, force: true });
    }
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(`FAIL: ${err?.message || String(err)}`);
  process.exit(1);
});

