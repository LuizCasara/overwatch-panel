import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  mergeHooks,
  mergeStatusLine,
  statuslineOriginalCommandPath,
  statuslineWrapperCommand,
  panelConfigPath,
  writePanelConfig,
} from './install-lib.js';

const REPO_ROOT = 'C:\\projects\\claude-overwatch';
const REAL_REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function tmpRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-install-test-'));
}

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-home-test-'));
}

test('mergeHooks produces all 6 expected hook groups from an empty settings object', () => {
  const result = mergeHooks({}, REPO_ROOT);
  const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreToolUse', 'Stop', 'SessionEnd'];
  for (const event of events) {
    assert.ok(Array.isArray(result.hooks[event]), `expected hooks.${event} to be an array`);
    assert.equal(result.hooks[event].length, 1);
    assert.equal(result.hooks[event][0].hooks[0].async, true);
    assert.match(result.hooks[event][0].hooks[0].command, /overwatch\.js/);
  }
});

test('mergeHooks preserves pre-existing third-party hook groups', () => {
  // Fixture inspired by the user's real ~/.claude/settings.json.
  const settings = {
    hooks: {
      SubagentStart: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'node "$HOME/.claude/scripts/track-usage.js" agent', async: true }],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Skill',
          hooks: [{ type: 'command', command: 'node "$HOME/.claude/scripts/track-usage.js" skill', async: true }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: '& "notify-stop.ps1"', shell: 'powershell', async: true }],
        },
      ],
    },
  };
  const result = mergeHooks(settings, REPO_ROOT);

  // Untouched third-party event.
  assert.deepEqual(result.hooks.SubagentStart, settings.hooks.SubagentStart);

  // PostToolUse keeps the Skill group and gains a second group for TodoWrite.
  assert.equal(result.hooks.PostToolUse.length, 2);
  assert.deepEqual(result.hooks.PostToolUse[0], settings.hooks.PostToolUse[0]);
  assert.match(result.hooks.PostToolUse[1].hooks[0].command, /overwatch\.js" todo/);

  // Stop keeps the notify-stop group and gains a second group for idle.
  assert.equal(result.hooks.Stop.length, 2);
  assert.deepEqual(result.hooks.Stop[0], settings.hooks.Stop[0]);
  assert.match(result.hooks.Stop[1].hooks[0].command, /overwatch\.js" idle/);
});

test('mergeHooks is idempotent - applying it twice does not duplicate groups', () => {
  const once = mergeHooks({}, REPO_ROOT);
  const twice = mergeHooks(once, REPO_ROOT);
  assert.deepEqual(twice, once);
});

// --- mergeStatusLine ---------------------------------------------------------

test('mergeStatusLine saves the original command and points to the wrapper', () => {
  const repoRoot = tmpRepoRoot();
  const settings = { statusLine: { command: 'bash ~/.claude/statusline-command.sh' } };
  const result = mergeStatusLine(settings, repoRoot);

  assert.equal(result.statusLine.command, statuslineWrapperCommand(repoRoot));
  const saved = fs.readFileSync(statuslineOriginalCommandPath(repoRoot), 'utf8');
  assert.equal(saved, 'bash ~/.claude/statusline-command.sh');
});

test('mergeStatusLine is idempotent - a second run keeps the saved original untouched', () => {
  const repoRoot = tmpRepoRoot();
  const settings = { statusLine: { command: 'bash ~/.claude/statusline-command.sh' } };
  const once = mergeStatusLine(settings, repoRoot);
  const twice = mergeStatusLine(once, repoRoot);

  assert.equal(twice.statusLine.command, statuslineWrapperCommand(repoRoot));
  const saved = fs.readFileSync(statuslineOriginalCommandPath(repoRoot), 'utf8');
  assert.equal(saved, 'bash ~/.claude/statusline-command.sh');
});

test('mergeStatusLine configures the wrapper even when statusLine was never set', () => {
  const repoRoot = tmpRepoRoot();
  const result = mergeStatusLine({}, repoRoot);
  assert.equal(result.statusLine.command, statuslineWrapperCommand(repoRoot));
  assert.equal(fs.existsSync(statuslineOriginalCommandPath(repoRoot)), false);
});

// --- writePanelConfig ---------------------------------------------------------

test('writePanelConfig writes a valid file:// URL with no raw backslashes', () => {
  const repoRoot = tmpRepoRoot();
  const homeDir = 'C:\\Users\\Luiz';
  writePanelConfig(repoRoot, homeDir);
  const content = fs.readFileSync(panelConfigPath(repoRoot), 'utf8');
  assert.match(content, /window\.OVERWATCH_DATA_URL = "file:\/\/\//);
  assert.match(content, /sessions\.js/);
  const urlLiteral = content.match(/"(.*)"/)[1];
  assert.equal(urlLiteral.includes('\\'), false);
});

test('writePanelConfig overwrites the config when run again with a different home', () => {
  const repoRoot = tmpRepoRoot();
  writePanelConfig(repoRoot, 'C:\\Users\\Alice');
  const first = fs.readFileSync(panelConfigPath(repoRoot), 'utf8');
  writePanelConfig(repoRoot, 'C:\\Users\\Bob');
  const second = fs.readFileSync(panelConfigPath(repoRoot), 'utf8');
  assert.notEqual(first, second);
  assert.match(second, /Bob/);
});

// --- install.mjs CLI (real subprocess, isolated HOME) -----------------------

function runInstallCli(homeDir) {
  return execFileSync(process.execPath, [path.join(REAL_REPO_ROOT, 'install.mjs')], {
    env: { ...process.env, USERPROFILE: homeDir, HOME: homeDir },
  }).toString('utf8');
}

test('install.mjs creates settings.json with the expected hooks when none existed', () => {
  const home = tmpHome();
  runInstallCli(home);
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.ok(Array.isArray(settings.hooks.SessionStart));
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, /overwatch\.js/);
  assert.equal(fs.existsSync(path.join(REAL_REPO_ROOT, 'panel', 'panel-config.js')), true);
});

test('install.mjs run twice does not duplicate hook groups', () => {
  const home = tmpHome();
  runInstallCli(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const firstSettings = fs.readFileSync(settingsPath, 'utf8');
  runInstallCli(home);
  const secondSettings = fs.readFileSync(settingsPath, 'utf8');
  assert.equal(secondSettings, firstSettings);
});
