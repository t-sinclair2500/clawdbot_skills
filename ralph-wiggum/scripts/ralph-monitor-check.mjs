#!/usr/bin/env node

/**
 * Ralph Monitor Validation
 * Validates completion and checks exit conditions
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { cwd } from 'process';
import { execSync } from 'child_process';
import {
  DEFAULT_STATE_DIR,
  assertSafeStateDir,
  fail,
  readJsonFile,
  resolveStateDirAbs,
  withLock,
  writeJsonAtomic
} from './lib/ralph-common.mjs';

function readStateFile(stateDirAbs) {
  const stateFileAbs = join(stateDirAbs, 'ralph-state.json');
  const state = readJsonFile(stateFileAbs, { allowMissing: false });
  return { stateFileAbs, state };
}

function tryReadJson(filePath, { maxBytes = 1024 * 1024 } = {}) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    if (raw.length > maxBytes) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    iteration: null,
    stateDir: DEFAULT_STATE_DIR,
    monitorId: null,
    runTests: false,
    testCommand: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--iteration' && i + 1 < args.length) {
      const val = parseInt(args[++i], 10);
      if (!Number.isFinite(val) || val <= 0) fail('iteration must be a positive integer');
      result.iteration = val;
    } else if (arg === '--state-dir' && i + 1 < args.length) {
      result.stateDir = args[++i];
    } else if (arg === '--monitor-id' && i + 1 < args.length) {
      result.monitorId = args[++i];
    } else if (arg === '--run-tests') {
      result.runTests = true;
    } else if (arg === '--test-command' && i + 1 < args.length) {
      result.testCommand = args[++i];
      result.runTests = true;
    }
  }

  if (!result.monitorId) {
    result.monitorId = `monitor-${Date.now()}`;
  }

  assertSafeStateDir(result.stateDir);
  return result;
}

function loadStepIndex(stateDirAbs, state, notes) {
  const stepsDirAbs = join(stateDirAbs, 'steps');
  const expectedStepIds = Object.keys(state?.steps || {});
  const index = new Map();

  for (const stepId of expectedStepIds) {
    index.set(stepId, {
      stepId,
      status: state.steps?.[stepId]?.status || 'pending',
      worker: state.steps?.[stepId]?.worker || null,
      result: null,
      source: 'state'
    });
  }

  if (!existsSync(stepsDirAbs)) return { index, expectedStepIds };

  const files = readdirSync(stepsDirAbs).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const filePath = join(stepsDirAbs, file);
    const stepData = tryReadJson(filePath, { maxBytes: 512 * 1024 });
    if (!stepData) {
      notes.push(`Corrupted step file: ${file}`);
      continue;
    }
    const stepId = stepData?.stepId || file.replace(/\.json$/, '');
    const current = index.get(stepId) || { stepId, status: 'pending', worker: null, result: null, source: 'file' };
    index.set(stepId, {
      ...current,
      status: stepData?.status || current.status,
      worker: stepData?.worker || current.worker,
      result: typeof stepData?.result === 'string' ? stepData.result : current.result,
      source: 'file'
    });
  }

  return { index, expectedStepIds };
}

function runTests(testCommand) {
  if (!testCommand) {
    // Try to detect test framework / default test command
    if (existsSync(join(cwd(), 'package.json'))) {
      const pkg = tryReadJson(join(cwd(), 'package.json'), { maxBytes: 512 * 1024 });
      if (pkg?.scripts?.test) testCommand = 'npm test';
      if (!testCommand && existsSync(join(cwd(), 'jest.config.js'))) testCommand = 'npx jest';
    }
    if (!testCommand && (existsSync(join(cwd(), 'pyproject.toml')) || existsSync(join(cwd(), 'pytest.ini')) || existsSync(join(cwd(), 'setup.cfg')))) {
      testCommand = 'pytest';
    }
    if (!testCommand && existsSync(join(cwd(), 'go.mod'))) testCommand = 'go test ./...';
    if (!testCommand && existsSync(join(cwd(), 'Cargo.toml'))) testCommand = 'cargo test';
    if (!testCommand) return null;
  }

  try {
    const output = execSync(testCommand, { encoding: 'utf-8', cwd: cwd(), stdio: 'pipe' });
    return { passing: true, command: testCommand, output: output.substring(0, 2000) };
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : error?.stdout?.toString?.('utf-8') || '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : error?.stderr?.toString?.('utf-8') || '';
    const combined = `${stdout}\n${stderr}`.trim();
    return {
      passing: false,
      command: testCommand,
      output: (combined || error.message || String(error)).substring(0, 2000)
    };
  }
}

function buildPromiseRegex(completionPromise) {
  if (!completionPromise) {
    return null;
  }
  const escaped = completionPromise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (completionPromise.toLowerCase().includes('<promise>')) {
    return new RegExp(escaped, 'i');
  }
  return new RegExp(`<promise>${escaped}</promise>`, 'i');
}

function searchCompletionPromise(stateDirAbs, completionPromise, stepIndex) {
  const promisePattern = buildPromiseRegex(completionPromise);
  if (!promisePattern) return false;

  const stepsDirAbs = join(stateDirAbs, 'steps');
  const progressDirAbs = join(stateDirAbs, 'progress');

  for (const step of stepIndex.values()) {
    if (typeof step.result === 'string' && promisePattern.test(step.result)) return true;
  }

  const trySearchTextFiles = (dirAbs) => {
    if (!existsSync(dirAbs)) return false;
    const files = readdirSync(dirAbs).filter(f => f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.log'));
    for (const file of files) {
      try {
        const content = readFileSync(join(dirAbs, file), 'utf-8');
        if (promisePattern.test(content)) return true;
      } catch {
        // ignore
      }
    }
    return false;
  };

  if (trySearchTextFiles(stepsDirAbs)) return true;
  if (trySearchTextFiles(progressDirAbs)) return true;
  return false;
}

function validateCompletion(config, state) {
  const iteration = config.iteration || state.iteration;
  const stateDirAbs = resolveStateDirAbs(config.stateDir);
  const notes = [];
  const { index: stepIndex, expectedStepIds } = loadStepIndex(stateDirAbs, state, notes);

  const stepEntries = [...stepIndex.values()];
  const allStepsComplete = expectedStepIds.length > 0
    ? expectedStepIds.every(id => (stepIndex.get(id)?.status === 'complete'))
    : (stepEntries.length > 0 && stepEntries.every(step => step.status === 'complete'));

  let testsPassing = null;

  if (config.runTests) {
    const testResult = runTests(config.testCommand);
    if (testResult !== null) {
      testsPassing = testResult.passing;
      if (!testResult.passing) {
        notes.push(`Tests failed: ${testResult.output.substring(0, 200)}`);
      }
    } else {
      notes.push('Test framework not detected or no tests found');
    }
  }

  const promiseFound = searchCompletionPromise(stateDirAbs, state.completionPromise, stepIndex);

  const overallComplete = allStepsComplete && 
    (testsPassing !== false) && 
    (state.completionPromise ? promiseFound : true);

  if (!allStepsComplete) {
    const incomplete = stepEntries.filter(s => s.status !== 'complete');
    notes.push(`${incomplete.length} step(s) not complete: ${incomplete.map(s => s.stepId).join(', ')}`);
  }

  if (state.completionPromise && !promiseFound) {
    notes.push(`Completion promise "${state.completionPromise}" not found`);
  }

  const validation = {
    iteration: iteration,
    monitorId: config.monitorId,
    allStepsComplete: allStepsComplete,
    testsPassing: testsPassing,
    promiseFound: promiseFound,
    overallComplete: overallComplete,
    notes: notes,
    timestamp: new Date().toISOString()
  };

  // Write validation file
  const validationDirAbs = join(stateDirAbs, 'validation');
  const validationFileAbs = join(validationDirAbs, `iteration-${iteration}.json`);
  writeJsonAtomic(validationFileAbs, validation);

  // Update state (persisted, lock-protected)
  const stateLockAbs = join(stateDirAbs, 'ralph-state.lock');
  withLock(stateLockAbs, () => {
    const { stateFileAbs, state: latestState } = readStateFile(stateDirAbs);
    if (!Array.isArray(latestState.monitors)) latestState.monitors = [];
    if (!latestState.monitors.includes(config.monitorId)) latestState.monitors.push(config.monitorId);
    latestState.lastValidation = {
      iteration,
      overallComplete,
      allStepsComplete,
      testsPassing,
      promiseFound,
      timestamp: validation.timestamp
    };
    writeJsonAtomic(stateFileAbs, latestState);
  });

  return validation;
}

// Main execution
try {
  const config = parseArgs();
  const stateDirAbs = resolveStateDirAbs(config.stateDir);
  const { state } = readStateFile(stateDirAbs);
  const result = validateCompletion(config, state);
  console.log(JSON.stringify(result));
} catch (error) {
  fail(error?.message || String(error));
}
