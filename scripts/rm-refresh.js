'use strict';
// Descobre, para o RM de uma sessao, o status no board e se ja foi mergeado
// no back, no front etc. Roda destacado (spawn do overwatch.js), nunca no
// caminho de um hook: faz rede (git fetch, API do board).
//
// Casamento por codigo: commits/PRs/titulo da spec carregam "(RM-<code>)"
// (convencao das skills commit, pr e to-spec). O board vem de
// <spine>/scripts/roadmap.py, que ja sabe ler a credencial do .env.local sem
// imprimi-la: este modulo nunca toca em segredo.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TAG_TO_REPO = {
  BACK: 'soupe-backend',
  FRONT: 'soupe-frontend',
  SITE: 'soupe-site',
  MCP: 'sencia-mcp',
};
const REPO_LABEL = {
  'soupe-backend': 'back',
  'soupe-frontend': 'front',
  'soupe-site': 'site',
  'sencia-mcp': 'mcp',
};

// repos.yaml tem so chaves simples: parse minimo, sem dependencia de YAML.
function parseRepos(text) {
  const repos = {};
  let current = null;
  let inRepos = false;
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^repos:\s*$/.test(raw)) {
      inRepos = true;
      continue;
    }
    if (!inRepos) continue;
    const key = raw.match(/^ {2}([\w-]+):\s*$/);
    if (key) {
      current = key[1];
      repos[current] = {};
      continue;
    }
    const field = raw.match(/^ {4}(prod_branch|integration_branch):\s*([\w./-]+)/);
    if (field && current) repos[current][field[1]] = field[2];
  }
  return repos;
}

// Saida de `roadmap.py show <code>`:
//   RM-142  Titulo
//     status: WORKING   tags: BACK, FRONT
function parseRoadmapShow(output) {
  const text = String(output);
  const status = (text.match(/^\s*status:\s*([A-Z_]+)/m) || [])[1] || null;
  const tagsLine = (text.match(/tags:\s*(.*)$/m) || [])[1] || '';
  const tags = tagsLine.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const title = (text.match(/^RM-\d+\s+(.+)$/m) || [])[1] || null;
  return { status, tags, title };
}

function reposFromTags(tags, known) {
  return tags.map(t => TAG_TO_REPO[t]).filter(r => r && known.includes(r));
}

// Estado do RM num repo:
//   prod        algum commit com o codigo esta na branch de producao
//   integration esta na branch de integracao (front: develop), falta o release
//   wip         existe commit com o codigo, mas so em outras branches
//   none        nenhum commit cita o codigo
function repoState({ git, code, prodBranch, integrationBranch }) {
  const pattern = `RM-${code}([^0-9]|$)`;
  let out = '';
  try {
    out = git(['log', '--all', '--extended-regexp', `--grep=${pattern}`, '--format=%H%x09%s', '-n', '60']);
  } catch {
    return { state: 'unknown', prod_branch: prodBranch };
  }
  const commits = out.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [sha, ...subject] = l.split('\t');
    return { sha, subject: subject.join('\t') };
  });
  if (commits.length === 0) return { state: 'none', prod_branch: prodBranch };

  const contains = branch => {
    for (const c of commits) {
      try {
        git(['merge-base', '--is-ancestor', c.sha, `origin/${branch}`]);
        return c;
      } catch {
        // nao e ancestral (ou a branch nao existe)
      }
    }
    return null;
  };
  const pr = c => {
    const m = c && c.subject.match(/\(#(\d+)\)/);
    return m ? Number(m[1]) : null;
  };

  const inProd = contains(prodBranch);
  if (inProd) return { state: 'prod', prod_branch: prodBranch, pr: pr(inProd) };
  const inIntegration = integrationBranch ? contains(integrationBranch) : null;
  if (inIntegration) {
    return { state: 'integration', prod_branch: prodBranch, integration_branch: integrationBranch, pr: pr(inIntegration) };
  }
  return { state: 'wip', prod_branch: prodBranch };
}

// Resultado final guardado em entry.rm
function computeRmStatus({ code, spineRoot, deps }) {
  const result = { code, status: null, title: null, repos: {}, complete: false, board_error: null };
  let tags = [];
  try {
    const board = parseRoadmapShow(deps.roadmap(code));
    result.status = board.status;
    result.title = board.title;
    tags = board.tags;
  } catch (err) {
    result.board_error = String((err && err.message) || err).split('\n')[0].slice(0, 120);
  }

  let repos = {};
  try {
    repos = parseRepos(fs.readFileSync(path.join(spineRoot, 'repos.yaml'), 'utf8'));
  } catch {
    // sem repos.yaml: so o status do board
  }
  const known = Object.keys(repos);
  const involved = reposFromTags(tags, known);
  // Sem tags (token expirado), olha todos os repos de codigo: so aparecem os que tem commit.
  const targets = involved.length > 0 ? involved : known.filter(r => REPO_LABEL[r]);

  for (const repo of targets) {
    const dir = path.join(spineRoot, repo);
    if (!deps.exists(dir)) continue;
    const state = repoState({
      git: args => deps.git(dir, args),
      code,
      prodBranch: repos[repo].prod_branch || 'main',
      integrationBranch: repos[repo].integration_branch || null,
    });
    // Sem tags, repo sem nenhum commit com o codigo nao faz parte desta demanda.
    if (involved.length === 0 && state.state === 'none') continue;
    result.repos[REPO_LABEL[repo]] = state;
  }

  const states = Object.values(result.repos);
  result.complete = states.length > 0 && states.every(s => s.state === 'prod');
  return result;
}

function defaultDeps(spineRoot) {
  return {
    exists: p => fs.existsSync(p),
    git: (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true }),
    fetch: dir => {
      try {
        execFileSync('git', ['-C', dir, 'fetch', 'origin', '--quiet'], { timeout: 30000, windowsHide: true, stdio: 'ignore' });
      } catch {
        // offline: segue com as refs locais
      }
    },
    roadmap: code =>
      execFileSync('python', [path.join(spineRoot, 'scripts', 'roadmap.py'), 'show', String(code)], {
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
  };
}

// CLI destacado: node rm-refresh.js <rm-code> <spine-root> [data-dir]
// Grava o resultado em toda sessao que aponta para o mesmo RM.
function main(argv = process.argv) {
  const [, , codeArg, spineRoot, dataDirArg] = argv;
  const code = Number(codeArg);
  if (!Number.isInteger(code) || !spineRoot) return;
  const overwatch = require('./overwatch.js');
  const dataDir = dataDirArg || overwatch.DEFAULT_DATA_DIR;
  const deps = defaultDeps(spineRoot);

  try {
    const repos = parseRepos(fs.readFileSync(path.join(spineRoot, 'repos.yaml'), 'utf8'));
    for (const repo of Object.keys(repos)) {
      const dir = path.join(spineRoot, repo);
      if (REPO_LABEL[repo] && deps.exists(dir)) deps.fetch(dir);
    }
  } catch {
    // sem fetch
  }

  const result = computeRmStatus({ code, spineRoot, deps });
  result.checked_at = new Date().toISOString();

  overwatch.withSessionsLock(dataDir, sessions => {
    for (const entry of Object.values(sessions)) {
      if (entry.feature && entry.feature.rm === code) entry.rm = result;
    }
  });
}

module.exports = {
  parseRepos,
  parseRoadmapShow,
  reposFromTags,
  repoState,
  computeRmStatus,
  defaultDeps,
  main,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    try {
      require('./overwatch.js').logError('rm-refresh', (err && err.message) || String(err));
    } catch {
      // nunca propaga
    }
  }
  process.exit(0);
}
