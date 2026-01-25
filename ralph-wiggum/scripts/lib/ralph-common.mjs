import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve, sep } from 'path';
import { cwd } from 'process';

export const DEFAULT_STATE_DIR = '.ralph';

const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

export function sleepMs(ms) {
  if (ms <= 0) return;
  Atomics.wait(SLEEP_ARRAY, 0, 0, ms);
}

export function fail(message, details) {
  const payload = { error: message };
  if (details && typeof details === 'object') payload.details = details;
  console.error(JSON.stringify(payload));
  process.exit(1);
}

export function assertSafeStepId(stepId) {
  if (typeof stepId !== 'string' || stepId.length === 0) fail('Step ID is required');
  if (stepId.length > 200) fail('Step ID too long');
  if (stepId.includes('\0')) fail('Step ID contains null byte');
  if (stepId.includes('/') || stepId.includes('\\')) fail('Step ID must not contain path separators');
  if (stepId === '.' || stepId === '..') fail('Invalid step ID');
  return stepId;
}

export function assertSafeStateDir(stateDir) {
  if (typeof stateDir !== 'string' || stateDir.length === 0) fail('state-dir is required');
  if (stateDir.includes('\0')) fail('state-dir contains null byte');
  if (isAbsolute(stateDir)) fail('state-dir must be a relative path');
  const normalized = stateDir.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) fail('state-dir must not be empty');
  if (parts.some(p => p === '.' || p === '..')) fail('state-dir must not contain "." or ".." segments');
  return stateDir;
}

export function resolveStateDirAbs(stateDir) {
  const safe = assertSafeStateDir(stateDir);
  return join(cwd(), safe);
}

export function resolveInCwd(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) fail('Path is required');
  if (relPath.includes('\0')) fail('Path contains null byte');
  if (isAbsolute(relPath)) fail('Path must be relative');
  const abs = resolve(cwd(), relPath);
  const root = resolve(cwd()) + sep;
  if (!abs.startsWith(root)) fail('Path escapes working directory', { relPath });
  return abs;
}

export function encodeIdForFilename(id) {
  const value = String(id ?? '');
  if (value.length === 0) return 'empty';
  if (value.length > 500) return Buffer.from(value.slice(0, 500)).toString('base64url');
  return Buffer.from(value).toString('base64url');
}

export function readJsonFile(filePath, { allowMissing = false, maxBytes = 1024 * 1024 } = {}) {
  try {
    const st = statSync(filePath);
    if (st.size > maxBytes) {
      fail('Refusing to read oversized JSON file', { filePath, size: st.size, maxBytes });
    }
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (allowMissing && err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    const message = err?.message || String(err);
    fail('Failed to read JSON file', { filePath, message });
  }
}

export function tryReadJsonFile(filePath, { maxBytes = 1024 * 1024 } = {}) {
  try {
    const st = statSync(filePath);
    if (st.size > maxBytes) return null;
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeFileAtomic(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmpPath, contents);
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    const message = err?.message || String(err);
    fail('Failed to write file', { filePath, message });
  }
}

export function writeJsonAtomic(filePath, value) {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

export function tryUnlink(filePath) {
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function withLock(lockPath, fn, { timeoutMs = 5000, retryMs = 25 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx' });
      break;
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        const message = err?.message || String(err);
        fail('Failed to acquire lock', { lockPath, message });
      }
      if (Date.now() - start > timeoutMs) {
        fail('Timed out acquiring lock', { lockPath, timeoutMs });
      }
      sleepMs(retryMs);
    }
  }

  try {
    return fn();
  } finally {
    tryUnlink(lockPath);
  }
}
