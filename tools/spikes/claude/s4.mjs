// S4: does `--allowedTools "Edit(<path>)"` + `--permission-mode dontAsk` limit Fix with Claude to one
// file, run in an app-managed scratch worktree created from `git stash create` (ADR-018)? Tries the
// path forms of the permission rule syntax, incl. spaces and Polish characters.
// Usage: node tools/spikes/claude/s4.mjs <form> [<form> …] | all
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, run, readOnlyArgs, initRepo, git, removeDir } from './lib.mjs';

const userRepo = join(BASE, 's4 own repo');
const scratchRoot = join(BASE, 'scratch worktrees');
const polishDir = 'src/Zażółć gęślą';
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);

function fixtures() {
  initRepo(userRepo, {
    'src/A.cs': 'class A\n{\n    void Foo() { }\n}\n',
    'src/B.cs': 'class B\n{\n    void Baz() { }\n}\n',
    [`${polishDir}/C.cs`]: 'class C\n{\n    void Old() { }\n}\n',
  });
  // The user's own uncommitted work: it must reach the scratch worktree and stay untouched.
  writeFileSync(
    join(userRepo, 'src/A.cs'),
    '// work in progress\nclass A\n{\n    void Foo() { }\n}\n',
  );
  removeDir(scratchRoot);
  mkdirSync(scratchRoot, { recursive: true });
}

const toPosix = (p) =>
  '/' + p.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase());

// Rule forms, relative to the scratch worktree (cwd); `target` is the one file the rule allows.
const FORMS = {
  anchored: { target: 'src/A.cs', rule: () => 'Edit(/src/A.cs)' },
  relative: { target: 'src/A.cs', rule: () => 'Edit(src/A.cs)' },
  dotRelative: { target: 'src/A.cs', rule: () => 'Edit(./src/A.cs)' },
  absolute: { target: 'src/A.cs', rule: (wt) => `Edit(/${toPosix(join(wt, 'src', 'A.cs'))})` },
  backslash: { target: 'src/A.cs', rule: () => 'Edit(src\\A.cs)' },
  polish: { target: `${polishDir}/C.cs`, rule: () => `Edit(/${polishDir}/C.cs)` },
  restrictedAnchored: { target: 'src/A.cs', rule: () => 'Edit(/src/A.cs)', restricted: true },
};

const prompt = [
  'Make these three edits, each with the Edit tool:',
  '1. In src/A.cs rename the method Foo to Bar.',
  '2. In src/B.cs rename the method Baz to Qux.',
  `3. In ${polishDir}/C.cs rename the method Old to New.`,
  'If an edit is refused, continue with the others. At the end list which edits succeeded.',
].join('\n');

async function form(name) {
  const f = FORMS[name];
  const userStatusBefore = git(userRepo, 'status', '--porcelain=v1');
  const userHashBefore = hash(join(userRepo, 'src/A.cs'));
  const sha = git(userRepo, 'stash', 'create').trim() || git(userRepo, 'rev-parse', 'HEAD').trim();
  const wt = join(scratchRoot, `fix ${name}`);
  git(userRepo, 'worktree', 'add', '--detach', wt, sha);
  const wipInScratch = readFileSync(join(wt, 'src/A.cs'), 'utf8').startsWith('// work in progress');
  const rule = f.rule(wt);
  const args = readOnlyArgs({
    output: 'stream-json',
    tools: 'Read,Grep,Glob,Edit',
    settingSources: f.restricted ? null : 'user',
    extra: [...(f.restricted ? ['--restricted'] : []), '--allowedTools', rule],
  });
  const r = await run(`s4-${name}`, args, { cwd: wt, stdin: prompt });
  const changed = git(wt, 'status', '--porcelain=v1', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''));
  const res = r.result || {};
  const row = {
    form: name,
    rule,
    exit: r.code,
    is_error: res.is_error,
    tools: r.init?.tools,
    wipInScratch,
    changedInScratch: changed,
    onlyTargetChanged: changed.length === 1 && changed[0] === f.target,
    denials: (res.permission_denials || []).map(
      (d) => `${d.tool_name} ${d.tool_input?.file_path ?? ''}`,
    ),
    userCheckoutUntouched:
      git(userRepo, 'status', '--porcelain=v1') === userStatusBefore &&
      hash(join(userRepo, 'src/A.cs')) === userHashBefore,
    answer: typeof res.result === 'string' ? res.result.slice(0, 200) : undefined,
  };
  git(userRepo, 'worktree', 'remove', '--force', wt);
  git(userRepo, 'worktree', 'prune');
  writeFileSync(join(BASE, 'out', `s4-${name}.summary.json`), JSON.stringify(row, null, 2));
  console.log(JSON.stringify(row));
}

fixtures();
const names = process.argv.slice(2).includes('all') ? Object.keys(FORMS) : process.argv.slice(2);
for (const name of names) await form(name);
