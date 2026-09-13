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
- **Phase / Task**: Execute concluído — todas as 24 tasks (T1-T24) implementadas, testadas (57 testes `node --test`, todos passando) e commitadas, uma por commit atômico. Verifier independente despachado como sub-agente em background após a última task (T24); aguardando o veredito (PASS/FAIL) dele antes de considerar a feature encerrada.
- **Completed**: Specify, Design (AD-001 registrada), Tasks (24 tasks validadas por `validate_tasks.py`, 0 erros), Execute (Fases 1-7 completas: storage core, handlers de evento, dispatch CLI, statusline wrapper, install.mjs, painel HTML, docs). `node install.mjs` foi testado extensivamente via subprocessos com `HOME`/`USERPROFILE` isolados, mas **nunca rodado contra o `~/.claude/settings.json` real do usuário** — decisão deliberada, pendente de aprovação explícita dele (é uma mudança de configuração global do sistema).
- **In-progress**: Verifier sub-agent rodando em background (dispatched nesta sessão) — vai escrever `.specs/features/session-overwatch-panel/validation.md` e devolver PASS/FAIL. Se FAIL, rotear os gaps ranqueados como fix tasks (máx. 3 iterações fix→re-verify) antes de considerar a feature pronta.
- **Next step**: 1) Ler o veredito do Verifier quando a notificação chegar. 2) Se PASS: reportar ao usuário que a feature está pronta e perguntar se ele autoriza rodar `node install.mjs` contra o ambiente real (ação que modifica `~/.claude/settings.json` de verdade — requer aprovação explícita, não coberta pela autorização de "implementação local"). 3) Se FAIL: criar fix tasks a partir dos gaps ranqueados, implementar, re-despachar o Verifier.
- **Blockers**: none — usuário autorizou avançar sem checkpoint síncrono ("faça o máximo que puder sem validação minha, amanhã cedo vejo e respondo"), mas a instalação real (`node install.mjs` contra o settings.json de verdade) fica fora dessa autorização por afetar configuração global do sistema.
- **Uncommitted files**: nenhum arquivo de código-fonte pendente — todas as 24 tasks foram commitadas. `panel/panel-config.js` e `scripts/statusline-original-command.txt` existem no disco como efeito colateral de testes (HOME temporário) mas estão no `.gitignore` desde T23, então não aparecem como untracked relevante.
- **Branch**: master
