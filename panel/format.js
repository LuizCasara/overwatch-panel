// Funcoes puras de formatacao/calculo usadas pelo painel. Padrao UMD simples
// para funcionar tanto via <script src="format.js"> no navegador (populando
// window.OverwatchFormat) quanto via require() nos testes Node.
(function (root, factory) {
  const exportsObj = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exportsObj;
  }
  if (root) {
    root.OverwatchFormat = exportsObj;
  }
})(typeof window !== 'undefined' ? window : undefined, function () {
  'use strict';

  const SUB_PROGRESS_RE = /(\d+)\s*\/\s*(\d+)/;

  function formatElapsed(startedAtIso, nowMs = Date.now()) {
    const startedMs = Date.parse(startedAtIso);
    if (Number.isNaN(startedMs)) return '—';
    const totalMinutes = Math.max(0, Math.floor((nowMs - startedMs) / 60000));
    if (totalMinutes < 60) return `${totalMinutes}min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  }

  function extractSubProgress(content) {
    if (typeof content !== 'string') return null;
    const match = SUB_PROGRESS_RE.exec(content);
    if (!match) return null;
    return { done: parseInt(match[1], 10), total: parseInt(match[2], 10) };
  }

  function computeOverallProgress(todos) {
    const list = Array.isArray(todos) ? todos : [];
    const done = list.filter(t => t && t.status === 'completed').length;
    return { done, total: list.length };
  }

  function isExpired(lastUpdateIso, nowMs = Date.now(), ttlMs = 20 * 60 * 1000) {
    const lastUpdateMs = Date.parse(lastUpdateIso);
    if (Number.isNaN(lastUpdateMs)) return true;
    return nowMs - lastUpdateMs > ttlMs;
  }

  // Separa as sessoes em tres grupos: ativas, ociosas (sem atividade ha mais do TTL
  // ou encerradas) e arquivadas. Arquivar e sempre uma acao explicita do usuario:
  // archivedMap guarda, por id, o last_update no momento do clique. Sessao com
  // atividade posterior volta sozinha para ativa. Ociosas e arquivadas vem das
  // mais recentes para as mais antigas.
  function partitionSessions(sessions, archivedMap, nowMs = Date.now(), ttlMs) {
    const marks = archivedMap || {};
    const out = { active: [], idle: [], archived: [] };
    Object.keys(sessions || {}).forEach(id => {
      const session = sessions[id];
      if (!session) return;
      const entry = { id, session };
      const mark = marks[id];
      const revived = mark !== undefined && Date.parse(session.last_update) > Date.parse(mark);
      if (mark !== undefined && !revived) out.archived.push(entry);
      else if (session.status === 'ended' || isExpired(session.last_update, nowMs, ttlMs)) out.idle.push(entry);
      else out.active.push(entry);
    });
    const byRecent = (a, b) => {
      const am = Date.parse(a.session.last_update);
      const bm = Date.parse(b.session.last_update);
      return (Number.isNaN(bm) ? -Infinity : bm) - (Number.isNaN(am) ? -Infinity : am);
    };
    out.idle.sort(byRecent);
    out.archived.sort(byRecent);
    return out;
  }

  return { formatElapsed, extractSubProgress, computeOverallProgress, isExpired, partitionSessions };
});
