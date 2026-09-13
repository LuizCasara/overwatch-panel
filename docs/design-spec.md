# claude-overwatch — Spec de Design

Data: 2026-09-12
Status: aprovado para implementação (MVP)

## 1. Problema

Ao pedir uma tarefa grande para o Claude Code (ex.: uma spec com 30+ tarefas),
o chat mostra comandos e chamadas de ferramenta em sequência, mas não dá uma
noção precisa e rápida de **em qual etapa, de quantas, o Claude está agora** —
nem, quando há vários chats abertos em paralelo, qual sessão está em qual
estado sem abrir cada terminal.

## 2. Objetivo do MVP

Um painel HTML local, aberto no navegador, que mostra **todas as sessões
ativas do Claude Code na máquina**, cada uma como um card com: projeto,
branch, resumo do pedido, tempo aberto, % de janela de contexto usada, status
geral (rodando / aguardando você / ocioso / erro) e a lista de tarefas
(todos) com progresso.

Escopo global (todos os projetos, não só o site-casara) — configurado uma vez
via hooks em `~/.claude/settings.json`, portátil via este repositório.

**Fora de escopo do MVP** (candidatos a evolução futura, não implementar
agora): filtros, ordenação, interações além de expandir/colapsar um card,
acesso remoto/outro dispositivo, histórico persistente entre reinicializações
do Windows.

## 3. Por que hooks, e não o Claude escrevendo o arquivo

Duas formas possíveis de manter o painel atualizado:

- **Claude escreve o status a cada passo** (via `Write`/`Edit`): custa tokens
  e tempo de raciocínio a cada atualização, e depende do Claude "lembrar" de
  fazer isso.
- **Hooks (scripts determinísticos) reagem a eventos do Claude Code**: custo
  zero de token, instantâneo, nunca esquece.

Optamos por hooks para tudo que é observável estruturalmente (lista de todos,
início/fim de sessão, perguntas ao usuário). A única exceção — o
sub-progresso de uma tarefa que se desdobra em N repetições — não tem hook
correspondente confirmado nesta versão do Claude Code, então depende de uma
convenção que o próprio Claude segue (ver seção 7). É a única parte do
sistema que não é 100% determinística.

## 4. Arquitetura

```
┌──────────────┐   PostToolUse/PreToolUse/Stop/SessionStart/SessionEnd/statusLine
│ Claude Code   │ ──────────────────────────────────────────────────┐
│ (N sessões)   │                                                    │
└──────────────┘                                                    ▼
                                                        ┌─────────────────────┐
                                                        │ scripts/overwatch.js │
                                                        │ (Node, sem deps)     │
                                                        └─────────────────────┘
                                                                    │
                                                     lê/mescla/grava (lock+atomic rename)
                                                                    ▼
                                              ~/.claude/overwatch-data/sessions.js
                                              (window.CLAUDE_SESSIONS = {...})
                                                                    │
                                                     <script src="sessions.js?t=">
                                                     recarregada a cada 30s
                                                                    ▼
                                                       panel/overwatch.html
                                                       (aberto no navegador,
                                                        arquivo local, sem servidor)
```

## 5. Componentes

### `scripts/overwatch.js`
Script Node único (mesmo espírito de `track-usage.js`, que já existe em
`~/.claude/scripts/`). Recebe o payload do hook via stdin e o tipo de evento
como `process.argv[2]`. Never lança erro que quebre o hook — qualquer falha
de parsing é engolida e logada, igual ao padrão já usado em
`track-usage.js`.

Eventos tratados: `session-start`, `prompt`, `todo`, `waiting`, `idle`,
`session-end`, `statusline`.

### `~/.claude/overwatch-data/sessions.js`
Arquivo de estado compartilhado, fora do repositório (é dado, não código).
Formato: `window.CLAUDE_SESSIONS = { "<session_id>": { ... } };` — `.js` e
não `.json` de propósito: o painel carrega via `<script src="...">`, que
funciona em `file://` sem restrição de CORS (diferente de `fetch`/`XHR`, que
o Chrome bloqueia para arquivos locais).

Escrita: read-modify-write com lock (arquivo `.lock` ao lado, retry com
backoff curto) + escreve em `.tmp` e `rename` atômico — protege contra duas
sessões escrevendo ao mesmo tempo. Colisão real é rara (a escrita acontece a
cada mudança de todo/prompt, não a cada milissegundo).

Esquema por sessão:
```js
{
  session_id: "abc123",
  project: "site-casara",       // basename do cwd
  cwd: "c:\\projects\\site\\site-casara",
  branch: "feat/ingress-stats-ranking",
  summary: "quero criar uma interface pra acompanhar...", // 80 primeiros chars do prompt
  started_at: "2026-09-12T14:03:00Z",
  last_update: "2026-09-12T14:22:10Z",
  ended_at: null,               // preenchido pelo hook session-end
  context_pct: 34,              // do hook statusline
  status: "running",            // running | waiting | idle | error | ended
  todos: [
    { content: "Ler o brief", status: "completed" },
    { content: "Revisar as 12 seções do relatório (3/12)", status: "in_progress" },
    { content: "Escrever resumo final", status: "pending" }
  ]
}
```

### `panel/overwatch.html`
Template estático, escrito uma única vez, vive no repo, aberto direto do
disco (`file://.../panel/overwatch.html`). A cada 30s injeta uma nova tag
`<script src="…/sessions.js?t=<timestamp>">` (evita cache) e re-renderiza —
sem recarregar a página inteira, preservando scroll/estado de UI.

## 6. Tabela de hooks (`~/.claude/settings.json`, todos globais e `async: true`)

| Hook event | Matcher | Comando | O que grava |
|---|---|---|---|
| `SessionStart` | — | `node <repo>/scripts/overwatch.js session-start` | cria a entrada (cwd, branch, started_at); decide auto-abrir navegador (seção 9) |
| `UserPromptSubmit` | — | `node <repo>/scripts/overwatch.js prompt` | atualiza `summary` (80 primeiros chars), `status: running` |
| `PostToolUse` | `TodoWrite` | `node <repo>/scripts/overwatch.js todo` | grava `todos[]`, recalcula progresso |
| `PreToolUse` | `AskUserQuestion\|ExitPlanMode` | `node <repo>/scripts/overwatch.js waiting` | `status: waiting` |
| `Stop` | — | `node <repo>/scripts/overwatch.js idle` | `status: idle` |
| `SessionEnd` | — | `node <repo>/scripts/overwatch.js session-end` | `ended_at`, `status: ended` |
| `statusLine` | — | wrapper (ver 6.1) | `context_pct` |

### 6.1 Wrapper do `statusLine`
`~/.claude/statusline-command.sh` já existe e já funciona (mostra
modelo/contexto no terminal). Em vez de editá-lo, `install.mjs` aponta
`statusLine.command` do `settings.json` para
`scripts/statusline-wrapper.sh` (deste repo), que:
1. lê o stdin uma vez,
2. repassa para `node overwatch.js statusline` (grava `context_pct`),
3. repassa o mesmo stdin para o `statusline-command.sh` original e imprime a
   saída dele sem alterar — o terminal continua exatamente como está hoje.

Zero risco de quebrar o script atual do usuário.

## 7. Convenção de sub-progresso (não automática)

Quando uma tarefa da lista de todos se desdobra em N repetições (ex.: "revisar
12 seções"), o Claude edita o próprio `content` do item para incluir a fração
`(concluídas/total)` e chama `TodoWrite` de novo a cada sub-passo concluído:

```
"Revisar as 12 seções do relatório (1/12)"
"Revisar as 12 seções do relatório (2/12)"
...
"Revisar as 12 seções do relatório (12/12)" → status: completed
```

O hook `todo` faz um regex `(\d+)\s*\/\s*(\d+)` em cima do `content` para
desenhar uma barra de sub-progresso menor dentro do card. Isso é automático;
o que **não** é automático é o Claude lembrar de atualizar a cada sub-passo —
depende de uma instrução (documentada no README deste repo) seguida por
disciplina, não de um evento de sistema. Se o Claude esquecer de atualizar no
meio do processo, o painel fica "preso" na última fração informada.

## 8. Regra de auto-abertura do navegador

O hook `session-start` só abre o navegador automaticamente se, checando
`sessions.js`, **nenhuma outra sessão estiver ativa no momento** (nenhuma
entrada com `status` diferente de `ended`/expirada por TTL). Ou seja, só a
primeira sessão de um grupo abre aba — as demais aparecem sozinhas nessa
mesma aba dentro de 30s.

Limite aceito: se o usuário fechar essa aba única manualmente enquanto outras
sessões continuam ativas, uma sessão nova não reabre sozinha (o sistema
"acha" que já existe uma aba aberta). Considerado aceitável — decisão do
usuário, ver histórico da conversa.

## 9. Visual / UI

Direção estética: HUD militar/cockpit escuro e translúcido, inspirado no
estilo visual do projeto open-source *God's Eye View*
(github.com/bilawalsidhu/gods-eye-view) — **só o estilo visual** (painéis de
vidro fosco, glow sutil, tipografia mono para dados técnicos), não a mecânica
3D/globo do projeto original.

- Fundo quase preto, cards em vidro fosco com borda de glow fraco.
- Fonte mono para dados técnicos (reaproveitar `Space Mono`, já usada no
  site-casara, por familiaridade).
- Um grid de cards, um por sessão ativa.
- Cabeçalho do card: `<projeto> | <branch> | <resumo> | <tempo aberto> | <% contexto> | <status>`,
  com um "blip" colorido pulsante de status à esquerda.
- Corpo do card: lista de todos com ícone de estado e barra de sub-progresso
  quando aplicável; barra de progresso geral do card.
- Legenda de status:
  - 🔵 pulsante = rodando
  - 🟢 = concluído
  - 🟡 pulsante = aguardando você (travado em `AskUserQuestion`/`ExitPlanMode`)
  - ⚪ = ocioso (`Stop` disparou)
  - 🔴 = bloqueado/erro (convenção manual, não automática)
  - ⚫ esmaecido = encerrada/expirada
- No visual final, esses estados viram indicadores geométricos com glow
  (pontos/anéis), não emoji cru.
- Sessões encerradas ou expiradas (TTL) não somem — vão para um grupo
  "arquivadas" esmaecido no rodapé, até fechamento manual da aba.
- Sem filtros, sem ordenação, sem interações além de expandir/colapsar um
  card — mínimo de propósito para o MVP.

## 10. TTL e encerramento

- Sessão sem `last_update` há mais de 20 minutos → tratada como expirada,
  vai para o grupo "arquivadas" mesmo sem `SessionEnd` (cobre terminal
  fechado à força).
- `SessionEnd`, quando dispara, marca `ended_at` imediatamente (mais preciso
  que esperar o TTL).

## 11. Estrutura do repositório e portabilidade

```
claude-overwatch/
  README.md              # o que é, como funciona, como (re)instalar
  install.mjs             # funde os hooks no ~/.claude/settings.json (idempotente)
  scripts/
    overwatch.js           # script único, trata todos os eventos
    statusline-wrapper.sh  # wrapper não-destrutivo do statusLine existente
  panel/
    overwatch.html          # template do painel
  docs/
    design-spec.md          # este documento
```

**Instalação/reinstalação:** `install.mjs` lê `~/.claude/settings.json` (cria
se não existir) e funde as entradas de hook da seção 6, todas apontando para
o caminho absoluto deste repositório clonado. Idempotente — rodar de novo não
duplica entradas.

**Cenário de reformatação:** clonar este repositório em
`c:\projects\claude-overwatch`, rodar `node install.mjs` (ou pedir ao Claude
para rodar, com um prompt pronto no README) — hooks restaurados. Atualizações
posteriores são só `git pull`, sem reinstalar nada (hooks referenciam o repo
diretamente, não cópias).

## 12. Riscos e itens não confirmados

- O payload exato de `tool_input` para `TodoWrite` (nomes de campo) não foi
  confirmado na documentação — precisa ser validado empiricamente no início
  da implementação (dump do payload real para um arquivo, uma vez).
- Eventos como `SubagentStop` não foram confirmados como existentes nesta
  versão do Claude Code — por isso o design não depende deles (ver seção 7).
- O hook `statusLine` já roda com frequência alta (a cada renderização da
  status line); validar que a escrita em `sessions.js` a essa frequência não
  gera contenção perceptível — se gerar, throttle a escrita desse hook
  específico (ex.: só grava se `context_pct` mudou, ou no máximo 1x a cada
  poucos segundos).

## 13. Ideias futuras (fora do MVP)

Registradas para não perder, mas deliberadamente fora do escopo agora:

- **Filtro/ordenação** de sessões (por status, por projeto, por tempo aberto)
  quando o número de sessões simultâneas crescer o suficiente para incomodar.
- **Clique num todo** para ver o histórico de mudanças daquele item (quando
  cada status mudou), não só o estado atual.
- **Alerta sonoro/visual** quando uma sessão entra em `waiting` (status
  amarelo) — hoje só é visível olhando a tela; um aviso ativo evitaria deixar
  o Claude "esperando" sem perceber.
- **Acesso remoto opcional** (celular/outro monitor) via um modo Artifact,
  reaproveitando o mesmo `sessions.js` como fonte — só valeria a pena se o
  hábito de uso mostrar necessidade real de acompanhar fora da máquina.
- **Sub-progresso automático** via hook de subagente, se/quando se confirmar
  que um evento equivalente a `SubagentStop` existe de fato nesta versão do
  Claude Code — eliminaria a dependência da convenção manual da seção 7.
- **Resumo automático de contexto**: quando `context_pct` passar de um limiar
  (ex. 80%), sugerir ativamente que você resuma ou abra uma nova janela, em
  vez de só mostrar o número.
- **Métrica de custo/tokens por sessão**, se o payload dos hooks vier a
  expor isso de forma confiável.

## 14. Critérios de aceite do MVP

- Abrir 2+ sessões do Claude Code em projetos diferentes e ver ambas
  aparecerem como cards distintos no mesmo painel, sem intervenção manual.
- Lista de todos de uma sessão aparece e reflete status real (pending/
  in_progress/completed) dentro de ~30s de uma mudança.
- Fechar uma sessão (ou seu terminal) resulta nela migrar para "arquivadas"
  dentro do TTL de 20 min, mesmo sem `SessionEnd` limpo.
- Reformatar/clonar em outra máquina (ou simular apagando os hooks do
  `settings.json`) e rodar `install.mjs` restaura o funcionamento sem edição
  manual de JSON.
