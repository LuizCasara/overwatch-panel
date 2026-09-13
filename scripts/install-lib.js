'use strict';
// Funcoes puras usadas por install.mjs - mantidas em CommonJS e separadas do
// CLI para serem testaveis sobre objetos em memoria, sem tocar o
// ~/.claude/settings.json real do usuario.

const fs = require('fs');
const path = require('path');

const HOOK_TABLE = [
  { event: 'SessionStart', matcher: undefined, subEvent: 'session-start' },
  { event: 'UserPromptSubmit', matcher: undefined, subEvent: 'prompt' },
  { event: 'PostToolUse', matcher: 'TodoWrite', subEvent: 'todo' },
  { event: 'PreToolUse', matcher: 'AskUserQuestion|ExitPlanMode', subEvent: 'waiting' },
  { event: 'Stop', matcher: undefined, subEvent: 'idle' },
  { event: 'SessionEnd', matcher: undefined, subEvent: 'session-end' },
];

function overwatchCommand(repoRoot, subEvent) {
  const scriptPath = path.join(repoRoot, 'scripts', 'overwatch.js');
  return `node "${scriptPath}" ${subEvent}`;
}

function hasCommand(group, command) {
  return Array.isArray(group.hooks) && group.hooks.some(h => h && h.command === command);
}

function mergeHooks(settings, repoRoot) {
  const result = { ...settings, hooks: { ...(settings.hooks || {}) } };
  for (const { event, matcher, subEvent } of HOOK_TABLE) {
    const command = overwatchCommand(repoRoot, subEvent);
    const groups = result.hooks[event] ? [...result.hooks[event]] : [];
    const alreadyPresent = groups.some(group => hasCommand(group, command));
    if (!alreadyPresent) {
      const newGroup = { hooks: [{ type: 'command', command, async: true }] };
      if (matcher !== undefined) newGroup.matcher = matcher;
      groups.push(newGroup);
    }
    result.hooks[event] = groups;
  }
  return result;
}

function statuslineOriginalCommandPath(repoRoot) {
  return path.join(repoRoot, 'scripts', 'statusline-original-command.txt');
}

function statuslineWrapperCommand(repoRoot) {
  return `bash "${path.join(repoRoot, 'scripts', 'statusline-wrapper.sh')}"`;
}

function mergeStatusLine(settings, repoRoot) {
  const wrapperCommand = statuslineWrapperCommand(repoRoot);
  const current = settings.statusLine && settings.statusLine.command;
  if (current === wrapperCommand) {
    return settings;
  }
  const originalCmdPath = statuslineOriginalCommandPath(repoRoot);
  if (current && !fs.existsSync(originalCmdPath)) {
    fs.mkdirSync(path.dirname(originalCmdPath), { recursive: true });
    fs.writeFileSync(originalCmdPath, current);
  }
  return { ...settings, statusLine: { type: 'command', command: wrapperCommand } };
}

module.exports = {
  HOOK_TABLE,
  overwatchCommand,
  mergeHooks,
  statuslineOriginalCommandPath,
  statuslineWrapperCommand,
  mergeStatusLine,
};
