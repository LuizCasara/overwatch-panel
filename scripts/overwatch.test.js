'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const {
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
  handleIdle,
} = require('./overwatch.js');

const REPO_ROOT = path.join(__dirname, '..');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-test-'));
}

// --- parseJsonSafe ---------------------------------------------------------

test('parseJsonSafe returns the parsed object for valid JSON', () => {
  assert.deepEqual(parseJsonSafe('{"a":1}'), { a: 1 });
});

test('parseJsonSafe returns null for invalid JSON (never throws)', () => {
  assert.equal(parseJsonSafe('{not json'), null);
});

// --- logError ---------------------------------------------------------------

test('logError creates the data dir and appends a parseable JSON line', () => {
  const dir = tmpDir();
  logError('session-start', 'boom', dir);
  const logPath = path.join(dir, 'overwatch.log');
  assert.equal(fs.existsSync(logPath), true);
  const line = fs.readFileSync(logPath, 'utf8').trim().split('\n')[0];
  const entry = JSON.parse(line);
  assert.equal(entry.event, 'session-start');
  assert.equal(entry.message, 'boom');
  assert.equal(typeof entry.ts, 'string');
});

test('logError never throws even if the dir cannot be created', () => {
  // Path with a null byte-ish invalid segment is not portable; instead point
  // at a path whose parent is a file, which fails mkdirSync reliably.
  const dir = tmpDir();
  const blockerFile = path.join(dir, 'blocker');
  fs.writeFileSync(blockerFile, 'x');
  assert.doesNotThrow(() => logError('x', 'y', path.join(blockerFile, 'nested')));
});

// --- readStdinJson (via subprocess, to exercise real fd 0) ------------------

function runReadStdinJson(input, dataDir) {
  const script = `
    const { readStdinJson } = require(${JSON.stringify(path.join(__dirname, 'overwatch.js'))});
    process.stdout.write(JSON.stringify(readStdinJson('test-event', ${JSON.stringify(dataDir)})));
  `;
  const out = execFileSync(process.execPath, ['-e', script], { input });
  return JSON.parse(out.toString('utf8'));
}

test('readStdinJson returns the parsed payload for valid JSON on stdin', () => {
  const result = runReadStdinJson('{"session_id":"abc"}', tmpDir());
  assert.deepEqual(result, { session_id: 'abc' });
});

test('readStdinJson returns {} and logs on invalid JSON (never throws)', () => {
  const dir = tmpDir();
  const result = runReadStdinJson('{not json', dir);
  assert.deepEqual(result, {});
  const logPath = path.join(dir, 'overwatch.log');
  assert.equal(fs.existsSync(logPath), true);
});

test('readStdinJson returns {} for empty stdin', () => {
  const result = runReadStdinJson('', tmpDir());
  assert.deepEqual(result, {});
});

// --- loadSessions / writeSessionsFile ---------------------------------------

test('writeSessionsFile then loadSessions round-trips the same object', () => {
  const dir = tmpDir();
  const sessions = { abc: { session_id: 'abc', status: 'running' } };
  writeSessionsFile(sessions, dir);
  assert.deepEqual(loadSessions(dir), sessions);
});

test('loadSessions returns {} when sessions.js does not exist yet', () => {
  const dir = tmpDir();
  assert.deepEqual(loadSessions(dir), {});
});

test('loadSessions returns {} for a corrupted sessions.js', () => {
  const dir = tmpDir();
  fs.writeFileSync(sessionsFilePath(dir), 'this is not the expected format at all');
  assert.deepEqual(loadSessions(dir), {});
});

test('writeSessionsFile leaves no orphan .tmp file behind', () => {
  const dir = tmpDir();
  writeSessionsFile({ a: 1 }, dir);
  const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  assert.equal(fs.existsSync(sessionsFilePath(dir)), true);
});

// --- withSessionsLock --------------------------------------------------------

function spawnLockedWriter(dataDir, key, delayMs) {
  const script = `
    const { withSessionsLock } = require(${JSON.stringify(path.join(__dirname, 'overwatch.js'))});
    withSessionsLock(${JSON.stringify(dataDir)}, sessions => {
      const start = Date.now();
      while (Date.now() - start < ${delayMs}) { /* simulate held lock */ }
      sessions[${JSON.stringify(key)}] = { session_id: ${JSON.stringify(key)} };
    });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script]);
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

test('withSessionsLock serializes two concurrent writers - neither mutation is lost', async () => {
  const dir = tmpDir();
  await Promise.all([spawnLockedWriter(dir, 'a', 150), spawnLockedWriter(dir, 'b', 150)]);
  const sessions = loadSessions(dir);
  assert.deepEqual(Object.keys(sessions).sort(), ['a', 'b']);
});

test('withSessionsLock removes a stale lock (mtime > 5s) and proceeds', () => {
  const dir = tmpDir();
  fs.mkdirSync(dir, { recursive: true });
  const stalePath = lockFilePath(dir);
  fs.writeFileSync(stalePath, '999999');
  const oldTime = new Date(Date.now() - 10_000);
  fs.utimesSync(stalePath, oldTime, oldTime);

  const start = Date.now();
  withSessionsLock(dir, sessions => {
    sessions.fresh = { session_id: 'fresh' };
  });
  const elapsedMs = Date.now() - start;

  assert.deepEqual(loadSessions(dir), { fresh: { session_id: 'fresh' } });
  // Should not have exhausted the ~2.75s of backoff retries - stale lock is
  // detected and removed on the first attempt.
  assert.ok(elapsedMs < 1000, `expected fast recovery, took ${elapsedMs}ms`);
});

test('withSessionsLock always releases the lock, even when mutateFn throws', () => {
  const dir = tmpDir();
  assert.throws(() => {
    withSessionsLock(dir, () => {
      throw new Error('boom');
    });
  }, /boom/);
  assert.equal(fs.existsSync(lockFilePath(dir)), false);
});

// --- resolveBranch -----------------------------------------------------------

test('resolveBranch returns the current branch for a real git repo', () => {
  const branch = resolveBranch(REPO_ROOT);
  assert.equal(typeof branch, 'string');
  assert.ok(branch.length > 0);
});

test('resolveBranch returns null for a directory that is not a git repo', () => {
  const dir = tmpDir();
  assert.equal(resolveBranch(dir), null);
});

// --- handleSessionStart ------------------------------------------------------

test('handleSessionStart creates a full Session entry from a valid payload', () => {
  const sessions = {};
  handleSessionStart(sessions, { session_id: 'abc', cwd: REPO_ROOT });
  const entry = sessions.abc;
  assert.equal(entry.session_id, 'abc');
  assert.equal(entry.cwd, REPO_ROOT);
  assert.equal(entry.project, path.basename(REPO_ROOT));
  assert.equal(typeof entry.branch, 'string');
  assert.equal(entry.summary, '');
  assert.equal(typeof entry.started_at, 'string');
  assert.equal(entry.started_at, entry.last_update);
  assert.equal(entry.ended_at, null);
  assert.equal(entry.context_pct, null);
  assert.equal(entry.status, 'running');
  assert.deepEqual(entry.todos, []);
});

test('handleSessionStart derives project as the basename of a Windows-style cwd', () => {
  const sessions = {};
  handleSessionStart(sessions, { session_id: 'win', cwd: 'C:\\projects\\site\\site-casara' });
  assert.equal(sessions.win.project, 'site-casara');
});

// --- handlePrompt -------------------------------------------------------------

test('handlePrompt truncates summary to exactly 80 characters', () => {
  const sessions = {};
  handleSessionStart(sessions, { session_id: 'abc', cwd: REPO_ROOT });
  const longPrompt = 'x'.repeat(200);
  handlePrompt(sessions, { session_id: 'abc', prompt: longPrompt });
  assert.equal(sessions.abc.summary.length, 80);
  assert.equal(sessions.abc.summary, 'x'.repeat(80));
});

test('handlePrompt sets status to running even if it was idle or waiting', () => {
  const sessions = {};
  handleSessionStart(sessions, { session_id: 'abc', cwd: REPO_ROOT });
  sessions.abc.status = 'waiting';
  handlePrompt(sessions, { session_id: 'abc', prompt: 'oi' });
  assert.equal(sessions.abc.status, 'running');
});

test('handlePrompt creates the session entry when session_id is unknown', () => {
  const sessions = {};
  handlePrompt(sessions, { session_id: 'new', cwd: REPO_ROOT, prompt: 'primeiro prompt' });
  assert.ok(sessions.new);
  assert.equal(sessions.new.summary, 'primeiro prompt');
  assert.equal(sessions.new.status, 'running');
});

// --- handleWaiting -------------------------------------------------------------

test('handleWaiting sets status to waiting for an existing session', () => {
  const sessions = {};
  handleSessionStart(sessions, { session_id: 'abc', cwd: REPO_ROOT });
  handleWaiting(sessions, { session_id: 'abc' });
  assert.equal(sessions.abc.status, 'waiting');
});

test('handleWaiting is a safe no-op for an unknown session_id', () => {
  const sessions = {};
  assert.doesNotThrow(() => handleWaiting(sessions, { session_id: 'ghost' }));
  assert.deepEqual(sessions, {});
});

// --- handleIdle ----------------------------------------------------------------

test('handleIdle sets status to idle for an existing session', () => {
  const sessions = {};
  handleSessionStart(sessions, { session_id: 'abc', cwd: REPO_ROOT });
  handleIdle(sessions, { session_id: 'abc' });
  assert.equal(sessions.abc.status, 'idle');
});

test('handleIdle is a safe no-op for an unknown session_id', () => {
  const sessions = {};
  assert.doesNotThrow(() => handleIdle(sessions, { session_id: 'ghost' }));
  assert.deepEqual(sessions, {});
});
