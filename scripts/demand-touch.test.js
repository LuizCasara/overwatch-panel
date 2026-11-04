'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleSpecTasks, markArchivedDemands } = require('./overwatch.js');

function spine(slugs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-demand-'));
  for (const slug of slugs) {
    const dir = path.join(root, 'work', 'features', slug);
    fs.mkdirSync(path.join(dir, 'issues'), { recursive: true });
    fs.writeFileSync(path.join(dir, '01-04-2026-' + slug + '.md'), '# Spec (RM-548)\n');
    fs.writeFileSync(path.join(dir, 'issues', '01-a.md'), '# 01: A\n- [ ] x\n');
  }
  return root;
}

const edit = (root, slug, id = 's1') => ({
  session_id: id,
  tool_input: { file_path: path.join(root, 'work', 'features', slug, 'issues', '01-a.md') },
});

test('touching a demand records it with date and rm on the session', () => {
  const root = spine(['one']);
  const sessions = { s1: {} };
  handleSpecTasks(sessions, edit(root, 'one'));
  const touch = sessions.s1.features_touched.one;
  assert.equal(touch.rm, 548);
  assert.ok(!Number.isNaN(Date.parse(touch.at)));
});

test('a chat touching two demands keeps both, feature stays the latest', () => {
  const root = spine(['one', 'two']);
  const sessions = { s1: {} };
  handleSpecTasks(sessions, edit(root, 'one'));
  handleSpecTasks(sessions, edit(root, 'two'));
  assert.deepEqual(Object.keys(sessions.s1.features_touched).sort(), ['one', 'two']);
  assert.equal(sessions.s1.feature.slug, 'two');
});

test('markArchivedDemands flags a touched demand whose folder moved to work/archive', () => {
  const root = spine(['one', 'two']);
  const sessions = { s1: {} };
  handleSpecTasks(sessions, edit(root, 'one'));
  handleSpecTasks(sessions, edit(root, 'two'));
  fs.mkdirSync(path.join(root, 'work', 'archive'), { recursive: true });
  fs.renameSync(path.join(root, 'work', 'features', 'one'), path.join(root, 'work', 'archive', 'one'));
  markArchivedDemands(sessions);
  assert.ok(Date.parse(sessions.s1.features_touched.one.archived_at) > 0);
  assert.equal(sessions.s1.features_touched.two.archived_at, undefined);
});

test('markArchivedDemands dates the archive by the fase file, not by the folder mtime', () => {
  const root = spine(['one']);
  const sessions = { s1: {} };
  handleSpecTasks(sessions, edit(root, 'one'));
  const dir = path.join(root, 'work', 'features', 'one');
  fs.writeFileSync(path.join(dir, 'fase'), 'ship\n');
  const fixed = new Date('2026-10-01T10:00:00Z');
  fs.utimesSync(path.join(dir, 'fase'), fixed, fixed);
  fs.mkdirSync(path.join(root, 'work', 'archive'), { recursive: true });
  fs.renameSync(dir, path.join(root, 'work', 'archive', 'one'));
  fs.writeFileSync(path.join(root, 'work', 'archive', 'one', 'later.txt'), 'x'); // mexe no mtime da pasta
  markArchivedDemands(sessions);
  assert.equal(sessions.s1.features_touched.one.archived_at, fixed.toISOString());
  fs.writeFileSync(path.join(root, 'work', 'archive', 'one', 'later2.txt'), 'y');
  markArchivedDemands(sessions);
  assert.equal(sessions.s1.features_touched.one.archived_at, fixed.toISOString());
});

test('markArchivedDemands reads the phase from work/features/<slug>/fase', () => {
  const root = spine(['one']);
  const sessions = { s1: {} };
  handleSpecTasks(sessions, edit(root, 'one'));
  markArchivedDemands(sessions);
  assert.equal(sessions.s1.features_touched.one.phase, undefined);
  fs.writeFileSync(path.join(root, 'work', 'features', 'one', 'fase'), 'manual-test\n');
  markArchivedDemands(sessions);
  assert.equal(sessions.s1.features_touched.one.phase, 'manual-test');
});
