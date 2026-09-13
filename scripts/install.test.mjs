import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeHooks, mergeStatusLine, statuslineOriginalCommandPath, statuslineWrapperCommand } from './install-lib.js';

const REPO_ROOT = 'C:\\projects\\claude-overwatch';

function tmpRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-install-test-'));
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
