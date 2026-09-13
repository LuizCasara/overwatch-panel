#!/usr/bin/env node
// Hook único do claude-overwatch: le o payload de um hook do Claude Code via
// stdin e atualiza ~/.claude/overwatch-data/sessions.js. Nunca lanca - qualquer
// falha e engolida e logada, mesmo espirito de ~/.claude/scripts/track-usage.js
// (AD-001 em .specs/STATE.md).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.claude', 'overwatch-data');

function parseJsonSafe(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return null;
  }
}

function logError(event, message, dataDir = DEFAULT_DATA_DIR) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), event, message });
    fs.appendFileSync(path.join(dataDir, 'overwatch.log'), `${line}\n`);
  } catch {
    // Logging nunca pode ser a causa de um hook quebrar.
  }
}

function readStdinJson(event, dataDir = DEFAULT_DATA_DIR) {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return {};
  }
  if (!raw || !raw.trim()) return {};
  const parsed = parseJsonSafe(raw);
  if (parsed === null) {
    logError(event, `invalid JSON payload: ${raw.slice(0, 300)}`, dataDir);
    return {};
  }
  return parsed;
}

const SESSIONS_FILE_RE = /^window\.CLAUDE_SESSIONS\s*=\s*([\s\S]*?);\s*$/;

function sessionsFilePath(dataDir) {
  return path.join(dataDir, 'sessions.js');
}

function loadSessions(dataDir = DEFAULT_DATA_DIR) {
  let raw;
  try {
    raw = fs.readFileSync(sessionsFilePath(dataDir), 'utf8');
  } catch {
    return {};
  }
  const match = SESSIONS_FILE_RE.exec(raw.trim());
  if (!match) return {};
  const parsed = parseJsonSafe(match[1]);
  return parsed === null ? {} : parsed;
}

function writeSessionsFile(sessions, dataDir = DEFAULT_DATA_DIR) {
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = sessionsFilePath(dataDir);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const content = `window.CLAUDE_SESSIONS = ${JSON.stringify(sessions, null, 2)};\n`;
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

const LOCK_MAX_ATTEMPTS = 10;
const LOCK_BACKOFF_STEP_MS = 50;
const LOCK_STALE_MS = 5000;

function lockFilePath(dataDir) {
  return path.join(dataDir, 'sessions.js.lock');
}

function sleepSync(ms) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

function isLockStale(lockPath) {
  try {
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function acquireLock(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockPath = lockFilePath(dataDir);
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
      if (isLockStale(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Removed by someone else in the meantime - fine, retry.
        }
        continue;
      }
      sleepSync(LOCK_BACKOFF_STEP_MS * (attempt + 1));
    }
  }
  return false;
}

function releaseLock(dataDir) {
  try {
    fs.unlinkSync(lockFilePath(dataDir));
  } catch {
    // Already gone - fine.
  }
}

function withSessionsLock(dataDir, mutateFn) {
  if (!acquireLock(dataDir)) {
    logError('lock', 'could not acquire sessions.js.lock after retries', dataDir);
    return;
  }
  try {
    const sessions = loadSessions(dataDir);
    mutateFn(sessions);
    writeSessionsFile(sessions, dataDir);
  } finally {
    releaseLock(dataDir);
  }
}

function resolveBranch(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branch = out.toString('utf8').trim();
    return branch || null;
  } catch {
    return null;
  }
}

function handleSessionStart(sessions, payload) {
  const sessionId = payload.session_id;
  if (!sessionId) return;
  const now = new Date().toISOString();
  const cwd = payload.cwd || '';
  sessions[sessionId] = {
    session_id: sessionId,
    project: cwd ? path.basename(cwd) : '',
    cwd,
    branch: cwd ? resolveBranch(cwd) : null,
    summary: '',
    started_at: now,
    last_update: now,
    ended_at: null,
    context_pct: null,
    status: 'running',
    todos: [],
  };
}

function handlePrompt(sessions, payload) {
  const sessionId = payload.session_id;
  if (!sessionId) return;
  if (!sessions[sessionId]) {
    handleSessionStart(sessions, payload);
  }
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  sessions[sessionId].summary = prompt.slice(0, 80);
  sessions[sessionId].status = 'running';
  sessions[sessionId].last_update = new Date().toISOString();
}

function handleWaiting(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  entry.status = 'waiting';
  entry.last_update = new Date().toISOString();
}

module.exports = {
  DEFAULT_DATA_DIR,
  parseJsonSafe,
  logError,
  readStdinJson,
  sessionsFilePath,
  loadSessions,
  writeSessionsFile,
  lockFilePath,
  withSessionsLock,
  resolveBranch,
  handleSessionStart,
  handlePrompt,
  handleWaiting,
};
