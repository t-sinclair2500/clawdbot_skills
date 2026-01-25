#!/usr/bin/env node

/**
 * Ralph Cleanup
 * Cleans up state files and locks
 */

import { readdirSync, unlinkSync, existsSync, rmSync, mkdirSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { cwd } from 'process';
import { DEFAULT_STATE_DIR, assertSafeStateDir, fail, resolveStateDirAbs } from './lib/ralph-common.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    stateDir: DEFAULT_STATE_DIR,
    archive: false,
    removeAll: false,
    force: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--state-dir' && i + 1 < args.length) {
      result.stateDir = args[++i];
    } else if (arg === '--archive') {
      result.archive = true;
    } else if (arg === '--remove-all') {
      result.removeAll = true;
    } else if (arg === '--force') {
      result.force = true;
    }
  }

  assertSafeStateDir(result.stateDir);
  return result;
}

function cleanupLocks(stateDir) {
  const stepsDir = join(cwd(), stateDir, 'steps');
  if (!existsSync(stepsDir)) {
    return 0;
  }

  const lockFiles = readdirSync(stepsDir).filter(f => f.endsWith('.lock'));
  let removed = 0;

  for (const file of lockFiles) {
    try {
      unlinkSync(join(stepsDir, file));
      removed++;
    } catch (error) {
      // Continue on errors
    }
  }

  // Also remove the global state lock if present.
  try {
    unlinkSync(join(cwd(), stateDir, 'ralph-state.lock'));
    removed++;
  } catch {
    // ignore
  }

  return removed;
}

function archiveFiles(stateDir) {
  const archiveDir = join(cwd(), stateDir, 'archive');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const iterationArchiveDir = join(archiveDir, `iteration-${timestamp}`);

  try {
    mkdirSync(iterationArchiveDir, { recursive: true });
  } catch (error) {
    console.error(JSON.stringify({ error: `Failed to create archive directory: ${error.message}` }));
    return { archived: 0, errors: 1 };
  }

  let archived = 0;
  let errors = 0;

  const tryCopyDir = (dirName, filterFn) => {
    const srcDir = join(cwd(), stateDir, dirName);
    if (!existsSync(srcDir)) return;
    const files = readdirSync(srcDir).filter(filterFn);
    for (const file of files) {
      try {
        copyFileSync(join(srcDir, file), join(iterationArchiveDir, `${dirName}-${file}`));
        archived++;
      } catch {
        errors++;
      }
    }
  };

  // Archive step files
  tryCopyDir('steps', f => f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.log'));
  tryCopyDir('validation', f => f.endsWith('.json'));
  tryCopyDir('progress', f => f.endsWith('.json'));

  // Archive state file
  const stateFile = join(cwd(), stateDir, 'ralph-state.json');
  if (existsSync(stateFile)) {
    try {
      copyFileSync(stateFile, join(iterationArchiveDir, 'ralph-state.json'));
      archived++;
    } catch {
      errors++;
    }
  }

  return { archived, errors };
}

function removeAll(stateDir) {
  const fullPath = resolveStateDirAbs(stateDir);
  if (!existsSync(fullPath)) {
    return { removed: false, error: 'State directory does not exist' };
  }

  const cwdAbs = resolve(cwd());
  if (resolve(fullPath) === cwdAbs) {
    return { removed: false, error: 'Refusing to remove working directory' };
  }

  try {
    rmSync(fullPath, { recursive: true, force: true });
    return { removed: true };
  } catch (error) {
    return { removed: false, error: error.message };
  }
}

// Main execution
try {
  const config = parseArgs();
  if (config.removeAll && !config.force) {
    fail('Refusing --remove-all without --force');
  }
  const result = {
    locksRemoved: 0,
    archived: null,
    removed: null
  };

  // Always remove locks
  result.locksRemoved = cleanupLocks(config.stateDir);

  // Archive if requested
  if (config.archive) {
    result.archived = archiveFiles(config.stateDir);
  }

  // Remove all if requested
  if (config.removeAll) {
    result.removed = removeAll(config.stateDir);
  }

  console.log(JSON.stringify(result));
} catch (error) {
  fail(error?.message || String(error));
}
