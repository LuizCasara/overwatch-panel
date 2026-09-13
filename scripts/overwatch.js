#!/usr/bin/env node
// Hook único do claude-overwatch: le o payload de um hook do Claude Code via
// stdin e atualiza ~/.claude/overwatch-data/sessions.js. Nunca lanca - qualquer
// falha e engolida e logada, mesmo espirito de ~/.claude/scripts/track-usage.js
// (AD-001 em .specs/STATE.md).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

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

module.exports = {
  DEFAULT_DATA_DIR,
  parseJsonSafe,
  logError,
  readStdinJson,
};
