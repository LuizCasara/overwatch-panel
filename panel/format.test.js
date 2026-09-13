'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatElapsed, extractSubProgress, computeOverallProgress, isExpired } = require('./format.js');

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
