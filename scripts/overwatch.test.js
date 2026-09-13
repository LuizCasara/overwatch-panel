'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  parseJsonSafe,
  logError,
  readStdinJson,
} = require('./overwatch.js');

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
