#!/usr/bin/env node
// Instalador idempotente: mescla os hooks do claude-overwatch em
// ~/.claude/settings.json (sem remover hooks de outras ferramentas), aponta
// o statusLine para o wrapper preservando o comando original, e gera
// panel/panel-config.js com o caminho absoluto de sessions.js desta maquina.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOOK_TABLE, mergeHooks, mergeStatusLine, writePanelConfig } from './scripts/install-lib.js';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

function settingsPathFor(homeDir) {
  return path.join(homeDir, '.claude', 'settings.json');
}

function readSettings(settingsPath) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettingsAtomic(settingsPath, settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmpPath = `${settingsPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(tmpPath, settingsPath);
}

function hookAlreadyPresent(settings, event, command) {
  const groups = (settings.hooks && settings.hooks[event]) || [];
  return groups.some(group => Array.isArray(group.hooks) && group.hooks.some(h => h && h.command === command));
}

export function install(repoRoot = REPO_ROOT, homeDir = os.homedir()) {
  const settingsPath = settingsPathFor(homeDir);
  const before = readSettings(settingsPath);

  const afterHooks = mergeHooks(before, repoRoot);
  const afterStatusLine = mergeStatusLine(afterHooks, repoRoot);
  writeSettingsAtomic(settingsPath, afterStatusLine);
  writePanelConfig(repoRoot, homeDir);

  const summary = HOOK_TABLE.map(({ event, subEvent }) => {
    const command = `node "${path.join(repoRoot, 'scripts', 'overwatch.js')}" ${subEvent}`;
    return { event, status: hookAlreadyPresent(before, event, command) ? 'already configured' : 'added' };
  });
  return { settingsPath, summary };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { settingsPath, summary } = install();
  console.log(`claude-overwatch: settings.json em ${settingsPath}`);
  for (const { event, status } of summary) {
    console.log(`  ${event}: ${status}`);
  }
  console.log('claude-overwatch: panel/panel-config.js gerado.');
}
