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

  return { formatElapsed, extractSubProgress, computeOverallProgress, isExpired };
});
