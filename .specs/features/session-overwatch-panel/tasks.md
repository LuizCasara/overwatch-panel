# Session Overwatch Panel Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/session-overwatch-panel/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase + spec - confirm before Execute. Guidelines found: none (repositório novo, sem `AGENTS.md`/`CONTRIBUTING.md`/config de teste existente) - strong defaults aplicados. Runtime de teste escolhido: `node:test` nativo (Node 24 disponível no ambiente), zero dependências externas, consistente com AD-001 (`.specs/STATE.md`).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Handlers de evento e storage puro (`scripts/overwatch.js`) | unit | Todos os branches; 1:1 com OVW-01..OVW-11 e edge cases de parsing/lock/branch | `scripts/overwatch.test.js` | `node --test scripts/overwatch.test.js` |
| Merge de hooks/statusLine/config (`install.mjs`) | unit | Idempotência (rodar 2x não duplica), preservação de hooks de terceiros, geração correta de `panel-config.js` | `scripts/install.test.mjs` | `node --test scripts/install.test.mjs` |
| Funções puras de formatação do painel (`panel/format.js`) | unit | 1:1 com OVW-12, OVW-13; edge cases de regex e TTL | `panel/format.test.js` | `node --test panel/format.test.js` |
| Renderização DOM do painel (`panel/overwatch.html`, script inline) | none (sem harness de DOM configurado neste repo) | Verificação manual via Success Criteria / abrir o arquivo no navegador | - | build gate only |
| `scripts/statusline-wrapper.sh` (encadeamento de processos) | none | Sintaxe validada; comportamento verificado manualmente (roda 2 processos externos, não vale a pena mockar) | - | build gate only |
| Config/entidade (`package.json`, `.gitignore`, `README.md`) | none | - | - | build gate only |

**Coverage Expectation aplicada**: como não há guideline no repo, usamos o default forte do skill - lógica de domínio (handlers, merges, formatadores) cobre todo AC do spec + todo edge case listado; camadas sem lógica testável isoladamente (DOM, encadeamento de shell) ficam com `none` e são cobertas pelos Success Criteria da spec via verificação manual.

## Gate Check Commands

> Confirmar antes de Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Depois de tasks que só tocam `scripts/overwatch.js` | `node --test scripts/overwatch.test.js` |
| Full | Depois de tasks que tocam `install.mjs` ou `panel/format.js`, ou ao fechar uma fase | `node --test scripts/overwatch.test.js scripts/install.test.mjs panel/format.test.js` |
| Build | Fim de fase / tasks config-only / antes do Verifier | `node --check scripts/overwatch.js && node --check install.mjs && bash -n scripts/statusline-wrapper.sh && node --test scripts/overwatch.test.js scripts/install.test.mjs panel/format.test.js` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Storage core (`scripts/overwatch.js` - fundação)

Tasks, em ordem: T1, T2, T3, T4. (Ver arestas exatas no "Phase Execution Map" ao final - um único diagrama consolidado evita duplicar/divergir das dependências declaradas em cada task.)

### Phase 2: Handlers de evento (`scripts/overwatch.js` - lógica de negócio)

Tasks, em ordem: T5, T6, T7, T8, T9, T10, T11, T12.

### Phase 3: Entry point e abertura do navegador

Tasks, em ordem: T13, T14.

### Phase 4: Wrapper do statusLine

Tasks: T15.

### Phase 5: Instalador (`install.mjs`)

Tasks, em ordem: T16, T17, T18, T19.

### Phase 6: Painel (`panel/`)

Tasks: T20, T21 (independentes entre si), depois T22 (depende de ambos).

### Phase 7: Documentação e artefatos de repositório

Tasks: T23 (depende de T17, T18), T24 (depende de T19, T22).

---

## Task Breakdown

### T1: Criar `package.json` mínimo ✅ Done

**What**: Cria `package.json` na raiz com `name`, `private: true`, `version`, e `scripts.test` apontando para o comando Full do gate.
**Where**: `package.json`
**Depends on**: None
**Reuses**: nenhum
**Requirement**: N/A (infraestrutura de projeto)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `package.json` existe, JSON válido, sem `"type": "module"` (scripts/overwatch.js permanece CommonJS)
- [ ] `npm test` roda `node --test scripts/overwatch.test.js scripts/install.test.mjs panel/format.test.js` sem erro de "no test files" (arquivos ainda não existem nesta task - apenas o script é configurado)

**Tests**: none
**Gate**: build

---

### T2: `readStdinJson` + `logError` em `scripts/overwatch.js` ✅ Done

**What**: Cria `scripts/overwatch.js` com as duas funções de infraestrutura: `readStdinJson()` (lê fd 0 síncrono, `JSON.parse` com fallback `{}`, nunca lança) e `logError(event, message)` (append JSON-line em `~/.claude/overwatch-data/overwatch.log`, cria o diretório se faltar). Nenhum handler de evento ainda.
**Where**: `scripts/overwatch.js`
**Depends on**: T1
**Reuses**: esqueleto de `~/.claude/scripts/track-usage.js` (stdin síncrono, try/catch silencioso, log append-only)
**Requirement**: N/A (infraestrutura - suporta todos os OVW-01..11)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `readStdinJson` retorna `{}` (nunca lança) quando stdin não é JSON válido, e loga a falha via `logError`
- [ ] `logError` grava uma linha JSON válida em `overwatch.log`, criando `~/.claude/overwatch-data/` se não existir
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 4 testes passam (JSON válido, JSON inválido, stdin vazio, `logError` grava e é parseável de volta)

**Tests**: unit
**Gate**: quick

---

### T3: `loadSessions` + `writeSessionsFile` ✅ Done

**What**: Adiciona a `scripts/overwatch.js` as funções de (de)serialização do arquivo `sessions.js`: `loadSessions()` (lê `window.CLAUDE_SESSIONS = {...}`, extrai o objeto, retorna `{}` se ausente/corrompido) e `writeSessionsFile(sessions)` (serializa como `window.CLAUDE_SESSIONS = ${JSON.stringify(sessions, null, 2)};\n` via arquivo `.tmp` + `fs.renameSync` atômico).
**Where**: `scripts/overwatch.js`
**Depends on**: T2
**Reuses**: padrão tmp+rename de `~/.claude/scripts/track-usage.js:43-48`
**Requirement**: N/A (infraestrutura - suporta OVW-09)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `writeSessionsFile` seguido de `loadSessions` no mesmo diretório temporário de teste devolve o mesmo objeto (round-trip)
- [ ] `loadSessions` retorna `{}` para arquivo ausente e para arquivo com conteúdo corrompido (sem lançar)
- [ ] Escrita usa arquivo `.tmp` seguido de `rename` (verificável no teste checando que não sobra `.tmp` órfão após a escrita)
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 4 novos testes (total acumulado ≥ 8)

**Tests**: unit
**Gate**: quick

---

### T4: `withSessionsLock` ✅ Done

**What**: Adiciona `withSessionsLock(dataDir, mutateFn)`: adquire `sessions.js.lock` via `fs.openSync(path, 'wx')` com até 10 tentativas em backoff linear (50ms, 100ms, ..., 500ms), remove o lock se seu mtime for > 5000ms (órfão) antes de re-tentar, executa `mutateFn(loadSessions())`, grava via `writeSessionsFile`, libera o lock no `finally`.
**Where**: `scripts/overwatch.js`
**Depends on**: T3
**Reuses**: `loadSessions`/`writeSessionsFile` de T3
**Requirement**: OVW-09

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Duas chamadas "concorrentes" simuladas em sequência dentro do mesmo processo de teste (a segunda inicia com o lock da primeira ainda no disco) resultam em ambas as mutações aplicadas, nenhuma perdida (a segunda espera o lock liberar)
- [ ] Um arquivo `.lock` com mtime forçado para >5s no passado é removido automaticamente e a escrita prossegue sem esgotar as 10 tentativas
- [ ] O lock é sempre removido ao final (sucesso ou exceção dentro de `mutateFn`)
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 3 novos testes (total acumulado ≥ 11)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(overwatch): add file-locked read-modify-write for sessions.js`

---

### T5: `resolveBranch` ✅ Done

**What**: Adiciona `resolveBranch(cwd)`: roda `git rev-parse --abbrev-ref HEAD` síncrono com `cwd` e timeout curto (2000ms); retorna a branch em caso de sucesso, `null` em qualquer falha (não é repo git, timeout, `git` ausente), sem lançar.
**Where**: `scripts/overwatch.js`
**Depends on**: T4
**Reuses**: nenhum
**Requirement**: N/A (suporta o campo `branch` usado em OVW-01)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Chamado com o `cwd` deste próprio repositório (`claude-overwatch`, é um repo git) retorna a branch corrente como string
- [ ] Chamado com um diretório temporário que não é repo git retorna `null` sem lançar
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 2 novos testes (total acumulado ≥ 13)

**Tests**: unit
**Gate**: quick

---

### T6: `handleSessionStart` ✅ Done

**What**: Adiciona `handleSessionStart(sessions, payload)`: cria/sobrescreve `sessions[payload.session_id]` com `project` (basename de `payload.cwd`), `cwd`, `branch` (via `resolveBranch`), `started_at`/`last_update` (timestamp corrente ISO), `ended_at: null`, `context_pct: null`, `status: "running"`, `todos: []`, `summary: ""`.
**Where**: `scripts/overwatch.js`
**Depends on**: T5
**Reuses**: `resolveBranch` de T5
**Requirement**: OVW-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Payload válido de `SessionStart` produz uma entrada com todos os campos do schema `Session` presentes e corretos
- [ ] `project` é o basename correto de `cwd` em um path Windows (`C:\projects\foo` → `foo`)
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 2 novos testes (total acumulado ≥ 15)

**Tests**: unit
**Gate**: quick

---

### T7: `handlePrompt` ✅ Done

**What**: Adiciona `handlePrompt(sessions, payload)`: se `sessions[payload.session_id]` existir, atualiza `summary` (primeiros 80 caracteres de `payload.prompt`), `status: "running"`, `last_update`; se a sessão não existir ainda (hook `session-start` perdido/fora de ordem), cria uma entrada mínima primeiro (mesmo shape de T6, sem `branch` resolvido de novo se já vier depois) para não descartar o evento.
**Where**: `scripts/overwatch.js`
**Depends on**: T6
**Reuses**: `handleSessionStart` de T6 (fallback de criação)
**Requirement**: OVW-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `summary` é truncado para exatamente 80 caracteres quando o prompt é maior
- [ ] `status` vira `"running"` mesmo que a sessão estivesse `"idle"` ou `"waiting"` antes
- [ ] Evento `prompt` para um `session_id` inexistente cria a entrada em vez de ser descartado
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 3 novos testes (total acumulado ≥ 18)

**Tests**: unit
**Gate**: quick

---

### T8: `handleWaiting` ✅ Done

**What**: Adiciona `handleWaiting(sessions, payload)`: atualiza `status: "waiting"` e `last_update` na entrada de `payload.session_id`.
**Where**: `scripts/overwatch.js`
**Depends on**: T7
**Reuses**: nenhum
**Requirement**: OVW-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `status` vira `"waiting"` para uma sessão existente
- [ ] Chamado para `session_id` inexistente não lança (no-op seguro)
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 2 novos testes (total acumulado ≥ 20)

**Tests**: unit
**Gate**: quick

---

### T9: `handleIdle` ✅ Done

**What**: Adiciona `handleIdle(sessions, payload)`: atualiza `status: "idle"` e `last_update` na entrada de `payload.session_id`.
**Where**: `scripts/overwatch.js`
**Depends on**: T8
**Reuses**: nenhum
**Requirement**: OVW-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `status` vira `"idle"` para uma sessão existente
- [ ] Chamado para `session_id` inexistente não lança (no-op seguro)
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 2 novos testes (total acumulado ≥ 22)

**Tests**: unit
**Gate**: quick

---

### T10: `handleSessionEnd` ✅ Done

**What**: Adiciona `handleSessionEnd(sessions, payload)`: grava `ended_at` (timestamp corrente) e `status: "ended"` na entrada de `payload.session_id`. Também cobre o edge case: se um evento posterior chegar para o mesmo `session_id` já `ended` (via qualquer outro handler), o comportamento normal de cada handler já sobrescreve o estado (nenhuma trava especial necessária) - este task inclui um teste que comprova isso end-to-end entre `handleSessionEnd` e `handlePrompt`.
**Where**: `scripts/overwatch.js`
**Depends on**: T9
**Reuses**: nenhum
**Requirement**: OVW-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `ended_at` e `status: "ended"` gravados corretamente
- [ ] Uma chamada subsequente de `handlePrompt` sobre a mesma sessão `ended` limpa o estado `ended` de fato (`status` volta a `"running"`), confirmando a assumption de reabertura idempotente do spec
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 2 novos testes (total acumulado ≥ 24)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(overwatch): add lifecycle handlers for prompt/waiting/idle/session-end`

---

### T11: `handleStatusline` ✅ Done

**What**: Adiciona `handleStatusline(sessions, payload)`: calcula `context_pct` a partir de `payload.context_window.used_percentage` (arredondado para inteiro); só atualiza `sessions[payload.session_id].context_pct` e `last_update` se o valor calculado for diferente do valor já gravado (dedupe por valor, sem throttle de tempo). Se `payload.session_id` não existir na tabela ainda, ignora silenciosamente (sessão não iniciada por hook `session-start` correspondente é fora de escopo - ver Assumptions do spec sobre `session_id` no payload de `statusLine`).
**Where**: `scripts/overwatch.js`
**Depends on**: T10
**Reuses**: nenhum
**Requirement**: OVW-06, OVW-10

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `context_pct` é atualizado quando o valor calculado difere do gravado
- [ ] Uma segunda chamada com o mesmo valor de `used_percentage` NÃO altera `last_update` (dedupe funcionando - verificável comparando o timestamp antes/depois)
- [ ] Sessão recém-criada (via `handleSessionStart`) mantém `context_pct: null` até a primeira chamada de `handleStatusline`
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 3 novos testes (total acumulado ≥ 27)

**Tests**: unit
**Gate**: quick

---

### T12: `handleTodo` ✅ Done

**What**: Adiciona `handleTodo(sessions, payload)`: extrai `payload.tool_input.todos` (array de `{content, status}`) e grava em `sessions[payload.session_id].todos`, junto com `last_update`. Se `tool_input.todos` não for um array, grava `[]` (nunca lança, nunca deixa `todos` `undefined`).
**Where**: `scripts/overwatch.js`
**Depends on**: T11
**Reuses**: nenhum
**Requirement**: OVW-11

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `todos[]` gravado corretamente a partir de um payload real de `TodoWrite` (formato assumido na spec: `{content, status, activeForm?}` - campos extras como `activeForm` são preservados ou descartados sem quebrar)
- [ ] Payload malformado (`tool_input` ausente, ou `todos` não é array) resulta em `todos: []`, sem lançar
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 2 novos testes (total acumulado ≥ 29)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(overwatch): add statusline dedupe and todo handlers`

---

### T13: Dispatch principal (`main`) de `scripts/overwatch.js` ✅ Done

**What**: Adiciona o bloco executável de `scripts/overwatch.js`: lê `process.argv[2]` (sub-evento), chama `readStdinJson()`, dentro de `withSessionsLock(dataDir, sessions => { ...chama o handler certo... })`, mapeando `session-start→handleSessionStart`, `prompt→handlePrompt`, `todo→handleTodo`, `waiting→handleWaiting`, `idle→handleIdle`, `session-end→handleSessionEnd`, `statusline→handleStatusline`. Sub-evento desconhecido: no-op silencioso. Todo o bloco top-level envolvido em try/catch que chama `logError` e sempre `process.exit(0)` (nunca propaga exceção, nunca sai com código != 0).
**Where**: `scripts/overwatch.js`
**Depends on**: T12
**Reuses**: todos os handlers de T6-T12, `withSessionsLock` de T4
**Requirement**: N/A (fiação entre os hooks reais e os handlers já testados)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Rodar `echo '<payload válido>' | node scripts/overwatch.js session-start` (via `child_process.execSync` dentro do teste, apontando `HOME`/`USERPROFILE` para um diretório temporário) grava a sessão em um `sessions.js` temporário e sai com código 0
- [ ] Rodar com um sub-evento desconhecido ou payload vazio sai com código 0 sem gravar nada de inesperado
- [ ] Rodar com stdin vazio/JSON inválido sai com código 0 (nunca lança, nunca propaga para o processo pai do hook)
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 3 novos testes de integração leve via `execSync` (total acumulado ≥ 32)

**Tests**: unit (tratado como camada de domínio no matrix - dispatch é lógica pura de roteamento, testável via subprocess real por ser o único ponto de entrada CLI)
**Gate**: quick

---

### T14: `isAnyOtherSessionActive` + `openPanelIfFirstSession` ✅ Done (com SPEC_DEVIATION - ver commit)

**What**: Adiciona `isAnyOtherSessionActive(sessions, selfId)` (verdadeiro se existir outra entrada com `status !== "ended"` e `last_update` há menos de 20 minutos) e `openPanelIfFirstSession(sessions, selfId, panelPath)` (se `isAnyOtherSessionActive` for falso, dispara `child_process.exec('start "" "<panelPath>"')` best-effort, sem esperar nem lançar em caso de falha). `handleSessionStart` (T6) passa a chamar `openPanelIfFirstSession` depois de gravar a nova entrada.
**Where**: `scripts/overwatch.js`
**Depends on**: T13
**Reuses**: nenhum
**Requirement**: OVW-18, OVW-19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `isAnyOtherSessionActive` retorna `false` quando a tabela só tem a própria sessão, ou quando as demais estão `ended`/expiradas (`last_update` > 20min)
- [ ] `isAnyOtherSessionActive` retorna `true` quando existe outra sessão `running`/`waiting`/`idle` com `last_update` recente
- [ ] `openPanelIfFirstSession` NÃO dispara `child_process.exec` quando `isAnyOtherSessionActive` é verdadeiro (verificável espionando a chamada em teste, sem realmente abrir um navegador)
- [ ] Gate check passes: `node --test scripts/overwatch.test.js`
- [ ] Test count: pelo menos 3 novos testes (total acumulado ≥ 35)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(overwatch): wire main dispatch and first-session browser auto-open`

---

### T15: `scripts/statusline-wrapper.sh` ✅ Done

**What**: Cria o wrapper: lê stdin uma vez (`input=$(cat)`), repassa para `node "<repoRoot>/scripts/overwatch.js" statusline` via echo (ignorando falhas com `|| true`), depois repassa o mesmo `$input` para o comando salvo em `scripts/statusline-original-command.txt` (se o arquivo existir; senão cai de volta para `bash ~/.claude/statusline-command.sh` como default), imprimindo a saída dele sem alteração.
**Where**: `scripts/statusline-wrapper.sh`
**Depends on**: T14
**Reuses**: nenhum
**Requirement**: OVW-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `bash -n scripts/statusline-wrapper.sh` valida a sintaxe sem erro
- [ ] Rodar manualmente `echo '<payload de exemplo>' | bash scripts/statusline-wrapper.sh` (verificação manual, documentada no corpo do commit) produz a mesma saída visual que `bash ~/.claude/statusline-command.sh` produzia direto, e grava `context_pct` no `sessions.js` real (validação ponta a ponta antes de tocar o `settings.json` do usuário)
- [ ] Gate check passes: `bash -n scripts/statusline-wrapper.sh`

**Tests**: none (camada sem lógica testável isoladamente - ver Test Coverage Matrix)
**Gate**: build

---

### T16: `mergeHooks(settings, repoRoot)` ✅ Done

**What**: Cria `scripts/install-lib.js` (ou seção de `install.mjs` exportável para teste) com `mergeHooks(settings, repoRoot)`: para cada evento da tabela de hooks da spec (`SessionStart`, `UserPromptSubmit`, `PostToolUse`/`TodoWrite`, `PreToolUse`/`AskUserQuestion|ExitPlanMode`, `Stop`, `SessionEnd`), garante um grupo `{matcher?, hooks: [{type: "command", command: "node \"<repoRoot>/scripts/overwatch.js\" <sub-evento>", async: true}]}` presente no array daquele evento em `settings.hooks`, sem duplicar (idempotência por `command` exato) e sem remover grupos pré-existentes de outras ferramentas.
**Where**: `scripts/install-lib.js`
**Depends on**: T1
**Reuses**: formato de hook já em uso em `~/.claude/settings.json` (array de grupos `{matcher?, hooks:[...]}`, campo `async: true`)
**Requirement**: OVW-15, OVW-16

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Aplicado sobre um objeto `settings` vazio (`{}`), produz todos os 6 grupos de hook esperados
- [ ] Aplicado sobre um `settings.hooks` que já tem grupos de outras ferramentas (fixture inspirada em `~/.claude/settings.json` real: `SubagentStart`/track-usage, `PostToolUse`/Skill, `Stop`/notify-stop.ps1) preserva esses grupos intactos e adiciona os do overwatch como novos itens do array
- [ ] Aplicado duas vezes em sequência sobre o mesmo objeto produz o mesmo resultado da primeira vez (sem duplicar grupos)
- [ ] Gate check passes: `node --test scripts/install.test.mjs`
- [ ] Test count: pelo menos 3 testes

**Tests**: unit
**Gate**: full

---

### T17: `mergeStatusLine(settings, repoRoot)` ✅ Done

**What**: Adiciona `mergeStatusLine(settings, repoRoot)` a `scripts/install-lib.js`: se `settings.statusLine.command` não referenciar `statusline-wrapper.sh` deste repo, grava o comando atual em `scripts/statusline-original-command.txt` (só se esse arquivo ainda não existir - nunca sobrescreve um original já salvo) e substitui `settings.statusLine` por `{type: "command", command: "bash \"<repoRoot>/scripts/statusline-wrapper.sh\""}`. Se já apontar para o wrapper, é no-op.
**Where**: `scripts/install-lib.js`
**Depends on**: T16
**Reuses**: nenhum
**Requirement**: OVW-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Aplicado sobre `settings.statusLine = {command: "bash ~/.claude/statusline-command.sh"}` grava esse comando em `statusline-original-command.txt` e substitui `settings.statusLine.command` pelo wrapper
- [ ] Aplicado uma segunda vez (idempotência) não sobrescreve `statusline-original-command.txt` e mantém `settings.statusLine` apontando para o wrapper
- [ ] Aplicado sobre `settings` sem `statusLine` nenhum (usuário nunca configurou) ainda assim configura o wrapper corretamente, sem lançar
- [ ] Gate check passes: `node --test scripts/install.test.mjs`
- [ ] Test count: pelo menos 3 novos testes (total acumulado ≥ 6)

**Tests**: unit
**Gate**: full

---

### T18: `writePanelConfig(repoRoot, homeDir)` ✅ Done

**What**: Adiciona `writePanelConfig(repoRoot, homeDir)` a `scripts/install-lib.js`: escreve `panel/panel-config.js` com `window.OVERWATCH_DATA_URL = "file:///<homeDir>/.claude/overwatch-data/sessions.js"` (barras normalizadas para URL de arquivo válida no Windows), via tmp+rename atômico.
**Where**: `scripts/install-lib.js`
**Depends on**: T17
**Reuses**: padrão tmp+rename já usado em T3
**Requirement**: N/A (suporta a descoberta de caminho do painel, pré-requisito de OVW-07/OVW-08)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `panel/panel-config.js` gerado em um diretório temporário de teste contém uma URL `file:///` válida e sem barras invertidas cruas
- [ ] Rodar duas vezes sobre `homeDir` diferentes atualiza o conteúdo para o novo caminho (não é write-once)
- [ ] Gate check passes: `node --test scripts/install.test.mjs`
- [ ] Test count: pelo menos 2 novos testes (total acumulado ≥ 8)

**Tests**: unit
**Gate**: full

---

### T19: CLI `install.mjs` ✅ Done

**What**: Cria `install.mjs`: lê `~/.claude/settings.json` real (cria `{}` se não existir), aplica `mergeHooks` → `mergeStatusLine` → grava o `settings.json` atualizado via tmp+rename, chama `writePanelConfig`, imprime um resumo legível no stdout (quais hooks foram adicionados/já existiam).
**Where**: `install.mjs`
**Depends on**: T18
**Reuses**: `mergeHooks`, `mergeStatusLine`, `writePanelConfig` de T16-T18
**Requirement**: OVW-15

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Rodar `node install.mjs` com `HOME`/`USERPROFILE` apontado (via variável de ambiente no teste) para um diretório temporário sem `settings.json` cria o arquivo com os hooks corretos e `panel/panel-config.js` gerado
- [ ] Rodar `node install.mjs` uma segunda vez sobre o mesmo diretório temporário não duplica nada (diff do `settings.json` entre as duas rodadas é vazio, exceto se o `panel-config.js` mudar de caminho)
- [ ] Gate check passes: `node --test scripts/install.test.mjs`
- [ ] Test count: pelo menos 2 novos testes de integração leve (total acumulado ≥ 10)

**Tests**: integration
**Gate**: full

**Commit**: `feat(install): add idempotent hook merge and panel config generation`

---

### T20: `panel/format.js` ✅ Done

**What**: Cria `panel/format.js` com funções puras, expostas via padrão UMD simples (`module.exports` no Node, `window.OverwatchFormat` no browser): `formatElapsed(startedAtIso, nowMs)` (string tipo "12min", "1h 04min"), `extractSubProgress(content)` (retorna `{done, total} | null` a partir do regex `(\d+)\s*\/\s*(\d+)`), `computeOverallProgress(todos)` (retorna `{done, total}` contando `status === "completed"`), `isExpired(lastUpdateIso, nowMs, ttlMs = 20*60*1000)` (booleano).
**Where**: `panel/format.js`
**Depends on**: None
**Reuses**: nenhum
**Requirement**: OVW-12, OVW-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `extractSubProgress("Revisar as 12 seções (3/12)")` retorna `{done: 3, total: 12}`; `extractSubProgress("sem sub-progresso")` retorna `null`
- [ ] `computeOverallProgress` conta corretamente `completed` sobre o total, incluindo lista vazia (`{done: 0, total: 0}`)
- [ ] `isExpired` retorna `true` para `lastUpdate` 21 minutos atrás e `false` para 19 minutos atrás (limite dos 20min testado nos dois lados)
- [ ] O mesmo arquivo é `require`-ável no Node (teste) sem lançar por causa de `window` não existir
- [ ] Gate check passes: `node --test panel/format.test.js`
- [ ] Test count: pelo menos 6 testes

**Tests**: unit
**Gate**: full

---

### T21: Estrutura e estilo de `panel/overwatch.html` ✅ Done

**What**: Cria `panel/overwatch.html` com a estrutura HTML e CSS do HUD (fundo quase preto, cards em vidro fosco com glow, fonte `Space Mono` com fallback `monospace`, grid de cards, legenda de status como indicadores geométricos com glow, seção "arquivadas" esmaecida no rodapé). Sem lógica de dados ainda - conteúdo placeholder estático para validar visualmente o estilo isoladamente.
**Where**: `panel/overwatch.html`
**Depends on**: None
**Reuses**: direção visual do God's Eye View (só estilo, sem código)
**Requirement**: N/A (estilo visual, pré-requisito de OVW-07/OVW-08 conforme seção 9 do design-spec)

**Tools**:
- MCP: NONE
- Skill: `interface-design` ou `frontend-design` a critério de quem executa (ver pergunta de Tools ao usuário abaixo)

**Done when**:
- [ ] Abrir `panel/overwatch.html` diretamente no navegador (`file://`) renderiza o HUD dark com pelo menos um card placeholder e a legenda de status, sem erro no console
- [ ] Layout não quebra em largura de janela estreita (~400px), consistente com a diretriz de responsividade do próprio ambiente de design

**Tests**: none
**Gate**: build

---

### T22: Lógica de dados de `panel/overwatch.html` ✅ Done

**What**: Adiciona a `panel/overwatch.html` o `<script>` inline que: carrega `panel-config.js` (com fallback de mensagem "rode `node install.mjs`" se `window.OVERWATCH_DATA_URL` estiver indefinido), implementa `reloadSessionsScript()` (injeta `<script src="{OVERWATCH_DATA_URL}?t={Date.now()}">` a cada 30s, sem reload de página), `render(sessions)` (separa ativas vs. arquivadas usando `isExpired` de `panel/format.js`), `renderCard`, `renderTodoItem` (usa `extractSubProgress`/`computeOverallProgress`), e trata `sessions.js` ausente/corrompido como lista vazia.
**Where**: `panel/overwatch.html`
**Depends on**: T20, T21
**Reuses**: `panel/format.js` de T20
**Requirement**: OVW-07, OVW-08, OVW-10, OVW-12, OVW-13, OVW-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Verificação manual: com um `sessions.js` de exemplo escrito à mão em `~/.claude/overwatch-data/`, abrir o painel mostra o card correto (projeto/branch/resumo/tempo/contexto/status) dentro de 30s de uma edição manual do arquivo
- [ ] Verificação manual: sessão com `context_pct: null` mostra "—", nunca "0%"
- [ ] Verificação manual: sessão com `last_update` forçado para >20min atrás aparece no grupo "arquivadas"
- [ ] Verificação manual: `todos` ausente/vazio não gera erro no console, card renderiza sem a seção de tarefas
- [ ] Verificação manual: sem `panel-config.js` (renomeado temporariamente), o painel mostra a instrução de rodar `install.mjs` em vez de tela em branco
- [ ] Gate check passes: `node --check` não se aplica a HTML; gate é a checklist manual acima, documentada no corpo do commit

**Tests**: none (ver Test Coverage Matrix - camada de DOM sem harness neste repo)
**Gate**: build

**Commit**: `feat(panel): render session cards with live 30s reload`

---

### T23: `.gitignore` ✅ Done

**What**: Cria `.gitignore` cobrindo os artefatos gerados por `install.mjs` que não devem ser versionados: `panel/panel-config.js`, `scripts/statusline-original-command.txt`.
**Where**: `.gitignore`
**Depends on**: T17, T18
**Reuses**: nenhum
**Requirement**: N/A

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `git status` depois de rodar `node install.mjs` localmente não lista `panel/panel-config.js` nem `scripts/statusline-original-command.txt` como untracked

**Tests**: none
**Gate**: build

---

### T24: Atualizar `README.md`

**What**: Atualiza `README.md`: seção "Status" passa de "Em implementação" para refletir o que está pronto, adiciona seção "Testes" com o comando `npm test`, mantém as instruções de instalação/reinstalação já corretas.
**Where**: `README.md`
**Depends on**: T19, T22
**Reuses**: conteúdo já existente do README
**Requirement**: N/A

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] README reflete o estado real pós-implementação (sem prometer nada que não foi implementado)
- [ ] Seção de testes documentada com o comando real

**Tests**: none
**Gate**: build

**Commit**: `docs: update README with test instructions and implementation status`

---

## Phase Execution Map

Um único diagrama consolidado, com uma aresta por dependência real declarada em cada task (nenhuma aresta "de ordem de leitura" que não seja uma dependência de fato - inclusive as duas dependências de T22, T23 e T24 aparecem cada uma como sua própria seta):

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15
T1 → T16 → T17 → T18 → T19
T17 → T23
T18 → T23
T20 → T22
T21 → T22
T19 → T24
T22 → T24
```

Leitura por fase (a ordem de execução real é sequencial por fase, mesmo onde a dependência formal é mais fraca - ex.: T16 só depende formalmente de T1, mas roda depois de T15 porque as fases rodam em sequência):

```
Phase 1: T1, T2, T3, T4
Phase 2: T5, T6, T7, T8, T9, T10, T11, T12
Phase 3: T13, T14
Phase 4: T15
Phase 5: T16, T17, T18, T19
Phase 6: T20, T21, T22
Phase 7: T23, T24
```

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

**Packing note (informativo, decisão real acontece em Execute):** 24 tasks totais, budget ~7/worker. Fase 2 (8 tasks) fica levemente acima do budget mas é uma cadeia de dependência única sobre o mesmo arquivo que não vale a pena partir. Empacotamento sugerido: Batch1 = Fase1 (4); Batch2 = Fase2 (8); Batch3 = Fase3+Fase4+Fase5 (2+1+4=7); Batch4 = Fase6+Fase7 (3+2=5). Como o total excede ~8 tasks, a oferta de sub-agentes deve ser feita ao usuário no início de Execute.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: package.json | 1 arquivo de config | ✅ Granular |
| T2: readStdinJson + logError | 2 funções de infraestrutura coesas, mesmo arquivo | ✅ Granular |
| T3: loadSessions + writeSessionsFile | 2 funções coesas (par leitura/escrita do mesmo formato) | ✅ Granular |
| T4: withSessionsLock | 1 função | ✅ Granular |
| T5: resolveBranch | 1 função | ✅ Granular |
| T6: handleSessionStart | 1 função | ✅ Granular |
| T7: handlePrompt | 1 função | ✅ Granular |
| T8: handleWaiting | 1 função | ✅ Granular |
| T9: handleIdle | 1 função | ✅ Granular |
| T10: handleSessionEnd | 1 função | ✅ Granular |
| T11: handleStatusline | 1 função | ✅ Granular |
| T12: handleTodo | 1 função | ✅ Granular |
| T13: main dispatch | 1 bloco de roteamento, 1 arquivo | ✅ Granular |
| T14: isAnyOtherSessionActive + openPanelIfFirstSession | 2 funções coesas (uma só existe para a outra) | ✅ Granular |
| T15: statusline-wrapper.sh | 1 arquivo | ✅ Granular |
| T16: mergeHooks | 1 função | ✅ Granular |
| T17: mergeStatusLine | 1 função | ✅ Granular |
| T18: writePanelConfig | 1 função | ✅ Granular |
| T19: install.mjs CLI | 1 arquivo, fiação das 3 funções já testadas | ✅ Granular |
| T20: panel/format.js | 4 funções puras coesas (mesmo arquivo utilitário) | ✅ Granular |
| T21: HTML/CSS do painel | 1 arquivo, sem lógica ainda | ✅ Granular |
| T22: JS de dados do painel | 1 arquivo (modifica T21), lógica de render coesa | ✅ Granular |
| T23: .gitignore | 1 arquivo | ✅ Granular |
| T24: README.md | 1 arquivo | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | (sem seta de entrada) | ✅ Match |
| T2 | T1 | T1→T2 | ✅ Match |
| T3 | T2 | T2→T3 | ✅ Match |
| T4 | T3 | T3→T4 | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | T5 | T5→T6 | ✅ Match |
| T7 | T6 | T6→T7 | ✅ Match |
| T8 | T7 | T7→T8 | ✅ Match |
| T9 | T8 | T8→T9 | ✅ Match |
| T10 | T9 | T9→T10 | ✅ Match |
| T11 | T10 | T10→T11 | ✅ Match |
| T12 | T11 | T11→T12 | ✅ Match |
| T13 | T12 | T12→T13 | ✅ Match |
| T14 | T13 | T13→T14 | ✅ Match |
| T15 | T14 | T14→T15 | ✅ Match |
| T16 | T1 | T1→T16 | ✅ Match |
| T17 | T16 | T16→T17 | ✅ Match |
| T18 | T17 | T17→T18 | ✅ Match |
| T19 | T18 | T18→T19 | ✅ Match |
| T20 | None | (sem seta de entrada) | ✅ Match |
| T21 | None | (sem seta de entrada) | ✅ Match |
| T22 | T20, T21 | T20→T22, T21→T22 | ✅ Match |
| T23 | T17, T18 | T17→T23, T18→T23 | ✅ Match |
| T24 | T19, T22 | T19→T24, T22→T24 | ✅ Match |

Toda seta do diagrama consolidado ("Phase Execution Map") corresponde a exatamente um `Depends on` declarado, e vice-versa - nenhuma seta "de ordem de leitura" sem dependência real por trás. Nenhuma task depende de uma task de fase posterior (checado linha a linha acima e pela leitura por fase, que é estritamente sequencial Phase 1→7).

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: package.json | Config | none | none | ✅ OK |
| T2: readStdinJson + logError | Handlers/storage puro | unit | unit | ✅ OK |
| T3: loadSessions + writeSessionsFile | Handlers/storage puro | unit | unit | ✅ OK |
| T4: withSessionsLock | Handlers/storage puro | unit | unit | ✅ OK |
| T5: resolveBranch | Handlers/storage puro | unit | unit | ✅ OK |
| T6: handleSessionStart | Handlers/storage puro | unit | unit | ✅ OK |
| T7: handlePrompt | Handlers/storage puro | unit | unit | ✅ OK |
| T8: handleWaiting | Handlers/storage puro | unit | unit | ✅ OK |
| T9: handleIdle | Handlers/storage puro | unit | unit | ✅ OK |
| T10: handleSessionEnd | Handlers/storage puro | unit | unit | ✅ OK |
| T11: handleStatusline | Handlers/storage puro | unit | unit | ✅ OK |
| T12: handleTodo | Handlers/storage puro | unit | unit | ✅ OK |
| T13: main dispatch | Handlers/storage puro (CLI entrypoint) | unit | unit | ✅ OK |
| T14: isAnyOtherSessionActive + openPanelIfFirstSession | Handlers/storage puro | unit | unit | ✅ OK |
| T15: statusline-wrapper.sh | Wrapper de shell | none | none | ✅ OK |
| T16: mergeHooks | install.mjs | unit | unit | ✅ OK |
| T17: mergeStatusLine | install.mjs | unit | unit | ✅ OK |
| T18: writePanelConfig | install.mjs | unit | unit | ✅ OK |
| T19: install.mjs CLI | install.mjs | unit (integration aceito como camada mais alta do mesmo requisito) | integration | ✅ OK |
| T20: panel/format.js | Funções puras do painel | unit | unit | ✅ OK |
| T21: HTML/CSS do painel | Renderização DOM | none | none | ✅ OK |
| T22: JS de dados do painel | Renderização DOM | none | none | ✅ OK |
| T23: .gitignore | Config | none | none | ✅ OK |
| T24: README.md | Config | none | none | ✅ OK |

Nenhuma violação. Nenhum caso de "tested in another task" usado como justificativa de `Tests: none` - todo `none` corresponde a uma camada que o matrix já classifica como `none` (config, shell wrapper, DOM sem harness).

---

## Tools per Task - pergunta ao usuário

Antes de iniciar Execute, falta confirmar com o usuário (ver pergunta ao final desta fase, já que ele está indisponível no momento: registrado como decisão pendente, default aplicado se ele não responder a tempo):

> Para T21 (estrutura/estilo do painel HUD), há duas skills de design de interface instaladas (`interface-design`, `frontend-design`/`ui-ux-pro-max`). Nenhuma foi invocada nesta fase de Tasks porque a convenção do skill `tlc-spec-driven` é perguntar isso apenas na fronteira com Execute. Default aplicado na ausência de resposta: usar `interface-design:interface-design` (é o mais alinhado com "dashboard/painel" segundo sua própria descrição), sem bloquear o início de Execute.

Todas as demais tasks usam `NONE` para MCP e Skill (lógica pura de Node/shell, sem necessidade de ferramentas externas).
