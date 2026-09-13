# STATE

## Decisions

### AD-001
- **Decision**: Todo hook Node deste projeto (`scripts/overwatch.js` e futuros) segue o esqueleto de `~/.claude/scripts/track-usage.js`: stdin lido de forma síncrona via fd 0, `JSON.parse` em try/catch que nunca lança, escrita via arquivo `.tmp` + `fs.renameSync` atômico, log de erro append-only em vez de exceção, zero dependências externas.
- **Reason**: É o único padrão já validado em produção neste ambiente Claude Code para hooks Node; reaproveitá-lo evita reintroduzir os mesmos bugs de concorrência/robustez que esse padrão já resolveu, e mantém todos os scripts de hook auditáveis do mesmo jeito.
- **Trade-off**: Sem framework/lib (ex.: parsing mais rico, validação de schema) — cada script reimplementa o mínimo à mão em troca de zero instalação e zero superfície de dependência quebrando um hook crítico.
- **Scope**: Todos os scripts Node invocados como hook em `~/.claude/settings.json` neste ambiente, atuais e futuros.
- **Date**: 2026-09-13
- **Status**: active

## Handoff

- **Feature**: session-overwatch-panel (`.specs/features/session-overwatch-panel/`) — **CONCLUÍDA**. Specify → Design → Tasks (24) → Execute → Verifier (2 iterações) todos completos. `validate_state.py session-overwatch-panel` retorna exit 0.
- **Completed**: Spec (0 erros/warnings), Design (AD-001 registrada), 24 tasks implementadas com TDD e commitadas (uma por commit), Verifier iteração 1 (FAIL, 2 gaps Minor de cobertura de teste, nenhum bug de produção), fix no commit `ae7a073`, Verifier iteração 2 (PASS ✅ — 19/19 ACs, 59/59 testes, 3/3 mutações do sensor de discriminação mortas). Relatório em `.specs/features/session-overwatch-panel/validation.md`. 4 lições candidatas registradas em `.specs/lessons.json` (ainda não confirmadas — sinal de uma feature só).
- **In-progress**: nada — feature encerrada do lado da implementação. Único item pendente é uma decisão do usuário (ver Next step).
- **Next step**: Perguntar ao usuário se autoriza rodar `node install.mjs` contra o `~/.claude/settings.json` REAL dele (nunca rodado contra o ambiente real nesta sessão — só contra `HOME`/`USERPROFILE` temporários em testes). É uma ação de configuração global do sistema, fora do escopo de "implementação local" já autorizado, então requer aprovação explícita antes de rodar. Depois disso, oferecer para rodar `git push` se ele quiser levar a branch para um remoto (também não feito, mesma razão).
- **Blockers**: none — implementação e verificação 100% completas; só falta a decisão de instalação real do usuário.
- **Uncommitted files**: nenhum — árvore de trabalho limpa (`git status --porcelain` vazio, exceto artefatos gerados por teste já cobertos pelo `.gitignore`: `panel/panel-config.js`, possivelmente `scripts/statusline-original-command.txt`).
- **Branch**: master (24+ commits atômicos desde `bf94034`, nenhum push feito)
