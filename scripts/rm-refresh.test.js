'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseRepos,
  parseRoadmapShow,
  reposFromTags,
  repoState,
  computeRmStatus,
} = require('./rm-refresh.js');

const REPOS_YAML = `# comentario
repos:
  soupe-backend:
    remote: https://github.com/platform-soupe/soupe-backend.git
    prod_branch: main
    flow: branch de feature → PR para main; develop não é usada
  soupe-frontend:
    remote: https://github.com/LuizCasara/soupe-frontend.git
    prod_branch: master   # integração em develop
    integration_branch: develop   # onde entram
    flow: commits em develop → PR develop→master
  sencia-mcp:
    prod_branch: main
`;

test('parseRepos reads prod and integration branches and ignores trailing comments', () => {
  assert.deepEqual(parseRepos(REPOS_YAML), {
    'soupe-backend': { prod_branch: 'main' },
    'soupe-frontend': { prod_branch: 'master', integration_branch: 'develop' },
    'sencia-mcp': { prod_branch: 'main' },
  });
});

test('parseRoadmapShow extracts status, tags and title from roadmap.py output', () => {
  const out = 'RM-142  Mesclagem de clientes\n  id:     abc\n  status: WORKING   tags: BACK, FRONT\n  spec:   work/x.md\n';
  assert.deepEqual(parseRoadmapShow(out), { status: 'WORKING', tags: ['BACK', 'FRONT'], title: 'Mesclagem de clientes' });
});

test('parseRoadmapShow tolerates an item without tags', () => {
  const out = 'RM-9  Algo\n  id: x\n  status: IDEA   tags: \n';
  assert.deepEqual(parseRoadmapShow(out), { status: 'IDEA', tags: [], title: 'Algo' });
});

test('reposFromTags maps board tags to known repos only', () => {
  assert.deepEqual(
    reposFromTags(['BACK', 'FRONT', 'SPINE', 'MCP'], ['soupe-backend', 'soupe-frontend']),
    ['soupe-backend', 'soupe-frontend'],
  );
});

// git falso: `log` devolve commits; `merge-base --is-ancestor <sha> origin/<branch>` e ancestral
// quando `ancestors[branch]` contem o sha.
function fakeGit({ commits = [], ancestors = {}, logThrows = false } = {}) {
  return args => {
    if (args[0] === 'log') {
      if (logThrows) throw new Error('fatal');
      return commits.map(c => `${c.sha}\t${c.subject}`).join('\n');
    }
    if (args[0] === 'merge-base') {
      const sha = args[2];
      const branch = args[3].replace('origin/', '');
      if ((ancestors[branch] || []).includes(sha)) return '';
      throw new Error('not ancestor');
    }
    throw new Error('unexpected git ' + args.join(' '));
  };
}

test('repoState is prod when a commit with the code is an ancestor of the prod branch, with the PR number', () => {
  const git = fakeGit({
    commits: [{ sha: 'aaa', subject: 'feat(person): merge duplicate customers (RM-142) (#55)' }],
    ancestors: { main: ['aaa'] },
  });
  assert.deepEqual(repoState({ git, code: 142, prodBranch: 'main', integrationBranch: null }), {
    state: 'prod',
    prod_branch: 'main',
    pr: 55,
  });
});

test('repoState is integration when only the integration branch has it (front waiting for the release)', () => {
  const git = fakeGit({
    commits: [{ sha: 'bbb', subject: 'feat(customers): merge (RM-142)' }],
    ancestors: { develop: ['bbb'] },
  });
  const s = repoState({ git, code: 142, prodBranch: 'master', integrationBranch: 'develop' });
  assert.equal(s.state, 'integration');
  assert.equal(s.integration_branch, 'develop');
});

test('repoState is wip when commits exist but are on neither branch, none when there are no commits', () => {
  const wip = repoState({
    git: fakeGit({ commits: [{ sha: 'ccc', subject: 'wip (RM-142)' }] }),
    code: 142,
    prodBranch: 'main',
    integrationBranch: null,
  });
  assert.equal(wip.state, 'wip');
  const none = repoState({ git: fakeGit({ commits: [] }), code: 142, prodBranch: 'main', integrationBranch: null });
  assert.equal(none.state, 'none');
});

test('repoState is unknown when git log fails', () => {
  const s = repoState({ git: fakeGit({ logThrows: true }), code: 1, prodBranch: 'main', integrationBranch: null });
  assert.equal(s.state, 'unknown');
});

test('repoState anchors the code so RM-14 does not match RM-142', () => {
  let grep = '';
  const git = args => {
    if (args[0] === 'log') grep = args.find(a => a.startsWith('--grep='));
    return '';
  };
  repoState({ git, code: 14, prodBranch: 'main', integrationBranch: null });
  assert.equal(grep, '--grep=RM-14([^0-9]|$)');
  assert.equal(new RegExp(grep.slice(7)).test('feat (RM-142)'), false);
  assert.equal(new RegExp(grep.slice(7)).test('feat (RM-14)'), true);
});

function tmpSpine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overwatch-spine-'));
  fs.writeFileSync(path.join(root, 'repos.yaml'), REPOS_YAML);
  for (const r of ['soupe-backend', 'soupe-frontend']) fs.mkdirSync(path.join(root, r));
  return root;
}

test('computeRmStatus combines board status, tagged repos and a complete flag', () => {
  const spineRoot = tmpSpine();
  const deps = {
    exists: p => fs.existsSync(p),
    roadmap: () => 'RM-142  Mesclagem\n  status: VALIDANDO   tags: BACK, FRONT\n',
    git: (dir, args) => {
      const prod = dir.endsWith('soupe-backend') ? 'main' : 'master';
      return fakeGit({
        commits: [{ sha: 'aaa', subject: 'feat (RM-142) (#9)' }],
        ancestors: { [prod]: ['aaa'] },
      })(args);
    },
  };
  const r = computeRmStatus({ code: 142, spineRoot, deps });
  assert.equal(r.status, 'VALIDANDO');
  assert.equal(r.repos.back.state, 'prod');
  assert.equal(r.repos.front.state, 'prod');
  assert.equal(r.complete, true);
  assert.equal(r.board_error, null);
});

test('computeRmStatus is not complete while the front is only on develop', () => {
  const spineRoot = tmpSpine();
  const deps = {
    exists: p => fs.existsSync(p),
    roadmap: () => 'RM-142  X\n  status: WORKING   tags: BACK, FRONT\n',
    git: (dir, args) => {
      const isBack = dir.endsWith('soupe-backend');
      return fakeGit({
        commits: [{ sha: 'aaa', subject: 'feat (RM-142)' }],
        ancestors: isBack ? { main: ['aaa'] } : { develop: ['aaa'] },
      })(args);
    },
  };
  const r = computeRmStatus({ code: 142, spineRoot, deps });
  assert.equal(r.repos.back.state, 'prod');
  assert.equal(r.repos.front.state, 'integration');
  assert.equal(r.complete, false);
});

test('computeRmStatus keeps working when the board fails: records the error and scans only repos with commits', () => {
  const spineRoot = tmpSpine();
  const deps = {
    exists: p => fs.existsSync(p),
    roadmap: () => {
      throw new Error('token EXPIRADO ha 3.0 h\nrenove');
    },
    git: (dir, args) =>
      fakeGit({
        commits: dir.endsWith('soupe-backend') ? [{ sha: 'aaa', subject: 'fix (RM-7)' }] : [],
        ancestors: { main: ['aaa'] },
      })(args),
  };
  const r = computeRmStatus({ code: 7, spineRoot, deps });
  assert.equal(r.status, null);
  assert.equal(r.board_error, 'token EXPIRADO ha 3.0 h');
  assert.deepEqual(Object.keys(r.repos), ['back']);
  assert.equal(r.complete, true);
});

test('computeRmStatus is never complete without any repo evidence', () => {
  const spineRoot = tmpSpine();
  const deps = { exists: () => false, roadmap: () => 'RM-1  Y\n  status: IDEA   tags: BACK\n', git: () => '' };
  const r = computeRmStatus({ code: 1, spineRoot, deps });
  assert.deepEqual(r.repos, {});
  assert.equal(r.complete, false);
});
