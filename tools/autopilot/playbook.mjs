#!/usr/bin/env node
// Autopilot playbook CLI (docs/process/playbook.json; docs/process/AUTOPILOT.md §4 B6).
//   node tools/autopilot/playbook.mjs add '{"tags":["ui","src/screens/**"],"text":"…","source":"F-07.2"}'
//   node tools/autopilot/playbook.mjs select --tags ui,implement [--paths a,b] [--max-tokens 1500] [--touch]
//   node tools/autopilot/playbook.mjs rate P-003 helpful|harmful
//   node tools/autopilot/playbook.mjs tick                (one more item done: ages the entries)
//   node tools/autopilot/playbook.mjs curate [--dry-run] | promoted P-003 | list
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEntry, curate, empty, rate, render, select, touch } from './playbook-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = join(root, 'docs', 'process', 'playbook.json');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? null : (argv[i + 1] ?? null);
};
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
          proposals: out.proposals.map((e) => ({ id: e.id, text: e.text })),
        }),
      );
      break;
    }
    case 'promoted': {
      const e = pb.entries.find((x) => x.id === argv[1]);
      if (!e) throw new Error(`no entry ${argv[1]}`);
      e.promoted = true;
      save();
      console.log(`${e.id} promoted`);
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
      console.error('usage: playbook.mjs add|select|rate|tick|curate|promoted|list');
      process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
