<p align="center">
  <img src="panel/favicon.svg" width="72" alt="logo do claude-overwatch: um radar" />
</p>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:05070a,100:10202e&height=150&section=header&text=claude-overwatch&fontSize=36&fontColor=35b6ff&fontAlignY=42&desc=painel%20local%20de%20sess%C3%B5es%20do%20Claude%20Code&descSize=16&descColor=7c8ba0&descAlignY=70&width=1600" width="100%" alt="claude-overwatch" />

[![last commit](https://img.shields.io/github/last-commit/LuizCasara/overwatch-panel?style=flat-square&label=last%20commit&color=3ddc84)](https://github.com/LuizCasara/overwatch-panel/commits/main)
[![repo size](https://img.shields.io/github/repo-size/LuizCasara/overwatch-panel?style=flat-square&label=size&color=7c8ba0)](https://github.com/LuizCasara/overwatch-panel)
![node](https://img.shields.io/badge/node-%E2%89%A518-f2c94c?style=flat-square)
![deps](https://img.shields.io/badge/depend%C3%AAncias-zero-9aa7b8?style=flat-square)

Painel local (HTML, sem servidor) que mostra **todas as sessões ativas do
Claude Code na sua máquina** em tempo real: projeto, branch, resumo do
pedido, tempo aberto, % de contexto usado, status (rodando / aguardando você
/ ocioso / erro) e a lista de tarefas de cada uma.

Zero custo de tokens para manter atualizado — tudo é feito por hooks
(scripts determinísticos que reagem a eventos do Claude Code), não pelo
próprio Claude escrevendo arquivos.

![Painel com duas sessões ativas e uma arquivada](docs/screenshot.png)

*(dados de exemplo — o painel real reflete suas sessões do Claude Code)*

Ver o design completo em [`docs/design-spec.md`](docs/design-spec.md).

## Como funciona

```mermaid
flowchart LR
  CC["Claude Code<br/>(N sessões)"] -->|"hooks: SessionStart, prompt,<br/>todo, waiting, idle, SessionEnd, statusLine"| OW["scripts/overwatch.js<br/>(Node, sem deps)"]
  OW -->|"lock + escrita atômica"| DATA["~/.claude/overwatch-data/sessions.js<br/>window.CLAUDE_SESSIONS = {...}"]
  DATA -->|"&lt;script src&gt; recarregado a cada 30s"| PANEL["panel/overwatch.html<br/>(arquivo local, aberto no navegador)"]
```

Hooks determinísticos, não o próprio Claude, escrevem o estado — por isso o
custo de tokens é zero e o painel nunca fica desatualizado por "esquecimento".

## Status

MVP implementado e testado (`scripts/overwatch.js`, `install.mjs`,
`panel/overwatch.html`) — ver `.specs/features/session-overwatch-panel/`
para a spec, o design e a lista completa de tasks. `node install.mjs` ainda
não foi rodado contra o `~/.claude/settings.json` real desta máquina —
aguardando o usuário revisar e autorizar essa instalação (ela mescla hooks
no seu `settings.json` global).

## Testes

```bash
npm test
```

Roda os testes de `scripts/overwatch.js` (handlers de hook, lock de arquivo,
dispatch da CLI), `install.mjs` (merge de hooks/statusLine, geração de
`panel-config.js`) e `panel/format.js` (formatação/cálculo usados pelo
painel), todos com `node:test` nativo, sem dependências externas.

## Instalação

```bash
git clone <url-deste-repo> claude-overwatch
cd claude-overwatch
node install.mjs
```

Abre `panel/overwatch.html` automaticamente na primeira sessão ativa depois
disso.

## Reinstalação (PC reformatado)

Clone este repositório de novo no mesmo caminho (ou em qualquer caminho —
`install.mjs` usa o caminho absoluto de onde foi rodado) e rode
`node install.mjs` de novo. É idempotente: funde as entradas de hook no
`~/.claude/settings.json` sem duplicar nem remover hooks que você já tinha.

Se preferir, cole isto para o Claude Code em vez de rodar o comando você
mesmo:

> Clone o repositório `<url-deste-repo>` em `c:\projects\claude-overwatch` e
> rode `node install.mjs`. Me mostra o resultado.
