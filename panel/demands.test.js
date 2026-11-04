'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupByDemand, ARCHIVE_TTL_MS } = require('./demands.js');

const NOW = Date.parse('2026-11-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = ms => new Date(ms).toISOString();

function session(over) {
  return { status: 'idle', summary: 's', last_update: iso(NOW - 1000), skills: [], ...over };
}

test('chat touching one demand is attached to it, with date, link id and rm', () => {
  const { demands, loose } = groupByDemand({
    a: session({ session_id: 'a', features_touched: { 'my-slug': { at: '2026-11-09T10:00:00Z', rm: 548 } } }),
  }, { nowMs: NOW });
  assert.equal(loose.length, 0);
  assert.equal(demands.length, 1);
  assert.equal(demands[0].slug, 'my-slug');
  assert.equal(demands[0].rm, 548);
  assert.deepEqual(demands[0].chats.map(c => [c.id, c.at]), [['a', '2026-11-09T10:00:00Z']]);
});

test('a chat that touched two demands appears in both, each with its own date', () => {
  const { demands } = groupByDemand({
    a: session({
      features_touched: { one: { at: '2026-11-01T00:00:00Z' }, two: { at: '2026-11-05T00:00:00Z' } },
    }),
  }, { nowMs: NOW });
  const by = Object.fromEntries(demands.map(d => [d.slug, d.chats.map(c => [c.id, c.at])]));
  assert.deepEqual(by, { one: [['a', '2026-11-01T00:00:00Z']], two: [['a', '2026-11-05T00:00:00Z']] });
});

test('chats of the same demand are listed newest first and the demand takes the first rm found', () => {
  const { demands } = groupByDemand({
    a: session({ features_touched: { x: { at: '2026-11-01T00:00:00Z' } } }),
    b: session({ features_touched: { x: { at: '2026-11-03T00:00:00Z', rm: 7 } } }),
  }, { nowMs: NOW });
  assert.deepEqual(demands[0].chats.map(c => c.id), ['b', 'a']);
  assert.equal(demands[0].rm, 7);
});

test('chat without a demand stays loose; demands are ordered by latest chat', () => {
  const { demands, loose } = groupByDemand({
    solo: session({}),
    old: session({ features_touched: { old: { at: '2026-11-01T00:00:00Z' } } }),
    fresh: session({ features_touched: { fresh: { at: '2026-11-08T00:00:00Z' } } }),
  }, { nowMs: NOW });
  assert.deepEqual(loose.map(c => c.id), ['solo']);
  assert.deepEqual(demands.map(d => d.slug), ['fresh', 'old']);
});

test('session saved before features_touched falls back to its single feature', () => {
  const { demands } = groupByDemand({
    a: session({ feature: { slug: 'legacy', rm: 3 }, last_update: '2026-11-09T00:00:00Z' }),
  }, { nowMs: NOW });
  assert.equal(demands[0].slug, 'legacy');
  assert.equal(demands[0].rm, 3);
  assert.equal(demands[0].chats[0].at, '2026-11-09T00:00:00Z');
});

test('archived demand shows as concluded and disappears after 7 days', () => {
  const sessions = {
    a: session({ features_touched: { done: { at: '2026-11-01T00:00:00Z', archived_at: iso(NOW - 6 * DAY) } } }),
  };
  const shown = groupByDemand(sessions, { nowMs: NOW }).demands;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].concluded, true);
  assert.equal(shown[0].phase, 'concluded');
  assert.equal(ARCHIVE_TTL_MS, 7 * DAY);
  const gone = groupByDemand(sessions, { nowMs: NOW + 2 * DAY }).demands;
  assert.equal(gone.length, 0);
});

test('an archived demand does not leak its chats into the loose list', () => {
  const { loose } = groupByDemand({
    a: session({ features_touched: { done: { at: 'x', archived_at: iso(NOW - 30 * DAY) } } }),
  }, { nowMs: NOW });
  assert.equal(loose.length, 0);
});

test('state-file phase (validate, manual-test, ship) is the step of the demand', () => {
  for (const phase of ['validate', 'manual-test', 'ship']) {
    const { demands } = groupByDemand({
      a: session({ phase, features_touched: { x: { at: '2026-11-09T00:00:00Z' } } }),
    }, { nowMs: NOW });
    assert.equal(demands[0].phase, phase);
    assert.equal(demands[0].chats[0].phase, phase);
  }
});

test('phase falls back to the stage of the last flow skill; unknown phase is ignored', () => {
  const { demands } = groupByDemand({
    a: session({
      phase: 'bogus',
      skills: [{ name: 'to-spec', at: '2026-11-01T00:00:00Z' }, { name: 'superpowers:validate', at: '2026-11-02T00:00:00Z' }],
      features_touched: { x: { at: '2026-11-09T00:00:00Z' } },
    }),
  }, { nowMs: NOW });
  assert.equal(demands[0].phase, 'validate');
});

test('demand phase comes from its newest chat that has one', () => {
  const { demands } = groupByDemand({
    a: session({ phase: 'validate', features_touched: { x: { at: '2026-11-02T00:00:00Z' } } }),
    b: session({ phase: 'ship', features_touched: { x: { at: '2026-11-04T00:00:00Z' } } }),
    c: session({ features_touched: { x: { at: '2026-11-05T00:00:00Z' } } }),
  }, { nowMs: NOW });
  assert.equal(demands[0].phase, 'ship');
});

test('empty or invalid input yields empty groups', () => {
  assert.deepEqual(groupByDemand(null, { nowMs: NOW }), { demands: [], loose: [] });
  assert.deepEqual(groupByDemand({ a: null }, { nowMs: NOW }), { demands: [], loose: [] });
});

test('the demand phase comes from the phase file, ahead of the skills the chat ran', () => {
  const sessions = {
    a: { last_update: '2026-11-04T10:00:00Z', skills: [{ name: 'implement-spec', at: '2026-11-04T09:00:00Z' }],
      features_touched: { one: { at: '2026-11-04T10:00:00Z', phase: 'manual-test' } } },
  };
  const { demands } = require('./demands.js').groupByDemand(sessions, { nowMs: Date.parse('2026-11-04T11:00:00Z') });
  assert.equal(demands[0].phase, 'manual-test');
});
