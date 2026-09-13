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

- **Feature**: session-overwatch-panel (`.specs/features/session-overwatch-panel/`)
- **Phase / Task**: Design concluído (`design.md` escrito); Tasks ainda não iniciada
- **Completed**: Specify (spec.md validado, 0 erros/0 warnings), Design (design.md escrito, AD-001 registrada)
- **In-progress**: nenhuma edição de código ainda — próxima ação é rodar a fase Tasks
- **Next step**: Ler `references/tasks.md` do skill e quebrar `design.md` em tasks atômicas com testes e gate, depois rodar `validate_tasks.py`
- **Blockers**: none — usuário autorizou avançar sem checkpoint síncrono ("faça o máximo que puder sem validação minha")
- **Uncommitted files**: `.specs/features/session-overwatch-panel/spec.md`, `.specs/features/session-overwatch-panel/design.md`, `.specs/STATE.md` (nenhum commit feito ainda nesta feature — nada de código fonte criado ainda)
- **Branch**: master
