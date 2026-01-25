#!/usr/bin/env node

/**
 * Ralph Worker Step Completion
 * Marks a step as complete and updates progress tracking
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  DEFAULT_STATE_DIR,
  assertSafeStateDir,
  assertSafeStepId,
  encodeIdForFilename,
  fail,
  readJsonFile,
  resolveInCwd,
  resolveStateDirAbs,
  tryReadJsonFile,
  tryUnlink,
  withLock,
  writeJsonAtomic
} from './lib/ralph-common.mjs';

function readStateFile(stateDirAbs) {
  const stateFileAbs = join(stateDirAbs, 'ralph-state.json');
  const state = readJsonFile(stateFileAbs, { allowMissing: false });
  return { stateFileAbs, state };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    stepId: null,
    result: null,
    outputFile: null,
    stateDir: DEFAULT_STATE_DIR,
    workerId: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--result' && i + 1 < args.length) {
      result.result = args[++i];
    } else if (arg === '--output-file' && i + 1 < args.length) {
      result.outputFile = args[++i];
    } else if (arg === '--state-dir' && i + 1 < args.length) {
      result.stateDir = args[++i];
    } else if (arg === '--worker-id' && i + 1 < args.length) {
      result.workerId = args[++i];
    } else if (!arg.startsWith('--')) {
      result.stepId = arg;
    }
  }

  if (!result.stepId) {
    fail('Step ID is required');
  }

  assertSafeStateDir(result.stateDir);
  assertSafeStepId(result.stepId);
  return result;
}

function completeStep(config, state) {
  const stepId = config.stepId;
  const stateDirAbs = resolveStateDirAbs(config.stateDir);
  const stepsDirAbs = join(stateDirAbs, 'steps');
  const stepFileAbs = join(stepsDirAbs, `${stepId}.json`);
  const lockFileAbs = join(stepsDirAbs, `${stepId}.lock`);

  // Read step file
  if (!existsSync(stepFileAbs)) {
    fail(`Step file not found: ${stepId}`);
  }

  let stepData;
  try {
    stepData = readJsonFile(stepFileAbs);
  } catch (error) {
    fail('Failed to read step file', { message: error?.message || String(error) });
  }

  // Validate worker-id matches
  if (config.workerId && stepData.worker !== config.workerId) {
    fail(`Worker ID mismatch. Step claimed by ${stepData.worker}, provided ${config.workerId}`);
  }

  const workerId = config.workerId || stepData.worker;
  if (!workerId) {
    fail('Worker ID required (from claim or --worker-id)');
  }

  if (stepData.status === 'complete') {
    console.log(JSON.stringify({
      stepId,
      workerId,
      status: 'complete',
      completedAt: stepData.completedAt || null,
      note: 'Step already complete'
    }));
    return null;
  }

  // Check lock file exists
  if (!existsSync(lockFileAbs)) {
    fail('Lock file not found. Step may not have been properly claimed.', { stepId });
  }

  const lockData = readJsonFile(lockFileAbs, { allowMissing: false, maxBytes: 16 * 1024 });
  if (lockData?.workerId && lockData.workerId !== workerId) {
    fail('Lock file workerId mismatch', { stepId, lockWorkerId: lockData.workerId, workerId });
  }

  // Update step file
  stepData.status = 'complete';
  stepData.completedAt = new Date().toISOString();
  if (config.result) {
    stepData.result = config.result;
  }

  try {
    writeJsonAtomic(stepFileAbs, stepData);
  } catch (error) {
    fail('Failed to write step file', { message: error?.message || String(error) });
  }

  // Write output file if provided
  if (config.outputFile) {
    try {
      const outputPath = resolveInCwd(config.outputFile);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, config.result || 'Step completed', 'utf-8');
    } catch (error) {
      fail('Failed to write output file', { message: error?.message || String(error) });
    }
  }

  // Update progress file
  const progressDirAbs = join(stateDirAbs, 'progress');
  const progressFileAbs = join(progressDirAbs, `worker-${encodeIdForFilename(workerId)}.json`);
  
  let progressData = {
    workerId: workerId,
    status: 'complete',
    stepsCompleted: [],
    lastUpdated: new Date().toISOString()
  };

  if (existsSync(progressFileAbs)) {
    const existing = tryReadJsonFile(progressFileAbs, { maxBytes: 512 * 1024 });
    if (existing && typeof existing === 'object') progressData = existing;
  }

  if (!progressData.stepsCompleted.includes(stepId)) {
    progressData.stepsCompleted.push(stepId);
  }
  progressData.lastUpdated = new Date().toISOString();

  try {
    writeJsonAtomic(progressFileAbs, progressData);
  } catch (error) {
    fail('Failed to write progress file', { message: error?.message || String(error) });
  }

  // Remove lock file
  const lockRemoved = tryUnlink(lockFileAbs);

  // Update state file
  const stateLockAbs = join(stateDirAbs, 'ralph-state.lock');
  withLock(stateLockAbs, () => {
    const { stateFileAbs, state: latestState } = readStateFile(stateDirAbs);
    if (!latestState.steps || typeof latestState.steps !== 'object') latestState.steps = {};
    if (!latestState.steps[stepId] || typeof latestState.steps[stepId] !== 'object') latestState.steps[stepId] = {};
    latestState.steps[stepId].status = 'complete';
    latestState.steps[stepId].completedAt = stepData.completedAt;

    if (!Array.isArray(latestState.workers)) latestState.workers = [];
    if (!latestState.workers.includes(workerId)) latestState.workers.push(workerId);

    writeJsonAtomic(stateFileAbs, latestState);
  });

  return {
    stepId: stepId,
    workerId: workerId,
    status: 'complete',
    completedAt: stepData.completedAt,
    lockRemoved,
    progressFile: progressFileAbs
  };
}

// Main execution
try {
  const config = parseArgs();
  const stateDirAbs = resolveStateDirAbs(config.stateDir);
  const { state } = readStateFile(stateDirAbs);
  const result = completeStep(config, state);
  if (result) console.log(JSON.stringify(result));
} catch (error) {
  fail(error?.message || String(error));
}
