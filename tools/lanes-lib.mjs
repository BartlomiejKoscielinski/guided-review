// Helpers for parallel lanes (tools/context-pack.mjs, tools/lanes.mjs; E4 in
// docs/process/IMPROVEMENTS.md): doc sections for a lane's context pack, file ownership by glob,
// dev server ports. Pure except mainCheckout() and laneConfig(); tested in tools/lanes.test.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resultTokens } from './metrics/transcript.mjs';

export const LANE_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
export const FIRST_LANE_PORT = 1421;
export const LAST_LANE_PORT = 1499;

/** The main checkout (not a lane worktree) of the repository that contains `dir`. */
export function mainCheckout(dir) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return dirname(common.trim());
}

/** The lane.json of a lane worktree (tools/lanes.mjs); null in the main checkout, which has none. */
export function laneConfig(dir) {
  const lanes = join(dir, '.lanes');
  if (!existsSync(lanes)) return null;
  for (const name of readdirSync(lanes)) {
    const file = join(lanes, name, 'lane.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  }
  return null;
}

/** The default lane branch: the milestone of the current branch ("m3-plan-focus" → "m3/<lane>"). */
export function laneBranch(current, lane) {
  const m = /^(m\d+)(?!\d)/i.exec(current ?? '');
  return m ? `${m[1].toLowerCase()}/${lane}` : null;
}

/** "F-07", "f07", "F-07.3", "S-03", "s3" → { kind, num, ac }; anything else → null. */
export function parseId(raw) {
  const m = /^([FS])-?(\d{1,2})(?:\.(\d+))?$/i.exec(raw.trim());
  if (!m) return null;
  const kind = m[1].toUpperCase();
  if (kind === 'S' && m[3]) return null;
  return { kind, num: m[2].padStart(2, '0'), ac: m[3] ?? null };
}

/** The heading line matching `headingRe` and everything up to the next heading of its level or higher. */
export function section(text, headingRe) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start < 0) return null;
  const level = (l) => /^(#+) /.exec(l)?.[1].length ?? 0;
  const own = level(lines[start]);
  let end = start + 1;
  while (end < lines.length && !(level(lines[end]) && level(lines[end]) <= own)) end++;
  return lines.slice(start, end).join('\n').trimEnd();
}

/** Groups parsed IDs: features → Set of AC numbers (empty = the whole feature), screens → numbers. */
function groupIds(ids) {
  const features = new Map();
  const screens = [];
  for (const id of ids) {
    if (id.kind === 'S') {
      if (!screens.includes(id.num)) screens.push(id.num);
      continue;
    }
    const acs = features.get(id.num);
    if (!id.ac) features.set(id.num, new Set());
    else if (!acs) features.set(id.num, new Set([id.ac]));
    else if (acs.size) acs.add(id.ac);
  }
  return { features, screens };
}

/** A feature section limited to the chosen acceptance criteria (all when `acs` is empty). */
function featureText(product, num, acs) {
  const text = section(product, new RegExp(`^### F-${num} `));
  if (!text || !acs.size) return text;
  const ac = new RegExp(`^- \\*\\*F-${num}\\.(\\d+)\\*\\*`);
  return text
    .split('\n')
    .filter((l) => !ac.test(l) || acs.has(ac.exec(l)[1]))
    .join('\n');
}

function progressLines(progress, num, acs) {
  const re = new RegExp(`^- \\[[ x]\\] F-${num}\\.(\\d+) `);
  return progress.split(/\r?\n/).filter((l) => re.test(l) && (!acs.size || acs.has(re.exec(l)[1])));
}

/** The design README row of a screen, its mock, PNGs and pending re-renders of that mock. */
function designText(design, num, pngs) {
  const row = design.split(/\r?\n/).find((l) => l.startsWith(`| S-${num} `));
  const mock = row && /`([\w-]+\.dc\.html)`/.exec(row)?.[1];
  const shots = pngs.filter((f) => f.startsWith(`S${num}-`));
  const lines = [];
  if (row) lines.push(`Design: ${row}`);
  if (mock) lines.push(`Mock: docs/design/mocks/${mock}`);
  if (shots.length) lines.push(`PNGs: ${shots.map((f) => `docs/design/screens/${f}`).join(', ')}`);
  const pending = mock ? design.split(/\r?\n/).filter((l) => l.startsWith(`| \`${mock}\``)) : [];
  if (pending.length)
    lines.push('Pending re-renders (the PNG is older than the mock; the mock wins):', ...pending);
  return lines.join('\n');
}

/** IDs the pack mentions but does not contain: pointers the lane may follow if it must. */
function references(text, ids, included) {
  const own = new Set(ids.map((i) => `F-${i.num}`));
  const found = new Set();
  for (const m of text.matchAll(/\bADR-\d{3}\b|\bM\d+ decision \d+\b|\bF-\d\d(?:\.\d+)?\b/g)) {
    const id = m[0];
    if ((id.startsWith('F-') && own.has(id.slice(0, 4))) || included.has(id)) continue;
    found.add(id);
  }
  return [...found].sort();
}

/** True when an AC ID of a plan row ("F-06.4") is part of the selection. */
function selected(acId, features) {
  const [, num, ac] = /^F-(\d\d)\.(\d+)$/.exec(acId) ?? [];
  const acs = num && features.get(num);
  return !!acs && (!acs.size || acs.has(ac));
}

/**
 * From an approved plan (docs/plans/<Mx>.md): the AC → build → test rows of the selected criteria
 * and the decisions that the pack or those rows mention ("M3 decision 4", "decision 7").
 */
function planText(plan, milestone, features, packText) {
  const rows = plan.split(/\r?\n/).filter((l) => {
    const first = /^\| ([^|]+)\|/.exec(l)?.[1] ?? '';
    return [...first.matchAll(/F-\d\d\.\d+/g)].some((m) => selected(m[0], features));
  });
  const nums = new Set();
  const mentions = [packText, ...rows].join('\n');
  for (const m of mentions.matchAll(/\b(?:(M\d+) )?decisions? (\d+)\b/g)) {
    if (!m[1] || m[1] === milestone) nums.add(m[2]);
  }
  const decisions = (section(plan, /^## Decisions/) ?? '')
    .split('\n')
    .filter((l) => nums.has(/^(\d+)\. /.exec(l)?.[1]));
  return { rows, decisions, included: new Set([...nums].map((n) => `${milestone} decision ${n}`)) };
}

/**
 * Builds a lane's context pack.
 * docs: { product, screens, design, progress, plan? } (file texts; plan = docs/plans/<milestone>.md);
 * pngs: names in docs/design/screens;
 * files: [{ path, lines }] (lines null for a file that does not exist yet).
 * Returns { text, tokens, sections: [{ title, tokens }], missing: [raw IDs not found] }.
 */
export function buildContextPack({
  lane,
  rawIds,
  docs,
  milestone = null,
  pngs = [],
  files = [],
  sha = '',
}) {
  const ids = rawIds.map(parseId);
  const missing = rawIds.filter((_, i) => !ids[i]);
  const valid = ids.filter(Boolean);
  const { features, screens } = groupIds(valid);
  const sections = [];

  const feat = [];
  for (const [num, acs] of features) {
    const text = featureText(docs.product, num, acs);
    if (!text) {
      missing.push(`F-${num}`);
      continue;
    }
    const status = progressLines(docs.progress, num, acs);
    feat.push(text, '', ...(status.length ? ['Status in docs/PROGRESS.md:', ...status, ''] : []));
  }
  if (feat.length)
    sections.push({ title: 'Features and acceptance criteria (docs/01-product.md)', body: feat });

  const scr = [];
  for (const num of screens) {
    const text = section(docs.screens, new RegExp(`^## S-${num} `));
    if (!text) {
      missing.push(`S-${num}`);
      continue;
    }
    scr.push(text.replace(/^## /, '### '), '', designText(docs.design, num, pngs), '');
  }
  if (scr.length)
    sections.push({ title: 'Screens (docs/02-screens.md, docs/design/README.md)', body: scr });

  let included = new Set();
  if (docs.plan && milestone) {
    const plan = planText(docs.plan, milestone, features, [...feat, ...scr].join('\n'));
    included = plan.included;
    const body = [];
    if (plan.rows.length) body.push('| AC | Build | Test |', '| - | - | - |', ...plan.rows, '');
    if (plan.decisions.length) body.push(`${milestone} decisions:`, '', ...plan.decisions, '');
    if (body.length) sections.push({ title: `Approved plan (docs/plans/${milestone}.md)`, body });
  }

  const refs = references([...feat, ...scr].join('\n'), valid, included);
  if (refs.length) {
    sections.push({
      title: 'Mentioned, not included (open only if the task needs it)',
      body: [
        refs.join(' · '),
        'ADR-xxx: docs/08-decisions.md · Mx decision n: docs/plans/Mx.md › Decisions · F-xx: docs/01-product.md',
        '',
      ],
    });
  }
  if (files.length) {
    const list = files.map(
      (f) => `- ${f.path}${f.lines === null ? ' (new)' : ` (${f.lines} lines)`}`,
    );
    sections.push({ title: 'Files', body: [...list, ''] });
  }

  const head = [
    `# Context pack · lane ${lane}`,
    '',
    `${rawIds.join(' ')}${sha ? ` at ${sha}` : ''} (tools/context-pack.mjs). This is the spec for the lane: read it instead`,
    'of docs/01 and docs/02. Mocks and PNGs: open crops only. Other docs: only the sections named here.',
    '',
  ];
  const parts = sections.map((s) => ({
    title: s.title,
    text: [`## ${s.title}`, '', ...s.body].join('\n'),
  }));
  const text = [...head, ...parts.map((p) => p.text)].join('\n').trimEnd() + '\n';
  return {
    text,
    tokens: resultTokens(text),
    sections: parts.map((p) => ({ title: p.title, tokens: resultTokens(p.text) })),
    missing,
  };
}

/** A glob over repo-relative paths (`*`, `**`, `?`; a trailing `/` means the whole directory). */
export function globToRegExp(glob) {
  const g = glob.replace(/\\/g, '/').replace(/\/$/, '/**');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i++;
      if (g[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** True when a lane's globs reach the Rust core; only such a lane builds src-tauri (its own target). */
export function ownsRust(globs) {
  const probes = ['src-tauri/src/lib.rs', 'src-tauri/Cargo.toml'];
  return globs.some((g) => {
    const glob = g.replace(/\\/g, '/');
    return /^src-tauri(\/|$)/.test(glob) || probes.some((p) => globToRegExp(glob).test(p));
  });
}

export function outsideOwns(files, globs) {
  const res = globs.map(globToRegExp);
  return files.filter((f) => !res.some((r) => r.test(f.replace(/\\/g, '/'))));
}

/** Files changed by more than one lane: [[file, [lanes]]]. `changed`: { lane: [files] }. */
export function overlaps(changed) {
  const byFile = new Map();
  for (const [lane, files] of Object.entries(changed)) {
    for (const f of files) byFile.set(f, [...(byFile.get(f) ?? []), lane]);
  }
  return [...byFile].filter(([, lanes]) => lanes.length > 1);
}

/** The first lane port not taken by another lane and not `busy` (a port something listens on). */
export async function pickPort(taken, busy) {
  for (let p = FIRST_LANE_PORT; p <= LAST_LANE_PORT; p++) {
    if (!taken.has(p) && !(await busy(p))) return p;
  }
  return null;
}
