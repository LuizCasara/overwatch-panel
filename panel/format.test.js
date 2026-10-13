'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatElapsed, extractSubProgress, computeOverallProgress, isExpired, partitionSessions } = require('./format.js');

// --- extractSubProgress ------------------------------------------------------

test('extractSubProgress parses a "(done/total)" pattern in the content', () => {
  assert.deepEqual(extractSubProgress('Revisar as 12 secoes do relatorio (3/12)'), { done: 3, total: 12 });
});

test('extractSubProgress returns null when there is no sub-progress pattern', () => {
  assert.equal(extractSubProgress('sem sub-progresso'), null);
});

// --- computeOverallProgress ---------------------------------------------------

test('computeOverallProgress counts completed over total', () => {
  const todos = [
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'in_progress' },
    { content: 'c', status: 'completed' },
    { content: 'd', status: 'pending' },
  ];
  assert.deepEqual(computeOverallProgress(todos), { done: 2, total: 4 });
});

test('computeOverallProgress returns {done:0,total:0} for an empty or missing list', () => {
  assert.deepEqual(computeOverallProgress([]), { done: 0, total: 0 });
  assert.deepEqual(computeOverallProgress(undefined), { done: 0, total: 0 });
});

// --- isExpired -----------------------------------------------------------------

test('isExpired is true past the 20 minute TTL and false just under it', () => {
  const now = Date.now();
  const twentyOneMinAgo = new Date(now - 21 * 60 * 1000).toISOString();
  const nineteenMinAgo = new Date(now - 19 * 60 * 1000).toISOString();
  assert.equal(isExpired(twentyOneMinAgo, now), true);
  assert.equal(isExpired(nineteenMinAgo, now), false);
});

test('isExpired is false at exactly the 20 minute boundary ("mais de 20min" = strictly greater)', () => {
  const now = Date.now();
  const exactlyTwentyMinAgo = new Date(now - 20 * 60 * 1000).toISOString();
  assert.equal(isExpired(exactlyTwentyMinAgo, now), false);
});

// --- partitionSessions ---------------------------------------------------------

test('partitionSessions: idle by TTL or ended, sorted newest first; never archived without a mark', () => {
  const now = Date.now();
  const ago = min => new Date(now - min * 60 * 1000).toISOString();
  const groups = partitionSessions({
    fresh: { status: 'running', last_update: ago(1) },
    old: { status: 'idle', last_update: ago(300) },
    older: { status: 'idle', last_update: ago(900) },
    newer: { status: 'waiting', last_update: ago(30) },
    done: { status: 'ended', last_update: ago(2) },
  }, {}, now);
  assert.deepEqual(groups.active.map(e => e.id), ['fresh']);
  assert.deepEqual(groups.idle.map(e => e.id), ['done', 'newer', 'old', 'older']);
  assert.deepEqual(groups.archived, []);
});

test('partitionSessions: archived only with an explicit mark; newer activity revives it', () => {
  const now = Date.now();
  const ago = min => new Date(now - min * 60 * 1000).toISOString();
  const groups = partitionSessions({
    kept: { status: 'idle', last_update: ago(100) },
    revived: { status: 'running', last_update: ago(1) },
    other: { status: 'idle', last_update: ago(500) },
  }, { kept: ago(100), revived: ago(50), other: ago(500) }, now);
  assert.deepEqual(groups.archived.map(e => e.id), ['kept', 'other']);
  assert.deepEqual(groups.active.map(e => e.id), ['revived']);
});

test('partitionSessions tolerates empty input and invalid dates', () => {
  assert.deepEqual(partitionSessions(undefined, undefined), { active: [], idle: [], archived: [] });
  const g = partitionSessions({ x: { status: 'idle', last_update: 'lixo' } }, {});
  assert.deepEqual(g.idle.map(e => e.id), ['x']);
});

// --- formatElapsed -------------------------------------------------------------

test('formatElapsed formats minutes under an hour and hours+minutes over it', () => {
  const now = Date.now();
  assert.equal(formatElapsed(new Date(now - 12 * 60 * 1000).toISOString(), now), '12min');
  assert.equal(formatElapsed(new Date(now - 64 * 60 * 1000).toISOString(), now), '1h 04min');
});

// --- UMD / require-ability ------------------------------------------------------

test('the module is require-able in Node without window defined', () => {
  assert.equal(typeof formatElapsed, 'function');
  assert.equal(typeof global.window, 'undefined');
});
