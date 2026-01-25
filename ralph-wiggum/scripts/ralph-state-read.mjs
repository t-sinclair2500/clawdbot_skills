#!/usr/bin/env node

/**
 * Ralph State Reader
 * Reads and aggregates current loop state
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { cwd } from 'process';
import { DEFAULT_STATE_DIR, assertSafeStateDir, fail } from './lib/ralph-common.mjs';

function tryReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    stateDir: DEFAULT_STATE_DIR,
    format: 'json'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--state-dir' && i + 1 < args.length) {
      result.stateDir = args[++i];
    } else if (arg === '--format' && i + 1 < args.length) {
      result.format = args[++i];
    }
  }

  if (result.format !== 'json' && result.format !== 'summary') {
    fail('Format must be "json" or "summary"');
  }

  assertSafeStateDir(result.stateDir);
  return result;
}

function readState(stateDir) {
  const stateFile = join(cwd(), stateDir, 'ralph-state.json');
  if (!existsSync(stateFile)) {
    fail('State file not found. Run ralph-init.mjs first.');
  }

  try {
    return JSON.parse(readFileSync(stateFile, 'utf-8'));
  } catch (error) {
    fail(`Failed to read state file: ${error.message}`);
  }
}

function readStepFiles(stateDir) {
  const stepsDir = join(cwd(), stateDir, 'steps');
  if (!existsSync(stepsDir)) {
    return [];
  }

  const files = readdirSync(stepsDir).filter(f => f.endsWith('.json'));
  const steps = [];

  for (const file of files) {
    try {
      const stepData = JSON.parse(readFileSync(join(stepsDir, file), 'utf-8'));
      const stepId = stepData?.stepId || file.replace(/\.json$/, '');
      steps.push({ ...stepData, stepId });
    } catch (error) {
      // Skip corrupted files
    }
  }

  return steps;
}

function readLatestValidation(stateDir, iteration) {
  const validationDir = join(cwd(), stateDir, 'validation');
  if (!existsSync(validationDir)) {
    return null;
  }

  // Try to read validation for current iteration
  const validationFile = join(validationDir, `iteration-${iteration}.json`);
  if (existsSync(validationFile)) {
    try {
      return JSON.parse(readFileSync(validationFile, 'utf-8'));
    } catch (error) {
      // Return null if file is corrupted
    }
  }

  // Try to find latest validation file
  const files = readdirSync(validationDir).filter(f => f.startsWith('iteration-') && f.endsWith('.json'));
  let best = null;
  let bestIter = -1;
  for (const file of files) {
    const m = file.match(/^iteration-(\d+)\.json$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n)) continue;
    if (n > bestIter) {
      const candidate = tryReadJson(join(validationDir, file));
      if (candidate) {
        bestIter = n;
        best = candidate;
      }
    }
  }

  return best;
}

function aggregateState(config, state) {
  const stepFiles = readStepFiles(config.stateDir);
  const lastValidation = readLatestValidation(config.stateDir, state.iteration);

  const expected = Object.keys(state.steps || {});
  const index = new Map();

  for (const stepId of expected) {
    index.set(stepId, {
      stepId,
      status: state.steps?.[stepId]?.status || 'pending',
      worker: state.steps?.[stepId]?.worker || null,
      description: state.steps?.[stepId]?.description || null,
      source: 'state'
    });
  }

  for (const sf of stepFiles) {
    const stepId = sf.stepId;
    const current = index.get(stepId) || { stepId, status: 'pending', worker: null, description: null, source: 'file' };
    index.set(stepId, {
      ...current,
      status: sf.status || current.status,
      worker: sf.worker || current.worker,
      source: 'file'
    });
  }

  const steps = [...index.values()];
  const pendingStepIds = steps.filter(s => s.status === 'pending' || !s.status).map(s => s.stepId);
  const inProgressStepIds = steps.filter(s => s.status === 'in-progress').map(s => s.stepId);
  const completedStepIds = steps.filter(s => s.status === 'complete').map(s => s.stepId);
  const failedStepIds = steps.filter(s => s.status === 'failed').map(s => s.stepId);

  const isComplete = lastValidation ? lastValidation.overallComplete : false;
  const canContinue = !isComplete && 
    (state.maxIterations === null || state.iteration < state.maxIterations);

  return {
    iteration: state.iteration,
    task: state.task,
    maxIterations: state.maxIterations,
    completionPromise: state.completionPromise,
    startedAt: state.startedAt,
    totalSteps: steps.length,
    completedSteps: completedStepIds.length,
    completedStepIds,
    pendingSteps: pendingStepIds,
    inProgressSteps: inProgressStepIds,
    failedSteps: failedStepIds,
    lastValidation: lastValidation,
    isComplete: isComplete,
    canContinue: canContinue,
    workers: Array.isArray(state.workers) ? state.workers : [],
    monitors: Array.isArray(state.monitors) ? state.monitors : []
  };
}

function formatSummary(aggregated) {
  let output = `Ralph Loop State - Iteration ${aggregated.iteration}\n`;
  output += `Task: ${aggregated.task}\n`;
  output += `Started: ${aggregated.startedAt}\n`;
  output += `\nSteps: ${aggregated.completedSteps}/${aggregated.totalSteps} complete\n`;
  
  if (aggregated.pendingSteps.length > 0) {
    output += `Pending: ${aggregated.pendingSteps.join(', ')}\n`;
  }
  if (aggregated.inProgressSteps.length > 0) {
    output += `In Progress: ${aggregated.inProgressSteps.join(', ')}\n`;
  }
  if (aggregated.failedSteps.length > 0) {
    output += `Failed: ${aggregated.failedSteps.join(', ')}\n`;
  }

  if (aggregated.lastValidation) {
    output += `\nLast Validation:\n`;
    output += `  All Steps Complete: ${aggregated.lastValidation.allStepsComplete}\n`;
    if (aggregated.lastValidation.testsPassing !== null) {
      output += `  Tests Passing: ${aggregated.lastValidation.testsPassing}\n`;
    }
    output += `  Promise Found: ${aggregated.lastValidation.promiseFound}\n`;
    output += `  Overall Complete: ${aggregated.lastValidation.overallComplete}\n`;
    if (aggregated.lastValidation.notes.length > 0) {
      output += `  Notes: ${aggregated.lastValidation.notes.join('; ')}\n`;
    }
  }

  output += `\nStatus: ${aggregated.isComplete ? 'COMPLETE' : aggregated.canContinue ? 'CONTINUE' : 'STOPPED'}\n`;

  if (aggregated.maxIterations) {
    output += `Max Iterations: ${aggregated.maxIterations}\n`;
  }

  return output;
}

// Main execution
try {
  const config = parseArgs();
  const state = readState(config.stateDir);
  const aggregated = aggregateState(config, state);

  if (config.format === 'summary') {
    console.log(formatSummary(aggregated));
  } else {
    console.log(JSON.stringify(aggregated, null, 2));
  }
} catch (error) {
  fail(error?.message || String(error));
}
