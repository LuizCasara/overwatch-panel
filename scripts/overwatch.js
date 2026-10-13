#!/usr/bin/env node
// Hook único do claude-overwatch: le o payload de um hook do Claude Code via
// stdin e atualiza ~/.claude/overwatch-data/sessions.js. Nunca lanca - qualquer
// falha e engolida e logada, mesmo espirito de ~/.claude/scripts/track-usage.js
// (AD-001 em .specs/STATE.md).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, exec } = require('child_process');

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
  sessions[sessionId].ended_at = null;
  sessions[sessionId].last_update = new Date().toISOString();
}

function handleWaiting(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  entry.status = 'waiting';
  entry.last_update = new Date().toISOString();
}

function handleIdle(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  entry.status = 'idle';
  entry.last_update = new Date().toISOString();
}

function handleSessionEnd(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const now = new Date().toISOString();
  entry.ended_at = now;
  entry.status = 'ended';
  entry.last_update = now;
}

function handleStatusline(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const usedPct = payload.context_window && payload.context_window.used_percentage;
  if (typeof usedPct !== 'number' || Number.isNaN(usedPct)) return;
  const contextPct = Math.round(usedPct);
  if (entry.context_pct === contextPct) return;
  entry.context_pct = contextPct;
  entry.last_update = new Date().toISOString();
}

function handleTodo(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const todos = payload.tool_input && Array.isArray(payload.tool_input.todos)
    ? payload.tool_input.todos
    : [];
  entry.todos = todos;
  entry.last_update = new Date().toISOString();
}

// Tickets do spine: work/features/<slug>/issues/NN-<slug>.md (ver
// docs/agents/issue-tracker.md do spine). O status do ticket e a linha
// "**Status:** ready-for-agent | in-progress | done"; os criterios sao
// checkboxes "- [ ]" / "- [x]".
const TICKET_FILE_RE = /[\\/]work[\\/]features[\\/]([^\\/]+)[\\/]issues[\\/](\d+)-[^\\/]+\.md$/;
const TICKET_STATUS_RE = /^\**Status:\**\s*([\w-]+)/im;
const TICKET_TITLE_RE = /^#\s+(?:\d+\s*:\s*)?(.+)$/m;

function isTicketFile(filePath) {
  return typeof filePath === 'string' && TICKET_FILE_RE.test(filePath);
}

// Criterios todos marcados valem mais que a linha Status: a skill pode
// marcar os checkboxes e esquecer de virar o status para done.
function parseTicket(content, fileName) {
  const number = (fileName.match(/^(\d+)-/) || [])[1] || '';
  const titleMatch = content.match(TICKET_TITLE_RE);
  const title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.md$/, '');
  const statusMatch = content.match(TICKET_STATUS_RE);
  const rawStatus = statusMatch ? statusMatch[1].toLowerCase() : '';
  const checked = (content.match(/^- \[x\]/gim) || []).length;
  const unchecked = (content.match(/^- \[ \]/gm) || []).length;

  let status = 'pending';
  if (checked > 0 && unchecked === 0) status = 'completed';
  else if (rawStatus === 'done') status = 'completed';
  else if (rawStatus === 'in-progress') status = 'in_progress';

  return { content: `${number}: ${title}`, status, checked, total: checked + unchecked };
}

function readFeatureTickets(ticketPath, fsApi = fs) {
  const dir = path.dirname(ticketPath);
  let names;
  try {
    names = fsApi.readdirSync(dir).filter(n => /^\d+-.+\.md$/.test(n)).sort();
  } catch {
    return [];
  }
  const tickets = [];
  for (const name of names) {
    try {
      tickets.push(parseTicket(fsApi.readFileSync(path.join(dir, name), 'utf8'), name));
    } catch {
      // ticket ilegivel: segue com os outros
    }
  }
  return tickets;
}

// Edit/Write num ticket relê a pasta inteira: o painel mostra a lista
// completa de tickets da feature, nao so o que foi editado.
function handleSpecTasks(sessions, payload, fsApi = fs) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (!isTicketFile(filePath)) return;
  const tickets = readFeatureTickets(filePath, fsApi);
  if (tickets.length === 0) return;
  entry.todos = tickets;
  entry.feature = { slug: filePath.match(TICKET_FILE_RE)[1] };
  entry.last_update = new Date().toISOString();
}

const ACTIVE_TTL_MS = 20 * 60 * 1000;
const DEFAULT_PANEL_PATH = path.join(__dirname, '..', 'panel', 'overwatch.html');

function isAnyOtherSessionActive(sessions, selfId) {
  const now = Date.now();
  return Object.keys(sessions).some(id => {
    if (id === selfId) return false;
    const entry = sessions[id];
    if (!entry || entry.status === 'ended') return false;
    const lastUpdateMs = Date.parse(entry.last_update);
    if (Number.isNaN(lastUpdateMs)) return false;
    return now - lastUpdateMs < ACTIVE_TTL_MS;
  });
}

function openPanelIfFirstSession(sessions, selfId, panelPath = DEFAULT_PANEL_PATH, execFn = exec) {
  if (isAnyOtherSessionActive(sessions, selfId)) return;
  try {
    execFn(`start "" "${panelPath}"`);
  } catch {
    // Opening the browser is best-effort - never critical to the hook.
  }
}

const EVENT_HANDLERS = {
  'session-start': handleSessionStart,
  prompt: handlePrompt,
  todo: handleTodo,
  waiting: handleWaiting,
  idle: handleIdle,
  'session-end': handleSessionEnd,
  statusline: handleStatusline,
  'spec-tasks': handleSpecTasks,
};

function main(dataDir = DEFAULT_DATA_DIR, panelPath = DEFAULT_PANEL_PATH) {
  const event = process.argv[2];
  const handler = EVENT_HANDLERS[event];
  const payload = readStdinJson(event, dataDir);
  if (!handler) return;
  // spec-tasks fires on every Edit/Write in every session, for any project -
  // filter by file_path before touching the sessions.js lock so editing
  // unrelated files never pays that cost.
  if (event === 'spec-tasks' && !isTicketFile(payload.tool_input && payload.tool_input.file_path)) return;
  withSessionsLock(dataDir, sessions => handler(sessions, payload));
  // SPEC_DEVIATION: design.md originally called openPanelIfFirstSession from
  // inside handleSessionStart. Moved here so the pure handler stays free of
  // process-spawning side effects and is safely reusable in unit tests.
  if (event === 'session-start' && payload.session_id) {
    openPanelIfFirstSession(loadSessions(dataDir), payload.session_id, panelPath);
  }
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
  handleIdle,
  handleSessionEnd,
  handleStatusline,
  handleTodo,
  isTicketFile,
  parseTicket,
  readFeatureTickets,
  handleSpecTasks,
  isAnyOtherSessionActive,
  openPanelIfFirstSession,
  main,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    try {
      logError('main', (err && err.message) || String(err));
    } catch {
      // Never let logging failure surface either.
    }
  }
  process.exit(0);
}
