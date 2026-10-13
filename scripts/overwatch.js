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

// O statusline so roda no terminal; na extensao do VS Code ele nunca dispara
// e o context_pct ficava nulo. O transcript tem o uso real da ultima resposta
// (input + cache), entao o hook Stop/prompt calcula o contexto a partir dele.
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const DEFAULT_CONTEXT_WINDOW = 200000;
const LARGE_CONTEXT_WINDOW = 1000000;

function contextWindowFor(model) {
  const fromEnv = Number(process.env.OVERWATCH_CONTEXT_WINDOW);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return typeof model === 'string' && model.includes('[1m]') ? LARGE_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW;
}

// Le so o fim do arquivo: o transcript cresce sem parar e este hook roda a
// cada fim de turno. Retorna { tokens, model } da ultima resposta do
// assistente, ou null se nao achar uso.
function readContextFromTranscript(transcriptPath, fsApi = fs) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  let fd;
  try {
    fd = fsApi.openSync(transcriptPath, 'r');
    const size = fsApi.fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buf = Buffer.alloc(length);
    fsApi.readSync(fd, buf, 0, length, size - length);
    const lines = buf.toString('utf8').split('\n');
    if (size > length) lines.shift(); // primeira linha pode estar cortada
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      const usage = entry && entry.type === 'assistant' && entry.message && entry.message.usage;
      if (!usage) continue;
      const tokens =
        (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
      if (tokens > 0) return { tokens, model: entry.message.model };
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fsApi.closeSync(fd);
      } catch {
        // nada a fazer
      }
    }
  }
}

function applyTranscriptContext(entry, payload) {
  const ctx = readContextFromTranscript(payload.transcript_path);
  if (!ctx) return;
  entry.context_tokens = ctx.tokens;
  // O statusline, quando existe, e mais exato: nao deixa o transcript sobrescrever.
  if (entry.context_source === 'statusline') return;
  entry.context_pct = Math.min(100, Math.round((ctx.tokens / contextWindowFor(ctx.model)) * 100));
  entry.context_source = 'transcript';
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
  applyTranscriptContext(sessions[sessionId], payload);
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
  applyTranscriptContext(entry, payload);
}

function handleSessionEnd(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const now = new Date().toISOString();
  entry.ended_at = now;
  entry.status = 'ended';
  entry.last_update = now;
  for (const agent of entry.agents || []) {
    if (agent.status === 'running') {
      agent.status = 'done';
      agent.ended_at = now;
    }
  }
}

function handleStatusline(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const usedPct = payload.context_window && payload.context_window.used_percentage;
  if (typeof usedPct !== 'number' || Number.isNaN(usedPct)) return;
  const contextPct = Math.round(usedPct);
  if (entry.context_pct === contextPct) return;
  entry.context_pct = contextPct;
  entry.context_source = 'statusline';
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

function readFeatureTickets(issuesDir, fsApi = fs) {
  let names;
  try {
    names = fsApi.readdirSync(issuesDir).filter(n => /^\d+-.+\.md$/.test(n)).sort();
  } catch {
    return [];
  }
  const tickets = [];
  for (const name of names) {
    try {
      tickets.push(parseTicket(fsApi.readFileSync(path.join(issuesDir, name), 'utf8'), name));
    } catch {
      // ticket ilegivel: segue com os outros
    }
  }
  return tickets;
}

// Qualquer arquivo dentro de work/features/<slug>/ liga a sessao a feature:
// a spec (DD-MM-AAAA-<slug>.md), os tickets (issues/NN-*.md) ou o progresso.md.
const FEATURE_DIR_RE = /^(.*[\\/]work[\\/]features[\\/]([^\\/]+))[\\/]/;
const SPEC_FILE_RE = /^\d{2}-\d{2}-\d{4}-.+\.md$/;

function isFeatureFile(filePath) {
  return typeof filePath === 'string' && FEATURE_DIR_RE.test(filePath);
}

// Edit/Write numa feature relê a pasta inteira: o painel mostra a lista
// completa de tickets, nao so o que foi editado.
function handleSpecTasks(sessions, payload, fsApi = fs) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (!isFeatureFile(filePath)) return;
  const [, featureDir, slug] = filePath.match(FEATURE_DIR_RE);

  const tickets = readFeatureTickets(path.join(featureDir, 'issues'), fsApi);
  let hasSpec = false;
  try {
    hasSpec = fsApi.readdirSync(featureDir).some(n => SPEC_FILE_RE.test(n));
  } catch {
    // pasta ilegivel
  }
  if (tickets.length === 0 && !hasSpec) return;

  if (tickets.length > 0) entry.todos = tickets;
  entry.feature = {
    slug,
    has_spec: hasSpec,
    tickets_total: tickets.length,
    tickets_done: tickets.filter(t => t.status === 'completed').length,
  };
  refreshDerived(sessions, entry);
  entry.last_update = new Date().toISOString();
}

// --- Fluxo do spine: skills, agentes e subagentes ---------------------------
// Fluxo: grill -> spec -> tickets -> implement -> review -> commit -> retro
// (CLAUDE.md do spine, secao Agent skills).

const FLOW_STAGES = [
  { id: 'grill', label: 'grill', skills: ['grill-with-docs', 'grill-me', 'grilling'] },
  { id: 'spec', label: 'spec', skills: ['to-spec'] },
  { id: 'tickets', label: 'tickets', skills: ['to-tickets'] },
  { id: 'implement', label: 'implement', skills: ['implement', 'implement-spec'] },
  { id: 'review', label: 'review', skills: ['code-review'] },
  { id: 'commit', label: 'commit', skills: ['commit', 'pr'] },
  { id: 'retro', label: 'retro', skills: ['retro'] },
];
const FEATURE_ONLY_SKILLS = ['to-spec', 'to-tickets', 'implement-spec'];
const BUGFIX_SKILLS = ['diagnosing-bugs', 'wait-what'];
const MAX_SKILLS = 40;
const MAX_AGENTS = 20;
const MAX_PENDING_AGENTS = 10;
const SUMMARY_MAX = 140;

// "superpowers:brainstorming" -> "brainstorming"
function baseSkillName(name) {
  return String(name).split(':').pop();
}

function stageOfSkill(name) {
  const base = baseSkillName(name);
  const stage = FLOW_STAGES.find(s => s.skills.includes(base));
  return stage ? stage.id : null;
}

function computeKind(entry) {
  const names = (entry.skills || []).map(s => baseSkillName(s.name));
  if (entry.feature || names.some(n => FEATURE_ONLY_SKILLS.includes(n))) return 'feature';
  if (names.some(n => BUGFIX_SKILLS.includes(n))) return 'bugfix';
  return null;
}

// O fluxo e da feature, nao da sessao: o spine manda dar /clear entre etapas
// (implement-spec retoma do progresso.md), entao as skills de todas as sessoes
// da mesma feature contam. Artefatos tambem valem como evidencia.
function computeFlow(sessions, entry) {
  const slug = entry.feature && entry.feature.slug;
  if (!slug) return null;
  const related = Object.values(sessions).filter(s => s.feature && s.feature.slug === slug);
  const done = new Set();
  let lastStage = null;
  let lastAt = '';
  for (const s of related) {
    for (const sk of s.skills || []) {
      const stage = stageOfSkill(sk.name);
      if (!stage) continue;
      done.add(stage);
      if (sk.at >= lastAt) {
        lastAt = sk.at;
        lastStage = stage;
      }
    }
  }
  const f = entry.feature;
  if (f.has_spec) done.add('spec');
  if (f.tickets_total > 0) done.add('tickets');
  if (f.tickets_total > 0 && f.tickets_done === f.tickets_total) done.add('implement');
  return FLOW_STAGES.map(s => ({
    id: s.id,
    label: s.label,
    state: s.id === lastStage ? 'current' : done.has(s.id) ? 'done' : 'pending',
  }));
}

function refreshDerived(sessions, entry) {
  entry.kind = computeKind(entry);
  entry.flow = entry.kind === 'feature' ? computeFlow(sessions, entry) : null;
}

function handleSkill(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const input = payload.tool_input || {};
  const name = typeof input.skill === 'string' ? input.skill : typeof input.name === 'string' ? input.name : '';
  if (!name.trim()) return;
  const now = new Date().toISOString();
  entry.skills = [...(entry.skills || []), { name: name.trim(), at: now }].slice(-MAX_SKILLS);
  refreshDerived(sessions, entry);
  entry.last_update = now;
}

// PreToolUse do Agent/Task: o SubagentStart nao traz a descricao, so o tipo.
// Guardamos a descricao na fila e o proximo SubagentStart do mesmo tipo a consome.
function handleAgentLaunch(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry) return;
  const input = payload.tool_input || {};
  const type = input.subagent_type || input.agent_type || 'general-purpose';
  const description = typeof input.description === 'string' ? input.description.slice(0, SUMMARY_MAX) : '';
  entry.pending_agents = [...(entry.pending_agents || []), { type, description }].slice(-MAX_PENDING_AGENTS);
}

function trimAgents(agents) {
  if (agents.length <= MAX_AGENTS) return agents;
  const running = agents.filter(a => a.status === 'running');
  const finished = agents.filter(a => a.status !== 'running');
  return [...finished.slice(-(MAX_AGENTS - running.length)), ...running].slice(-MAX_AGENTS);
}

function handleSubagentStart(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry || !payload.agent_id) return;
  const agents = [...(entry.agents || [])];
  if (agents.some(a => a.id === payload.agent_id)) return;
  const type = payload.agent_type || 'agent';
  const pending = entry.pending_agents || [];
  const idx = pending.findIndex(p => p.type === type);
  const description = idx >= 0 ? pending[idx].description : '';
  if (idx >= 0) entry.pending_agents = pending.filter((_, i) => i !== idx);
  const now = new Date().toISOString();
  agents.push({ id: payload.agent_id, type, description, status: 'running', started_at: now, ended_at: null, summary: '' });
  entry.agents = trimAgents(agents);
  entry.last_update = now;
}

function handleSubagentStop(sessions, payload) {
  const entry = sessions[payload.session_id];
  if (!entry || !payload.agent_id) return;
  const now = new Date().toISOString();
  const agents = [...(entry.agents || [])];
  let agent = agents.find(a => a.id === payload.agent_id);
  if (!agent) {
    agent = { id: payload.agent_id, type: payload.agent_type || 'agent', description: '', started_at: now };
    agents.push(agent);
  }
  agent.status = 'done';
  agent.ended_at = now;
  const last = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  agent.summary = last.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX);
  entry.agents = trimAgents(agents);
  entry.last_update = now;
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
  skill: handleSkill,
  'agent-launch': handleAgentLaunch,
  'subagent-start': handleSubagentStart,
  'subagent-stop': handleSubagentStop,
};

function main(dataDir = DEFAULT_DATA_DIR, panelPath = DEFAULT_PANEL_PATH) {
  const event = process.argv[2];
  const handler = EVENT_HANDLERS[event];
  const payload = readStdinJson(event, dataDir);
  if (!handler) return;
  // spec-tasks fires on every Edit/Write in every session, for any project -
  // filter by file_path before touching the sessions.js lock so editing
  // unrelated files never pays that cost.
  if (event === 'spec-tasks' && !isFeatureFile(payload.tool_input && payload.tool_input.file_path)) return;
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
  readContextFromTranscript,
  parseTicket,
  handleSpecTasks,
  isFeatureFile,
  readFeatureTickets,
  computeKind,
  computeFlow,
  handleSkill,
  handleAgentLaunch,
  handleSubagentStart,
  handleSubagentStop,
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
