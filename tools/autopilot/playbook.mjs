#!/usr/bin/env node
// Autopilot playbook CLI (docs/process/playbook.json; docs/process/AUTOPILOT.md §4 B6).
//   node tools/autopilot/playbook.mjs add '{"tags":["ui","src/screens/**"],"text":"…","source":"F-07.2"}'
//   node tools/autopilot/playbook.mjs add '{"same":"P-003","tags":["core"],"source":"F-07.2"}'   (an existing lesson again: seen + 1)
//   node tools/autopilot/playbook.mjs select --tags ui,implement [--paths a,b] [--max-tokens 1500] [--touch]
//   node tools/autopilot/playbook.mjs rate P-003 helpful|harmful
//   node tools/autopilot/playbook.mjs tick                (one more item done: ages the entries)
//   node tools/autopilot/playbook.mjs curate [--dry-run] | list
//   node tools/autopilot/playbook.mjs merge P-003 P-018   (same advice: P-018's counts and tags into P-003, P-018 deleted)
//   node tools/autopilot/playbook.mjs promote P-003 implement "<one-line rule>"
//     (a rule proposal into the "## Rules learned" list of .claude/autopilot/roles/implement.md, entry
//     marked promoted: the curator's only way to write a role file, through the allowed node tools/autopilot/* rule)
//   node tools/autopilot/playbook.mjs hold P-005,P-013 "<reason>"   (never a rule proposal: another rule replaces them)
//   --root <dir> reads and writes another checkout (tests).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addEntry,
  addRule,
  curate,
  empty,
  hold,
  merge,
  promote,
  rate,
  render,
  select,
  touch,
} from './playbook-lib.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? null : (argv[i + 1] ?? null);
};
const root = flag('root')
  ? resolve(flag('root'))
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(root, 'docs', 'process', 'playbook.json');
const list = (name) => (flag(name) ?? '').split(',').filter(Boolean);
const pb = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : empty();
const save = () => writeFileSync(FILE, `${JSON.stringify(pb, null, 2)}\n`);

try {
  switch (argv[0]) {
    case 'add': {
      const out = addEntry(pb, JSON.parse(argv[1] ?? '{}'), new Date().toISOString());
      save();
      console.log(JSON.stringify(out));
      break;
    }
    case 'select': {
      const chosen = select(
        pb,
        { tags: list('tags'), paths: list('paths') },
        Number(flag('max-tokens') ?? 1500),
      );
      if (argv.includes('--touch')) {
        touch(
          pb,
          chosen.map((e) => e.id),
        );
        save();
      }
      console.log(render(chosen));
      break;
    }
    case 'rate':
      rate(pb, argv[1], argv[2]);
      save();
      console.log(`${argv[1]} ${argv[2]}`);
      break;
    case 'tick':
      pb.items += 1;
      save();
      console.log(`items: ${pb.items}`);
      break;
    case 'curate': {
      const out = curate(pb);
      if (!argv.includes('--dry-run')) save();
      console.log(
        JSON.stringify({
          removed: out.removed,
          proposals: out.proposals.map((e) => ({
            id: e.id,
            helpful: e.helpful,
            seen: e.seen,
            text: e.text,
          })),
        }),
      );
      break;
    }
    case 'merge': {
      const e = merge(pb, argv[1], argv[2]);
      save();
      console.log(`${argv[2]} merged into ${e.id}: +${e.helpful} -${e.harmful} ×${e.seen}`);
      break;
    }
    case 'hold': {
      hold(pb, (argv[1] ?? '').split(',').filter(Boolean), argv[2]);
      save();
      console.log(`on hold: ${argv[1]}`);
      break;
    }
    case 'promote': {
      const [, id, role, rule] = argv;
      const e = promote(pb, id, role);
      const file = join(root, '.claude', 'autopilot', 'roles', `${role}.md`);
      writeFileSync(file, addRule(readFileSync(file, 'utf8'), e.id, rule));
      save();
      console.log(`${e.id} promoted into .claude/autopilot/roles/${role}.md`);
      break;
    }
    case 'list':
      for (const e of pb.entries) {
        console.log(
          `${e.id} +${e.helpful} -${e.harmful} ×${e.seen} [${e.tags.join(',')}] ${e.text.slice(0, 90)}`,
        );
      }
      break;
    default:
      console.error('usage: playbook.mjs add|select|rate|tick|curate|merge|hold|promote|list');
      process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
