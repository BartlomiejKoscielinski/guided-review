#!/usr/bin/env node
// Autopilot role prompt (docs/process/AUTOPILOT.md §5, autopilot SKILL step d): prints
// .claude/autopilot/roles/_common.md + the role file with every {{field}} filled from
// docs/process/backlog.json, .autopilot/run.json, the worktree and .autopilot/items/<item>/ (with
// its attempt-N folders, the earlier attempts).
// Exit 1 when a field the prompt uses stays empty.
//   node tools/autopilot/prompt.mjs tests|implement|review|fix|reflect F-07.2 [--extra '<json>']
//   node tools/autopilot/prompt.mjs plan M4 · node tools/autopilot/prompt.mjs curate|live
//   node tools/autopilot/prompt.mjs tests F-07.3 --ahead F-07.2   (tests ahead in ../gr-ap-2, port 1511; E22)
//   --extra '{"problems": "…"}' overrides or adds fields; --root <dir> reads the data from another checkout (tests).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIN_CHECKOUT, ROLES, composePrompt, promptValues } from './prompt-lib.mjs';
import { aheadPath, worktreePath } from './worktree-lib.mjs';

const tools = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? undefined : argv[i + 1];
};
const [role, id] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const root = flag('root') ? resolve(flag('root')) : tools;
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const json = (p) => {
  const text = read(p);
  return text ? JSON.parse(text) : null;
};
/** The `<name>-N.json` verdicts of a folder in N order, parsed. */
const numbered = (dir, name) =>
  (existsSync(dir) ? readdirSync(dir) : [])
    .map((f) => f.match(new RegExp(`^${name}-(\\d+)\\.json$`)))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => json(join(dir, m[0])));
/** Earlier attempts the conductor moved into `attempt-N` folders of the item. */
const attemptsOf = (itemDir) =>
  (existsSync(itemDir) ? readdirSync(itemDir) : [])
    .map((f) => f.match(/^attempt-(\d+)$/))
    .filter(Boolean)
    .map((m) => {
      const dir = join(itemDir, m[0]);
      return {
        n: Number(m[1]),
        dir,
        impl: json(join(dir, 'impl.json')),
        review: json(join(dir, 'review.json')),
        fixes: numbered(dir, 'fix').length,
        gates: numbered(dir, 'gate'),
      };
    });

try {
  if (!ROLES.includes(role)) {
    console.error(
      `usage: prompt.mjs <${ROLES.join('|')}> <item> [--extra '<json>'] (see the header)`,
    );
    process.exit(2);
  }
  const extra = JSON.parse(flag('extra') ?? '{}');
  const ahead = flag('ahead');
  if (ahead && role !== 'tests') throw new Error('--ahead is only for the tests role');
  // E12: a two-pass item (backlog `split`) runs the implementer as --part core, then --part ui.
  const part = flag('part');
  if (part && (role !== 'implement' || !['core', 'ui'].includes(part)))
    throw new Error('--part core|ui is only for the implement role');
  const run = json(join(root, '.autopilot', 'run.json'));
  const backlog = json(join(root, 'docs', 'process', 'backlog.json'));
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  // The conductor runs on the milestone branch of the main checkout (SKILL step 1): that is the base.
  const base = extra.base ?? (branch.status === 0 ? branch.stdout.trim() : undefined);
  let values;
  if (MAIN_CHECKOUT.includes(role)) {
    const milestone = role === 'plan' ? (id ?? run?.milestone ?? backlog?.milestone) : null;
    values = promptValues({ role, id: milestone, run, base, root, live: backlog?.items, extra });
  } else {
    if (!id) throw new Error(`${role} needs an item id`);
    const item = backlog?.items.find((i) => i.id === id);
    if (!item) throw new Error(`no item ${id} in docs/process/backlog.json`);
    const itemDir = join(root, '.autopilot', 'items', id);
    const files = {
      context: read(join(itemDir, 'context.md')),
      impl: json(join(itemDir, 'impl.json')),
      review: json(join(itemDir, 'review.json')),
      gates: numbered(itemDir, 'gate'),
      attempts: attemptsOf(itemDir),
    };
    values = promptValues({
      role,
      id,
      item,
      run,
      base,
      root,
      wt: ahead ? aheadPath(root) : worktreePath(root),
      itemDir,
      files,
      playbook: json(join(root, 'docs', 'process', 'playbook.json')),
      extra,
      ahead,
      part,
    });
  }
  const roles = join(tools, '.claude', 'autopilot', 'roles');
  const common = readFileSync(join(roles, '_common.md'), 'utf8');
  const roleText = readFileSync(join(roles, `${role}.md`), 'utf8');
  process.stdout.write(composePrompt(common, roleText, values));
} catch (e) {
  console.error(`prompt.mjs ${role} ${id ?? ''}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
