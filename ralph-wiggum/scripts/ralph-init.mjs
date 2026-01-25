#!/usr/bin/env node

/**
 * Ralph Loop Initialization
 * Creates state structure for iterative development loops
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { DEFAULT_STATE_DIR, assertSafeStateDir, fail, resolveStateDirAbs, writeJsonAtomic } from './lib/ralph-common.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    task: null,
    completionPromise: null,
    maxIterations: null,
    stateDir: DEFAULT_STATE_DIR
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--completion-promise' && i + 1 < args.length) {
      result.completionPromise = args[++i];
    } else if (arg === '--max-iterations' && i + 1 < args.length) {
      const val = parseInt(args[++i], 10);
      if (isNaN(val) || val < 0) {
        fail('max-iterations must be a non-negative integer');
      }
      result.maxIterations = val === 0 ? null : val;
    } else if (arg === '--state-dir' && i + 1 < args.length) {
      result.stateDir = args[++i];
    } else if (!arg.startsWith('--')) {
      if (!result.task) {
        result.task = arg;
      } else {
        result.task += ' ' + arg;
      }
    }
  }

  if (!result.task) {
    fail('Task description is required');
  }

  assertSafeStateDir(result.stateDir);
  return result;
}

function initializeState(config) {
  const stateDirAbs = resolveStateDirAbs(config.stateDir);
  const stepsDir = join(stateDirAbs, 'steps');
  const progressDir = join(stateDirAbs, 'progress');
  const validationDir = join(stateDirAbs, 'validation');

  // Create directories
  try {
    mkdirSync(stateDirAbs, { recursive: true });
    mkdirSync(stepsDir, { recursive: true });
    mkdirSync(progressDir, { recursive: true });
    mkdirSync(validationDir, { recursive: true });
  } catch (error) {
    fail('Failed to create directories', { message: error.message });
  }

  const stateFileAbs = join(stateDirAbs, 'ralph-state.json');

  // Check if state file already exists
  if (existsSync(stateFileAbs)) {
    fail('State file already exists. Use cleanup script or choose different state-dir.');
  }

  // Create initial state
  const state = {
    task: config.task,
    iteration: 1,
    maxIterations: config.maxIterations,
    completionPromise: config.completionPromise,
    startedAt: new Date().toISOString(),
    steps: {},
    workers: [],
    monitors: []
  };

  try {
    writeJsonAtomic(stateFileAbs, state);
  } catch (error) {
    fail('Failed to write state file', { message: error.message });
  }

  return {
    stateDir: config.stateDir,
    stateDirAbs,
    stateFileAbs,
    stateFile: join(config.stateDir, 'ralph-state.json'),
    state: state
  };
}

// Main execution
try {
  const config = parseArgs();
  const result = initializeState(config);
  console.log(JSON.stringify({
    stateDir: result.stateDir,
    stateDirAbs: result.stateDirAbs,
    stateFile: result.stateFile,
    stateFileAbs: result.stateFileAbs,
    iteration: result.state.iteration,
    maxIterations: result.state.maxIterations,
    completionPromise: result.state.completionPromise
  }));
} catch (error) {
  fail(error?.message || String(error));
}
