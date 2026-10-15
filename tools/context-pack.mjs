#!/usr/bin/env node
// Context pack for a parallel lane (E4): the part of the spec a lane needs, in one file of at most
// ~10k tokens, so the lane session reads it instead of the full docs. Feature sections (acceptance
// criteria) from docs/01-product.md with their lines in docs/PROGRESS.md, screen sections from
// docs/02-screens.md with the mock, PNGs and pending re-renders from docs/design/README.md, and the
// lane's files with their sizes. An ID like F-07.3 keeps only that criterion of the feature. With
// --plan M3: the AC → build → test rows of docs/plans/M3.md and the decisions the pack mentions.
//
//   node tools/context-pack.mjs F-07 S-03 [F-06.9 ...] [--plan M3] [--lane focus-b] [--files a,b] [--max-tokens 10000]
//
// Writes .lanes/<lane>/context.md in the main checkout (lane defaults to the IDs, e.g. f07-s03) and,
// when the lane already exists (tools/lanes.mjs), copies it into the lane's worktree. Over budget it
// prints the size per section and writes nothing: split the lane or pass fewer IDs.
// Autopilot (docs/process/AUTOPILOT.md): --playbook ui,implement adds the matching lessons of
// docs/process/playbook.json (word tags + the --files paths, at most 1.5k tokens) and --out <file>
// writes the pack there instead of .lanes/ (no lane copy).
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContextPack, LANE_NAME, mainCheckout } from './lanes-lib.mjs';
import { render, select } from './autopilot/playbook-lib.mjs';

const root = mainCheckout(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
const flags = {};
const ids = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i] ?? '';
  else ids.push(args[i]);
}
if (!ids.length) {
  console.error(
    'Usage: context-pack.mjs F-07 S-03 [F-06.9 ...] [--plan M3] [--lane name] [--files a,b] [--max-tokens 10000]',
  );
  process.exit(2);
}
const lane =
  flags.lane ??
  ids
    .map((i) =>
      i
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, '')
        .replace('.', '-'),
    )
    .join('-');
if (!LANE_NAME.test(lane)) {
  console.error(`Lane name "${lane}": lowercase letters, digits and dashes (--lane).`);
  process.exit(2);
}
const maxTokens = Number(flags['max-tokens'] ?? 10_000);
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const files = (flags.files ?? '')
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean)
  .map((path) => {
    const full = join(root, path);
    return { path, lines: existsSync(full) ? readFileSync(full, 'utf8').split('\n').length : null };
  });

const pack = buildContextPack({
  lane,
  rawIds: ids,
  docs: {
    product: read('docs/01-product.md'),
    screens: read('docs/02-screens.md'),
    design: read('docs/design/README.md'),
    progress: read('docs/PROGRESS.md'),
    plan: flags.plan ? read(`docs/plans/${flags.plan.toUpperCase()}.md`) : null,
  },
  milestone: flags.plan?.toUpperCase() ?? null,
  pngs: readdirSync(join(root, 'docs', 'design', 'screens')),
  files,
  sha: execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
});

const playbookPath = join(root, 'docs', 'process', 'playbook.json');
if (flags.playbook && existsSync(playbookPath)) {
  const lessons = select(JSON.parse(readFileSync(playbookPath, 'utf8')), {
    tags: flags.playbook.split(',').filter(Boolean),
    paths: files.map((f) => f.path.replace(/\\/g, '/')),
  });
  if (lessons.length) {
    const section = `\n## Playbook (lessons from earlier items)\n\n${render(lessons)}\n`;
    const tokens = Math.ceil(section.length / 4);
    pack.text += section;
    pack.tokens += tokens;
    pack.sections.push({ title: `Playbook (${lessons.length})`, tokens });
  }
}

for (const s of pack.sections) console.log(`  ${String(s.tokens).padStart(6)}  ${s.title}`);
if (pack.missing.length) {
  console.error(`Not found: ${pack.missing.join(', ')}`);
  process.exit(1);
}
if (pack.tokens > maxTokens) {
  console.error(
    `${pack.tokens} tokens > ${maxTokens}: nothing written. Split the lane or pass fewer IDs.`,
  );
  process.exit(1);
}
const out = flags.out ? resolve(flags.out) : join(root, '.lanes', lane, 'context.md');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pack.text);
console.log(`${pack.tokens} tokens → ${out}`);
if (flags.out) process.exit(0);

const registry = join(root, '.lanes', 'lanes.json');
const record = existsSync(registry) ? JSON.parse(readFileSync(registry, 'utf8'))[lane] : null;
if (record && existsSync(record.path)) {
  const copy = join(record.path, '.lanes', lane, 'context.md');
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(out, copy);
  console.log(`copied to ${copy}`);
}
