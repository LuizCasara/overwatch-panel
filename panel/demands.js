// Agrupamento puro das sessoes por demanda (slug de work/features/<slug>/).
// UMD simples, como format.js: <script src="demands.js"> no painel
// (window.OverwatchDemands) e require() nos testes Node.
(function (root, factory) {
  const exportsObj = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  }
  if (root) {
    root.OverwatchDemands = exportsObj;
  }
})(typeof window !== 'undefined' ? window : undefined, function () {
  'use strict';

  const ARCHIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const PHASES = ['implement', 'review', 'validate', 'manual-test', 'ship'];
  // Skill -> fase, quando o arquivo de estado nao gravou a fase na sessao.
  const SKILL_PHASE = {
    'implement': 'implement',
    'implement-spec': 'implement',
    'code-review': 'review',
    'validate': 'validate',
    'ship': 'ship',
  };

  function ms(iso) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? -Infinity : t;
  }

  function sessionPhase(session) {
    if (PHASES.includes(session.phase)) return session.phase;
    const skills = Array.isArray(session.skills) ? session.skills : [];
    let best = null;
    let bestAt = -Infinity;
    skills.forEach(sk => {
      if (!sk || typeof sk.name !== 'string') return;
      const phase = SKILL_PHASE[sk.name.split(':').pop()];
      if (phase && ms(sk.at) >= bestAt) {
        best = phase;
        bestAt = ms(sk.at);
      }
    });
    return best;
  }

  // Demandas tocadas pela sessao: slug -> { at, rm?, archived_at? }. Sessao
  // salva antes de features_touched cai na feature unica que ela ja tinha.
  function touchedOf(session) {
    if (session.features_touched && typeof session.features_touched === 'object') {
      return session.features_touched;
    }
    const f = session.feature;
    if (f && f.slug) {
      const touch = { at: session.last_update };
      if (f.rm !== undefined) touch.rm = f.rm;
      return { [f.slug]: touch };
    }
    return {};
  }

  function groupByDemand(sessions, options) {
    const nowMs = (options && options.nowMs) || Date.now();
    const bySlug = {};
    const loose = [];

    Object.keys(sessions || {}).forEach(id => {
      const session = sessions[id];
      if (!session) return;
      const phase = sessionPhase(session);
      const touched = touchedOf(session);
      const slugs = Object.keys(touched);
      if (slugs.length === 0) {
        loose.push({ id, session, at: session.last_update, phase });
        return;
      }
      slugs.forEach(slug => {
        const touch = touched[slug] || {};
        const demand = bySlug[slug] || (bySlug[slug] = { slug, rm: null, archived_at: null, chats: [] });
        if (demand.rm === null && touch.rm !== undefined && touch.rm !== null) demand.rm = touch.rm;
        if (touch.archived_at) demand.archived_at = touch.archived_at;
        if (touch.phase && PHASES.includes(touch.phase) && ms(touch.at) >= (demand.phaseAt || -Infinity)) {
          demand.fasePhase = touch.phase;
          demand.phaseAt = ms(touch.at);
        }
        demand.chats.push({ id, session, at: touch.at || session.last_update, phase });
      });
    });

    const demands = [];
    Object.keys(bySlug).forEach(slug => {
      const demand = bySlug[slug];
      if (demand.archived_at && nowMs - ms(demand.archived_at) > ARCHIVE_TTL_MS) return;
      demand.chats.sort((a, b) => ms(b.at) - ms(a.at));
      demand.concluded = Boolean(demand.archived_at);
      const withPhase = demand.chats.find(c => c.phase);
      demand.phase = demand.concluded ? 'concluded' : demand.fasePhase || (withPhase ? withPhase.phase : null);
      demand.last_at = demand.chats[0].at;
      demands.push(demand);
    });
    demands.sort((a, b) => ms(b.last_at) - ms(a.last_at));
    loose.sort((a, b) => ms(b.at) - ms(a.at));
    return { demands, loose };
  }

  return { groupByDemand, sessionPhase, ARCHIVE_TTL_MS, PHASES };
});
