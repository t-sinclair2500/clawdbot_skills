#!/usr/bin/env node

/**
 * Ralph Worker Step Claiming
 * Atomically claims a step for a worker subagent
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  DEFAULT_STATE_DIR,
  assertSafeStateDir,
  assertSafeStepId,
  fail,
  readJsonFile,
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
    stateDir: DEFAULT_STATE_DIR,
    workerId: null,
    forceOverwrite: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--state-dir' && i + 1 < args.length) {
      result.stateDir = args[++i];
    } else if (arg === '--worker-id' && i + 1 < args.length) {
      result.workerId = args[++i];
    } else if (arg === '--force-overwrite') {
      result.forceOverwrite = true;
    } else if (!arg.startsWith('--')) {
      result.stepId = arg;
    }
  }

  if (!result.stepId) {
    fail('Step ID is required');
  }

  if (!result.workerId) {
    result.workerId = `worker-${randomUUID().substring(0, 8)}`;
  }

  assertSafeStateDir(result.stateDir);
  assertSafeStepId(result.stepId);
  return result;
}

function claimStep(config, state) {
  const stepId = config.stepId;
  const stateDirAbs = resolveStateDirAbs(config.stateDir);
  const stepsDirAbs = join(stateDirAbs, 'steps');
  const stepFileAbs = join(stepsDirAbs, `${stepId}.json`);
  const lockFileAbs = join(stepsDirAbs, `${stepId}.lock`);
  mkdirSync(stepsDirAbs, { recursive: true });

  // Check if step already exists and is claimed
  if (existsSync(stepFileAbs)) {
    const existing = tryReadJsonFile(stepFileAbs, { maxBytes: 512 * 1024 });
    if (!existing) {
      if (!config.forceOverwrite) {
        fail('Step file is corrupted; rerun with --force-overwrite to reset', { stepId, stepFile: stepFileAbs });
      }
    } else if (existing?.status === 'in-progress' || existing?.status === 'complete') {
      fail(`Step ${stepId} is already ${existing.status}`);
    }
  }

  // Create lock file atomically (exclusive create)
  try {
    writeFileSync(lockFileAbs, JSON.stringify({
      workerId: config.workerId,
      claimedAt: new Date().toISOString(),
      pid: process.pid
    }), { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail(`Step ${stepId} is currently locked`);
    }
    fail('Failed to create lock file', { message: error?.message || String(error) });
  }

  // Create/update step file
  const stepData = {
    stepId: stepId,
    status: 'in-progress',
    worker: config.workerId,
    claimedAt: new Date().toISOString()
  };

  try {
    writeJsonAtomic(stepFileAbs, stepData);
  } catch (error) {
    // Clean up lock file on failure
    tryUnlink(lockFileAbs);
    fail('Failed to write step file', { message: error?.message || String(error) });
  }

  // Update state file
  const stateLockAbs = join(stateDirAbs, 'ralph-state.lock');
  withLock(stateLockAbs, () => {
    const { stateFileAbs, state: latestState } = readStateFile(stateDirAbs);
    if (!latestState.steps || typeof latestState.steps !== 'object') latestState.steps = {};
    if (!latestState.steps[stepId] || typeof latestState.steps[stepId] !== 'object') latestState.steps[stepId] = {};
    latestState.steps[stepId].status = 'in-progress';
    latestState.steps[stepId].worker = config.workerId;
    latestState.steps[stepId].claimedAt = stepData.claimedAt;

    if (!Array.isArray(latestState.workers)) latestState.workers = [];
    if (!latestState.workers.includes(config.workerId)) latestState.workers.push(config.workerId);

    writeJsonAtomic(stateFileAbs, latestState);
  });

  return {
    stepId: stepId,
    workerId: config.workerId,
    stateDir: config.stateDir,
    stateDirAbs,
    lockFile: lockFileAbs,
    stepFile: stepFileAbs,
    stepData
  };
}

// Main execution
try {
  const config = parseArgs();
  const stateDirAbs = resolveStateDirAbs(config.stateDir);
  const { state } = readStateFile(stateDirAbs);
  const result = claimStep(config, state);
  console.log(JSON.stringify(result));
} catch (error) {
  fail(error?.message || String(error));
}
