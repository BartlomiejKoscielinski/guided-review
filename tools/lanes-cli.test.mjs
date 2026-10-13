// tools/lanes.mjs end to end on a throwaway repository (a path with a space and a Polish letter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'lanes.mjs');
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('E4 lanes: create, list and remove the lane trial (--no-install)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gr lanes ż-'));
  try {
    const repo = join(tmp, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.gitignore'), '.lanes/\n.claude/settings.local.json\n');
    writeFileSync(join(repo, 'src', 'a.ts'), 'export {};\n');
    writeFileSync(
      join(repo, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { deny: ['Artifact'] } }),
    );
    git(repo, 'init', '-q', '-b', 'm3-plan-focus');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'contract');
    const lanes = (...args) =>
      spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' });

    writeFileSync(join(repo, 'src', 'a.ts'), 'export const x = 1;\n');
    let r = lanes('create', 'trial', '--owns', 'src/**', '--no-install');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Commit the contract first[\s\S]*src\/a\.ts/);
    git(repo, 'checkout', '--', 'src/a.ts');

    r = lanes('create', 'trial', '--owns', 'src/**', '--no-install');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /m3\/trial .*GR_PORT \d+ · no Rust/);
    const wt = join(tmp, 'gr-trial');
    const lane = json(join(wt, '.lanes', 'trial', 'lane.json'));
    assert.equal(lane.branch, 'm3/trial');
    assert.equal(lane.rust, false);
    assert.ok(lane.port >= 1421 && lane.port <= 1499);
    const settings = json(join(wt, '.claude', 'settings.local.json'));
    assert.deepEqual(settings.permissions, { deny: ['Artifact'] });
    assert.deepEqual(settings.env, { GR_PORT: String(lane.port) });
    assert.equal(lanes('create', 'trial', '--owns', 'src/**', '--no-install').status, 1);

    writeFileSync(join(wt, 'README.md'), 'outside the lane\n');
    git(wt, 'add', 'README.md');
    git(wt, 'commit', '-q', '-m', 'lane work');
    const listed = JSON.parse(lanes('list', '--json').stdout);
    assert.equal(listed.lanes.length, 1);
    const state = listed.lanes[0];
    assert.equal(state.lane, 'trial');
    assert.equal(state.commits, 1);
    assert.equal(state.ahead, 1);
    assert.equal(state.merged, false);
    assert.deepEqual(state.outside, ['README.md']);
    assert.match(lanes('list').stdout, /outside owns · trial: README\.md/);

    writeFileSync(join(wt, 'src', 'b.ts'), 'export {};\n');
    r = lanes('remove', 'trial');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /uncommitted/);
    unlinkSync(join(wt, 'src', 'b.ts'));

    writeFileSync(join(wt, '.lanes', 'trial', 'report.md'), '# trial\n');
    r = lanes('remove', 'trial');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(wt));
    assert.equal(readFileSync(join(repo, '.lanes', 'trial', 'report.md'), 'utf8'), '# trial\n');
    assert.deepEqual(json(join(repo, '.lanes', 'lanes.json')), {});
    assert.match(git(repo, 'branch', '--list', 'm3/trial'), /m3\/trial/);
    assert.match(lanes('list').stdout, /No lanes/);
  } finally {
    // Not rmSync: on Node 24.13 it silently keeps paths with Polish letters on Windows.
    await rm(tmp, { recursive: true, force: true });
  }
});
