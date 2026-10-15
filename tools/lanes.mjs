#!/usr/bin/env node
// Parallel lanes (E4 in docs/process/IMPROVEMENTS.md): one git worktree per lane next to the main
// checkout (../gr-<lane>, branch <mx>/<lane> from HEAD) with its own mock dev server port (GR_PORT).
// Only a lane whose --owns reaches src-tauri/ builds Rust ("rust" in lane.json; tools/verify.mjs
// skips the Rust steps otherwise), in its own src-tauri/target: a shared CARGO_TARGET_DIR is locked
// by cargo and two worktrees overwrite each other's crate fingerprints.
//
//   node tools/lanes.mjs create <lane> --owns "src/screens/step/**,tests/e2e/step*" [--branch m3/<lane>] [--base HEAD] [--no-install]
//   node tools/lanes.mjs list [--json]
//   node tools/lanes.mjs remove <lane> [--force] [--delete-branch]
//
// The registry is .lanes/lanes.json in the main checkout. A lane gets .lanes/<lane>/lane.json, the
// context pack if one was made (tools/context-pack.mjs) and .claude/settings.local.json = the main
// one + env GR_PORT (and RUSTC_WRAPPER=sccache when it is on PATH). The contract (plan, ## Lanes,
// IPC types) must be committed first. A lane ends with a commit and .lanes/<lane>/report.md;
// remove copies the report into the main checkout's .lanes/<lane>/.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import {
  FIRST_LANE_PORT,
  LAST_LANE_PORT,
  LANE_NAME,
  laneBranch,
  mainCheckout,
  outsideOwns,
  overlaps,
  ownsRust,
  pickPort,
} from './lanes-lib.mjs';

const BOOLEAN = new Set(['no-install', 'force', 'delete-branch', 'json']);
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const name = args[i].startsWith('--') ? args[i].slice(2) : null;
  if (!name) positional.push(args[i]);
  else flags[name] = BOOLEAN.has(name) ? true : (args[++i] ?? '');
}
const [command, lane] = positional;

const root = mainCheckout(process.cwd());
const registryFile = join(root, '.lanes', 'lanes.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function git(gitArgs, cwd = root) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...gitArgs], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function tryGit(gitArgs, cwd) {
  try {
    return git(gitArgs, cwd);
  } catch {
    return null;
  }
}

const lines = (text) => (text ? text.split('\n').filter(Boolean) : []);
/** Paths from `git status --porcelain` (a rename counts as its new path). */
const statusPaths = (text) => lines(text).map((l) => l.slice(3).split(' -> ').pop());

function readRegistry() {
  return existsSync(registryFile) ? JSON.parse(readFileSync(registryFile, 'utf8')) : {};
}

function writeRegistry(registry) {
  mkdirSync(dirname(registryFile), { recursive: true });
  writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n');
}

/** Something listens on the port (a dev server of another checkout or lane). */
function busy(port) {
  const probe = (host) =>
    new Promise((done) => {
      const socket = connect({ port, host });
      socket.setTimeout(300);
      socket.once('connect', () => (socket.destroy(), done(true)));
      socket.once('timeout', () => (socket.destroy(), done(false)));
      socket.once('error', () => done(false));
    });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean));
}

function onPath(program) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(finder, [program], { stdio: 'ignore' }).status === 0;
}

async function create() {
  if (!lane || !LANE_NAME.test(lane)) fail(`Lane name must match ${LANE_NAME}`);
  const owns = (flags.owns || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  if (!owns.length) fail('--owns "<glob>,<glob>" is required: the files this lane may change');
  const registry = readRegistry();
  if (registry[lane]) fail(`Lane ${lane} exists: ${registry[lane].path}`);
  // The ledger changes with every metrics run; everything else tracked must be committed.
  const dirty = statusPaths(git(['status', '--porcelain', '--untracked-files=no'])).filter(
    (f) => !f.startsWith('.metrics/'),
  );
  if (dirty.length)
    fail(`Commit the contract first; tracked changes in ${root}:\n  ${dirty.join('\n  ')}`);
  const branch = flags.branch || laneBranch(git(['branch', '--show-current']), lane);
  if (!branch) fail('Pass --branch: the current branch has no milestone prefix (mN)');
  // tools/metrics/report.mjs counts a ../gr-<lane> session as a lane by this suffix.
  if (!branch.endsWith(`/${lane}`)) fail(`--branch must end with /${lane}, e.g. m3/${lane}`);
  if (tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null)
    fail(`Branch ${branch} exists`);
  const path = join(dirname(root), `gr-${lane}`);
  if (existsSync(path)) fail(`${path} exists`);
  const base = git(['rev-parse', '--verify', `${flags.base || 'HEAD'}^{commit}`]);
  const port = await pickPort(new Set(Object.values(registry).map((r) => r.port)), busy);
  if (!port) fail(`No free port in ${FIRST_LANE_PORT}-${LAST_LANE_PORT}`);

  git(['worktree', 'add', '-b', branch, path, base]);
  const rust = ownsRust(owns);
  const sccache = rust && onPath('sccache');
  const record = { path, branch, base, port, owns, rust, created: new Date().toISOString() };
  registry[lane] = record;
  writeRegistry(registry);

  const laneDir = join(path, '.lanes', lane);
  mkdirSync(laneDir, { recursive: true });
  writeFileSync(
    join(laneDir, 'lane.json'),
    JSON.stringify({ lane, ...record, main: root }, null, 2) + '\n',
  );
  const pack = join(root, '.lanes', lane, 'context.md');
  if (existsSync(pack)) copyFileSync(pack, join(laneDir, 'context.md'));
  const mainSettings = join(root, '.claude', 'settings.local.json');
  const settings = existsSync(mainSettings) ? JSON.parse(readFileSync(mainSettings, 'utf8')) : {};
  settings.env = {
    ...settings.env,
    GR_PORT: String(port),
    ...(sccache ? { RUSTC_WRAPPER: 'sccache' } : {}),
  };
  mkdirSync(join(path, '.claude'), { recursive: true });
  writeFileSync(
    join(path, '.claude', 'settings.local.json'),
    JSON.stringify(settings, null, 2) + '\n',
  );

  if (!flags['no-install']) {
    const log = join(laneDir, 'npm-ci.log');
    console.log(`npm ci in ${path} (log: ${log})`);
    const fd = openSync(log, 'w');
    // One command string: npm is a .cmd shim on Windows and needs a shell (args + shell: DEP0190).
    const r = spawnSync('npm ci --no-audit --no-fund', {
      cwd: path,
      shell: true,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    if (r.status !== 0)
      fail(`npm ci failed (exit ${r.status}), see ${log}; the lane exists: rerun or remove it`);
  }
  console.log(
    `lane ${lane}: ${path} · ${branch} from ${base.slice(0, 7)} · GR_PORT ${port} · ` +
      (rust
        ? `Rust in its own src-tauri/target${sccache ? ' with sccache' : ' (no sccache on PATH: first build takes minutes)'}`
        : 'no Rust (--owns has no src-tauri/)') +
      (existsSync(pack) ? ' · context pack copied' : ' · no context pack yet'),
  );
}

function laneState(name, r) {
  const exists = existsSync(r.path);
  const tip = tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${r.branch}`]);
  const count = (range) => Number(git(['rev-list', '--count', range]));
  const commits = tip ? count(`${r.base}..${r.branch}`) : 0;
  const ahead = tip ? count(`HEAD..${r.branch}`) : 0;
  const dirty = exists ? statusPaths(git(['status', '--porcelain', '-uall'], r.path)) : [];
  const committed = tip ? lines(git(['diff', '--name-only', `${r.base}...${r.branch}`])) : [];
  const changed = [...new Set([...committed, ...dirty])];
  const report =
    [join(r.path, '.lanes', name, 'report.md'), join(root, '.lanes', name, 'report.md')].find(
      existsSync,
    ) ?? null;
  return {
    lane: name,
    ...r,
    exists,
    commits,
    ahead,
    merged: commits > 0 && ahead === 0,
    dirty: dirty.length,
    changed,
    outside: outsideOwns(changed, r.owns),
    report,
  };
}

function list() {
  const states = Object.entries(readRegistry()).map(([name, r]) => laneState(name, r));
  const shared = overlaps(Object.fromEntries(states.map((s) => [s.lane, s.changed])));
  if (flags.json) {
    console.log(JSON.stringify({ lanes: states, overlaps: shared }, null, 2));
    return;
  }
  if (!states.length) {
    console.log('No lanes. Create one: node tools/lanes.mjs create <lane> --owns "<globs>"');
    return;
  }
  const rows = [
    ['lane', 'branch', 'port', 'rust', 'commits', 'ahead', 'dirty', 'merged', 'report'],
  ];
  for (const s of states) {
    rows.push([
      s.exists ? s.lane : `${s.lane} (worktree missing)`,
      s.branch,
      String(s.port),
      s.rust ? 'yes' : 'no',
      String(s.commits),
      String(s.ahead),
      String(s.dirty),
      s.merged ? 'yes' : 'no',
      s.report ? 'yes' : '-',
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '));
  for (const s of states.filter((x) => x.outside.length))
    console.log(`outside owns · ${s.lane}: ${s.outside.join(', ')}`);
  for (const [file, owners] of shared) console.log(`overlap · ${file}: ${owners.join(', ')}`);
}

function remove() {
  const registry = readRegistry();
  const r = registry[lane];
  if (!r) fail(`No lane ${lane}. Lanes: ${Object.keys(registry).join(', ') || 'none'}`);
  if (existsSync(r.path)) {
    const dirty = statusPaths(git(['status', '--porcelain', '-uall'], r.path));
    if (dirty.length && !flags.force)
      fail(`Lane ${lane} has ${dirty.length} uncommitted change(s); commit them or pass --force`);
    const report = join(r.path, '.lanes', lane, 'report.md');
    if (existsSync(report)) {
      mkdirSync(join(root, '.lanes', lane), { recursive: true });
      copyFileSync(report, join(root, '.lanes', lane, 'report.md'));
      console.log(`report copied to .lanes/${lane}/report.md`);
    }
    git(['worktree', 'remove', ...(flags.force ? ['--force'] : []), r.path]);
  }
  git(['worktree', 'prune']);
  delete registry[lane];
  writeRegistry(registry);
  console.log(`lane ${lane} removed (${r.path})`);
  if (flags['delete-branch']) {
    try {
      git(['branch', flags.force ? '-D' : '-d', r.branch]);
      console.log(`branch ${r.branch} deleted`);
    } catch (e) {
      fail(`Branch ${r.branch} kept: ${String(e.stderr ?? e.message).trim()}`);
    }
  }
}

if (command === 'create') await create();
else if (command === 'list') list();
else if (command === 'remove') remove();
else {
  console.error(
    'Usage: lanes.mjs create <lane> --owns "<globs>" [--branch m3/<lane>] [--base HEAD] [--no-install]\n' +
      '       lanes.mjs list [--json]\n' +
      '       lanes.mjs remove <lane> [--force] [--delete-branch]',
  );
  process.exit(2);
}
