# Session Overwatch Panel Specification

## Problem Statement

Ao pedir uma tarefa grande para o Claude Code, o chat mostra comandos e chamadas de ferramenta em sequência, mas não dá uma noção rápida de em qual etapa (de quantas) o Claude está agora. Com várias sessões abertas em paralelo, não há como saber qual está rodando, qual travou esperando resposta e qual terminou sem abrir cada terminal individualmente.

## Goals

- [ ] Um painel HTML local (sem servidor) mostra todas as sessões ativas do Claude Code na máquina como cards, atualizando em até 30s.
- [ ] Cada card expõe: projeto, branch, resumo do pedido, tempo aberto, % de contexto usado, status (rodando/aguardando/ocioso/erro/encerrada) e a lista de tarefas (todos) com progresso.
- [ ] Manter o card atualizado tem custo zero de tokens/raciocínio do Claude — feito inteiramente por hooks determinísticos.
- [ ] Instalação e reinstalação (inclusive após reformatação da máquina) é um único comando idempotente.

## Out of Scope

Explicitamente excluído do MVP — candidatos a evolução futura (ver seção 13 do `docs/design-spec.md`), não implementar agora.

| Feature | Reason |
| --- | --- |
| Filtros e ordenação de sessões | MVP não precisa; volume baixo de sessões simultâneas |
| Interações além de expandir/colapsar um card | Mínimo de propósito para o MVP |
| Acesso remoto (outro dispositivo/celular) | Painel é local, `file://`, sem servidor |
| Histórico persistente entre reinicializações do Windows | Fora do MVP; painel reflete apenas o estado corrente |
| Clique em um todo para ver histórico de mudanças do item | Fora do MVP |
| Alerta sonoro/visual em `waiting` | Fora do MVP; hoje é só visual passivo |
| Sub-progresso automático via hook de subagente | Depende de um evento (`SubagentStop`) não confirmado nesta versão do Claude Code |
| Resumo automático de contexto / sugestão de compactação | Fora do MVP |
| Métrica de custo/tokens por sessão | Fora do MVP; payload dos hooks não confirmado para isso |
| Suporte multiplataforma (macOS/Linux) | Ambiente-alvo é Windows; ver Assumption OVW-A8 |

---

## Assumptions & Open Questions

Todas as ambiguidades identificadas na revisão do `docs/design-spec.md` (seção 12, "Riscos e itens não confirmados") e nas dimensões de requisito implícito foram resolvidas abaixo com um default explícito, já que este é um projeto pessoal de uso local e o usuário autorizou avançar sem checkpoint de validação síncrono.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Formato exato de `tool_input` no hook `PostToolUse` (matcher `TodoWrite`) | `tool_input.todos` é um array de `{ content: string, status: "pending"\|"in_progress"\|"completed", activeForm?: string }` | Formato observado em uso corrente da ferramenta `TodoWrite`; será confirmado empiricamente na Tarefa 1 de Execute (dump do payload real para arquivo) antes de qualquer código depender dele | n — validar empiricamente na primeira tarefa de implementação |
| Como derivar `context_pct` no hook `statusLine` | O script lê o campo de uso de contexto/tokens que o Claude Code já expõe no payload de `statusLine` (o mesmo dado que o `statusline-command.sh` atual do usuário já usa para exibir a métrica no terminal); se o payload não trouxer um percentual pronto, calcula a partir de `tokens usados / janela de contexto do modelo`, ambos presentes no payload | O usuário já tem um `statusline-command.sh` funcional mostrando essa métrica hoje — o payload necessariamente contém o dado ou os componentes para calculá-lo | n — validar lendo `~/.claude/statusline-command.sh` e o payload real na Tarefa 1 |
`SubagentStop` existe nesta versão do Claude Code? | Confirmado que existe (evento documentado, com matcher por tipo de agente); mesmo assim, nenhum requisito do MVP depende dele — sub-progresso automático via subagente continua fora de escopo (P3 futura, ver Out of Scope) | O design-spec original assumia incerteza sobre este evento; a pesquisa na documentação oficial confirmou que existe, mas usá-lo para sub-progresso automático é uma mudança de escopo, não algo a decidir retroativamente nesta spec | y — confirmado via documentação oficial |
| Campo `"async": true` na configuração de um hook em `settings.json` | Usar `"async": true` em todos os hooks novos, igual ao padrão já em produção | Inspecionado `~/.claude/settings.json` real do usuário: os hooks já configurados (`SubagentStart`, `PostToolUse`/`Skill`, `Stop`) já usam `"async": true` e funcionam hoje; não está na doc pública, mas está confirmado empiricamente no próprio ambiente-alvo | y — confirmado lendo `~/.claude/settings.json` do usuário |
| Payload exato do comando configurado em `statusLine` (settings.json) | Ler `context_window.used_percentage`, `context_window.remaining_percentage`, `context_window.current_usage.input_tokens`, `context_window.context_window_size` e `model.display_name` do JSON via stdin — os mesmos campos que `~/.claude/statusline-command.sh` (já instalado e funcional) consome hoje | Lido o script real do usuário: ele já faz `jq` nesses campos exatos e produz a linha de status corrente; `context_pct` do nosso schema é `context_window.used_percentage` arredondado | y — confirmado lendo `~/.claude/statusline-command.sh` do usuário; falta apenas confirmar se `session_id`/`cwd` também vêm nesse payload (o script atual não precisa desses campos, então não os usa) — validar com um dump rápido na Tarefa 1 |
| Política de retry/backoff ao adquirir o lock de `sessions.js` | Até 10 tentativas, backoff linear curto (50ms, 100ms, 150ms, ... até 500ms); se o arquivo `.lock` tiver mtime > 5s, é tratado como lock órfão (processo morto) e removido antes de tentar de novo | Evita deadlock permanente por processo morto sem introduzir dependência externa; valores pequenos porque a escrita é rara (a cada mudança de todo/prompt, não por milissegundo) | y — default do agente, ver OVW-A1 |
| Onde logar falhas de parsing/execução dos hooks | `~/.claude/overwatch-data/overwatch.log`, append-only, uma linha JSON por evento de erro (`{ ts, event, message }`) | Mesmo padrão de `track-usage.js`, que já loga silenciosamente sem quebrar o hook; arquivo único e fora do repositório, ao lado de `sessions.js` | y — default do agente |
| Throttle da escrita do hook `statusLine` (que roda a cada renderização da status line) | Sem throttle de tempo adicional no MVP: a escrita só ocorre se o `context_pct` calculado for diferente do último valor gravado para aquela sessão (dedupe por valor, não por tempo) | Resolve a preocupação de contenção da seção 12 do design-spec sem inventar um intervalo arbitrário; se a dedupe por valor não bastar, é um ajuste de uma linha depois, não uma mudança de contrato | y — default do agente |
| Sessão com `ended_at` preenchido recebe um novo evento (`prompt`, `todo`, etc.) para o mesmo `session_id` | O hook simplesmente sobrescreve o estado, limpa `ended_at` e volta a tratar a sessão como ativa (idempotente, sem bloqueio de transição) | Caso de borda raro (reuso de `session_id` não é esperado na prática) — travar a transição adicionaria complexidade sem benefício observável | y — default do agente |
| Sistema operacional alvo para abrir o navegador e para os hooks (`cmd`/`sh`) | Windows apenas (`start` para abrir o arquivo local; `statusline-wrapper.sh` roda via Git Bash, já presente no ambiente do usuário) | O ambiente confirmado do usuário é Windows 11 com Git Bash disponível; multiplataforma não foi pedido | y — default do agente, ver Out of Scope |
| Onde fica `sessions.js` e o lock | `~/.claude/overwatch-data/sessions.js` e `~/.claude/overwatch-data/sessions.js.lock`, criando o diretório se não existir | Já especificado no `docs/design-spec.md` seção 4/5 | y |
| Como obter `branch` no hook | `git rev-parse --abbrev-ref HEAD` executado com `cwd` do payload do hook; se falhar (não é repo git, ou comando indisponível) grava `branch: null` e o painel mostra "—" | O `cwd` já vem no payload de `SessionStart`; falha de `git` não deve quebrar o hook (regra geral: hooks nunca lançam erro) | y — default do agente |
| Como obter `summary` | Primeiros 80 caracteres do campo `prompt` do payload de `UserPromptSubmit`, sem sumarização semântica, sem trim inteligente de palavra | Consistente com a filosofia "hooks determinísticos, custo zero de token" do design-spec | y — já especificado no design-spec seção 5 |
| Formato de tempo em `context_pct` ausente/nulo (sessão muito nova, statusLine ainda não disparou) | Painel mostra "—" no lugar do percentual até o primeiro evento `statusline` daquela sessão | Evita mostrar `0%` enganoso antes do primeiro dado real | y — default do agente |

**Open questions: none** — todas as acima têm um default explícito; as marcadas "n" na coluna Confirmed? são validações técnicas objetivas (não decisões de produto) e serão executadas como parte da primeira tarefa de Execute, não bloqueiam a aprovação desta spec.

---

## User Stories

### P1: Painel mostra sessões ativas em tempo real ⭐ MVP

**User Story**: Como usuário do Claude Code rodando várias sessões em paralelo, quero abrir um painel HTML local que mostra cada sessão ativa como um card (projeto, branch, resumo, tempo aberto, % de contexto, status), para saber o estado de cada uma sem abrir cada terminal.

**Why P1**: É o objetivo central do MVP (seção 2 do design-spec) — sem isso não há produto.

**Acceptance Criteria**:

1. WHEN uma sessão do Claude Code inicia (`SessionStart`) THEN o sistema SHALL criar uma entrada em `sessions.js` com `session_id`, `project` (basename do `cwd`), `cwd`, `branch`, `started_at`, `last_update` e `status: "running"`.
2. WHEN o usuário envia um prompt (`UserPromptSubmit`) THEN o sistema SHALL atualizar `summary` (80 primeiros caracteres do prompt) e `status: "running"` na entrada da sessão correspondente.
3. WHEN o hook `PreToolUse` dispara para `AskUserQuestion` ou `ExitPlanMode` THEN o sistema SHALL atualizar `status: "waiting"` na entrada da sessão.
4. WHEN o hook `Stop` dispara THEN o sistema SHALL atualizar `status: "idle"` na entrada da sessão.
5. WHEN o hook `SessionEnd` dispara THEN o sistema SHALL gravar `ended_at` com o timestamp corrente e `status: "ended"` na entrada da sessão.
6. WHEN o hook `statusLine` dispara e o `context_pct` calculado difere do último valor gravado para aquela sessão THEN o sistema SHALL atualizar `context_pct` e `last_update`.
7. The panel SHALL recarregar `sessions.js` a cada 30 segundos via uma nova tag `<script src="...sessions.js?t=<timestamp>">`, sem recarregar a página inteira.
8. WHEN o painel renderiza uma sessão com `status` diferente de `ended` e `last_update` há menos de 20 minutos THEN o sistema SHALL exibir o card no grupo ativo com: projeto, branch, resumo, tempo aberto (calculado a partir de `started_at`), `context_pct` (ou "—" se nulo) e um indicador visual de status.
9. WHILE duas ou mais sessões tentam escrever em `sessions.js` ao mesmo tempo THEN o sistema SHALL serializar as escritas via lock de arquivo (`sessions.js.lock`) com retry e escrever via arquivo temporário + rename atômico, de forma que nenhuma escrita concorrente corrompa ou sobrescreva silenciosamente os dados de outra sessão.
10. IF o hook `statusLine` não disparou ainda para uma sessão THEN o painel SHALL exibir "—" no lugar do percentual de contexto, nunca `0%`.

**Independent Test**: Abrir 2 sessões do Claude Code em projetos diferentes, abrir `panel/overwatch.html` no navegador, e ver ambas aparecerem como cards distintos dentro de 30s, com status correto conforme cada uma interage.

---

### P2: Progresso de tarefas (todos) visível por sessão

**User Story**: Como usuário acompanhando uma tarefa grande, quero ver a lista de todos de cada sessão e seu progresso (incluindo sub-progresso textual tipo "3/12"), para saber exatamente em qual etapa o Claude está.

**Why P2**: Complementa o P1 com o detalhe que motivou o projeto (saber "em qual etapa, de quantas"), mas o painel já é utilizável sem isso (P1 sozinho mostra status geral).

**Acceptance Criteria**:

1. WHEN o hook `PostToolUse` dispara com matcher `TodoWrite` THEN o sistema SHALL gravar `todos[]` (lista de `{ content, status }`) na entrada da sessão correspondente.
2. WHEN um item de `todos[].content` contiver um padrão `(\d+)\s*\/\s*(\d+)` THEN o painel SHALL exibir uma barra de sub-progresso menor dentro do item, calculada como `concluídas/total`.
3. The panel SHALL exibir uma barra de progresso geral do card calculada como `todos com status "completed"` sobre `total de todos`.
4. IF `todos[]` estiver vazio ou ausente na entrada da sessão THEN o painel SHALL exibir o card sem a seção de lista de tarefas, sem erro visual.

**Independent Test**: Rodar uma tarefa com uma lista de todos no Claude Code, ver a lista aparecer no card correspondente refletindo pending/in_progress/completed dentro de ~30s de uma mudança (critério de aceite do design-spec seção 14).

---

### P3: Instalação portátil e auto-abertura do painel

**User Story**: Como usuário que pode reformatar a máquina ou clonar o repositório em outro caminho, quero um único comando idempotente que registre os hooks no `settings.json`, para não precisar editar JSON manualmente nem duplicar hooks ao rodar de novo.

**Why P3**: Necessário para o critério de aceite "reformatar/clonar em outra máquina e rodar `install.mjs` restaura o funcionamento", mas não bloqueia o uso diário uma vez instalado (por isso não é P1).

**Acceptance Criteria**:

1. WHEN o usuário roda `node install.mjs` THEN o sistema SHALL ler `~/.claude/settings.json` (criando-o se não existir) e mesclar as entradas de hook da tabela da seção 6 do design-spec, apontando para o caminho absoluto do repositório de onde o comando foi executado.
2. WHEN `node install.mjs` roda uma segunda vez sobre um `settings.json` já configurado por ele THEN o sistema SHALL deixar o arquivo sem duplicar entradas de hook e sem remover hooks pré-existentes de outras ferramentas.
3. WHEN `install.mjs` configura `statusLine.command` THEN o sistema SHALL apontar para `scripts/statusline-wrapper.sh` deste repositório, preservando o `statusline-command.sh` original do usuário como o programa que o wrapper invoca e cujo stdout é repassado sem alteração.
4. WHEN o hook `session-start` dispara THEN o sistema SHALL verificar em `sessions.js` se nenhuma outra sessão tem `status` diferente de `ended` e não expirada por TTL; IF essa condição for verdadeira THEN o sistema SHALL abrir `panel/overwatch.html` automaticamente no navegador padrão do Windows.
5. IF já existir ao menos uma outra sessão ativa (não `ended`, não expirada) no momento do `SessionStart` THEN o sistema SHALL NOT abrir uma nova aba do navegador.

**Independent Test**: Simular apagando os hooks do `settings.json`, rodar `node install.mjs`, confirmar que os hooks voltam sem edição manual; abrir a primeira sessão do dia e ver o navegador abrir sozinho; abrir uma segunda sessão em paralelo e confirmar que nenhuma aba nova abre.

---

## Edge Cases

- IF o payload recebido via stdin por qualquer hook não for JSON válido ou não tiver os campos esperados THEN o sistema SHALL engolir o erro, gravar uma linha em `overwatch.log` e retornar sem lançar exceção (nunca quebrar o hook do Claude Code).
- IF o lock `sessions.js.lock` existir com mtime superior a 5 segundos THEN o sistema SHALL tratá-lo como órfão, removê-lo e prosseguir com a escrita.
- IF `sessions.js` não existir ainda (primeira execução) THEN o painel SHALL exibir uma tela vazia com uma mensagem indicando que nenhuma sessão foi registrada ainda, sem erro de JavaScript.
- IF `git rev-parse --abbrev-ref HEAD` falhar (não é repositório git) THEN o sistema SHALL gravar `branch: null` e o painel SHALL exibir "—" no lugar da branch.
- WHEN uma sessão fica sem `last_update` por mais de 20 minutos e nenhum `SessionEnd` disparou THEN o painel SHALL tratá-la como expirada e movê-la para o grupo "arquivadas", mesmo com `ended_at` nulo.
- IF duas sessões diferentes tiverem o mesmo `project` (mesmo basename de pastas distintas) THEN o painel SHALL exibir ambos os cards normalmente, distinguidos por `cwd`/branch, sem deduplicar.
- IF o usuário fechar manualmente a única aba do painel enquanto outras sessões continuam ativas THEN uma sessão nova SHALL NOT reabrir a aba automaticamente (limitação aceita, ver design-spec seção 8).
- IF `panel/overwatch.html` for aberto antes de `install.mjs` ter sido executado ao menos uma vez (sem o arquivo de configuração de caminho gerado pelo install) THEN o painel SHALL exibir uma mensagem instruindo a rodar `node install.mjs`, sem erro de JavaScript não tratado no console.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| OVW-01 | P1: Painel em tempo real | Implementing | In Tasks (T6, done) |
| OVW-02 | P1: Painel em tempo real | Design | Pending |
| OVW-03 | P1: Painel em tempo real | Design | Pending |
| OVW-04 | P1: Painel em tempo real | Design | Pending |
| OVW-05 | P1: Painel em tempo real | Design | Pending |
| OVW-06 | P1: Painel em tempo real | Design | Pending |
| OVW-07 | P1: Painel em tempo real | Design | Pending |
| OVW-08 | P1: Painel em tempo real | Design | Pending |
| OVW-09 | P1: Painel em tempo real | Implementing | In Tasks (T4, done) |
| OVW-10 | P1: Painel em tempo real | Design | Pending |
| OVW-11 | P2: Progresso de todos | Design | Pending |
| OVW-12 | P2: Progresso de todos | Design | Pending |
| OVW-13 | P2: Progresso de todos | Design | Pending |
| OVW-14 | P2: Progresso de todos | Design | Pending |
| OVW-15 | P3: Instalação portátil | Design | Pending |
| OVW-16 | P3: Instalação portátil | Design | Pending |
| OVW-17 | P3: Instalação portátil | Design | Pending |
| OVW-18 | P3: Instalação portátil | Design | Pending |
| OVW-19 | P3: Instalação portátil | Design | Pending |

**ID format:** `OVW-NN`, numerado na ordem de aparição dos critérios de aceite acima (OVW-01..10 = P1 ACs 1..10, OVW-11..14 = P2 ACs 1..4, OVW-15..19 = P3 ACs 1..5).

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 19 total, 0 mapped to tasks, 19 unmapped ⚠️ (esperado nesta fase — Tasks ainda não rodou)

---

## Success Criteria

Critérios de aceite do MVP (herdados do `docs/design-spec.md` seção 14):

- [ ] Abrir 2+ sessões do Claude Code em projetos diferentes resulta em ambas aparecendo como cards distintos no mesmo painel, sem intervenção manual.
- [ ] Lista de todos de uma sessão aparece e reflete status real (pending/in_progress/completed) dentro de ~30s de uma mudança.
- [ ] Fechar uma sessão (ou seu terminal) resulta nela migrar para "arquivadas" dentro do TTL de 20 min, mesmo sem `SessionEnd` limpo.
- [ ] Reformatar/clonar em outra máquina (ou simular apagando os hooks do `settings.json`) e rodar `install.mjs` restaura o funcionamento sem edição manual de JSON.
