# claude-overwatch

Painel local (HTML, sem servidor) que mostra **todas as sessões ativas do
Claude Code na sua máquina** em tempo real: projeto, branch, resumo do
pedido, tempo aberto, % de contexto usado, status (rodando / aguardando você
/ ocioso / erro) e a lista de tarefas de cada uma.

Zero custo de tokens para manter atualizado — tudo é feito por hooks
(scripts determinísticos que reagem a eventos do Claude Code), não pelo
próprio Claude escrevendo arquivos.

Ver o design completo em [`docs/design-spec.md`](docs/design-spec.md).

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
