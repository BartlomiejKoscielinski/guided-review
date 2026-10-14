// Autopilot backlog (docs/process/AUTOPILOT.md §3.1): the open acceptance criteria of a milestone
// as machine-readable items, synced from docs/PROGRESS.md and the plan's AC table, plus the
// provisional decisions of docs/process/DECISIONS-PENDING.md. Pure functions; I/O in backlog.mjs.
import { parseProgress } from '../audit-lib.mjs';
import { isTest, tickProgress } from './gate-lib.mjs';

export const STATUSES = [
  'todo',
  'tests',
  'impl',
  'review',
  'done',
  'partial',
  // Built; only the live check in `tauri dev` is left (the live role in "Closing" does it).
  'live',
  'blocked',
  'needs-owner',
];
/** Statuses the loop may (re)start: a run that stopped mid-item resumes it first. */
const RESUMABLE = ['tests', 'impl', 'review'];
/** More items than this with an unreviewed provisional decision row stop the loop (§3.2). */
export const MAX_PENDING_ITEMS = 5;

/** `| F-07.2 | build | test |` rows of a plan's AC table: id → { build, test }. */
export function planRows(planMd) {
  const rows = new Map();
  for (const line of (planMd ?? '').split(/\r?\n/)) {
    const m = line.match(/^\| (F-\d\d\.\d+) \| (.*?) \| (.*?) \|\s*$/);
    if (m) rows.set(m[1], { build: m[2].trim(), test: m[3].trim() });
  }
  return rows;
}

/** ui | core | mixed from the plan row's test column (the conductor may override with --kind). */
export function kindOf(row) {
  const t = row?.test ?? '';
  const ui = /vitest|e2e|design-check|playwright/i.test(t);
  const core = /\bf\d\d_|cargo|rust|unit\b/i.test(t);
  if (ui && !core) return 'ui';
  if (core && !ui) return 'core';
  return 'mixed';
}

/** The criterion text of a PROGRESS line without the "— partial: …" note. */
function titleAndNote(progressMd, id) {
  const line = progressMd.split(/\r?\n/).find((l) => l.startsWith(`- [ ] ${id} `));
  if (!line) return { title: '', note: '' };
  const rest = line.slice(`- [ ] ${id} `.length);
  const [title, note = ''] = rest.split(' — partial: ');
  return { title: title.trim(), note: note.trim() };
}

/** Whether a PROGRESS partial note leaves only a live check open (`…; open: live check in `tauri dev``). */
export function liveOnly(note) {
  return /(^|; )open: live check\b[^;]*$/.test(note ?? '');
}

/** PROGRESS with the line of a live-checked criterion ticked with the commits its partial note names. */
export function liveTick(progressMd, id) {
  const { title, note } = titleAndNote(progressMd, id);
  if (!title) throw new Error(`PROGRESS has no open line for ${id}`);
  if (!/\b[0-9a-f]{7,12}\b/.test(note))
    throw new Error(`no commit SHA in the PROGRESS note of ${id}: tick it by hand`);
  return tickProgress(progressMd, id, [], true);
}

/** Provisional decisions: `| D-01 | date | item | question | chosen | alternatives | reversible | status |`. */
export function parseDecisions(md) {
  const rows = [];
  for (const line of (md ?? '').split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    if (!/^D-\d+$/.test(cells[1] ?? '')) continue;
    rows.push({
      id: cells[1],
      date: cells[2],
      item: cells[3],
      question: cells[4],
      chosen: cells[5],
      alternatives: cells[6],
      reversible: cells[7],
      status: cells[8],
    });
  }
  return rows;
}

/**
 * New backlog for `milestone`: every open PROGRESS criterion of it (statuses, attempts and notes of
 * known items kept; ticked ones become done; todo ones whose note leaves only a live check become
 * live), plus a rework item per vetoed decision.
 */
export function sync({ progressMd, planMd, decisionsMd, milestone, previous, now }) {
  const known = new Map((previous?.items ?? []).map((i) => [i.id, i]));
  const rows = planRows(planMd);
  const items = [];
  for (const [id, p] of parseProgress(progressMd)) {
    if (p.milestone !== milestone) continue;
    const old = known.get(id);
    if (p.done) {
      if (old) items.push({ ...old, status: 'done' });
      continue;
    }
    const { title, note } = titleAndNote(progressMd, id);
    // A failed live check stays todo until the loop fixed it (the conductor sets it live again).
    const waitsForLive = liveOnly(note) && !/^live check failed\b/.test(old?.note ?? '');
    items.push({
      id,
      milestone,
      title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
      kind: old?.kind ?? kindOf(rows.get(id)),
      deps: old?.deps ?? [],
      status: old && old.status !== 'todo' ? old.status : waitsForLive ? 'live' : 'todo',
      attempts: old?.attempts ?? 0,
      note: old?.note ?? note,
      ...(old?.lockSha ? { lockSha: old.lockSha, tests: old.tests ?? [] } : {}),
    });
  }
  for (const d of parseDecisions(decisionsMd)) {
    // `vetoed` or `vetoed (2)`: the whole row or only the points named.
    if (!/^vetoed\b/.test(d.status ?? '')) continue;
    const old = known.get(d.id);
    const title = `Rework after veto: ${d.question}`;
    items.push(
      old ?? {
        id: d.id,
        milestone,
        title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
        kind: 'mixed',
        deps: [],
        status: 'todo',
        attempts: 0,
        note: `${d.status}: ${d.chosen}; item ${d.item}`,
      },
    );
  }
  return { milestone, updated: now, items };
}

/** The next item to work on, or `{ none: reason }`. */
export function next(backlog, decisions = []) {
  const pending = new Set(decisions.filter((d) => d.status === 'provisional').map((d) => d.item));
  if (pending.size > MAX_PENDING_ITEMS) {
    return {
      none: `${pending.size} items with provisional decisions wait for the owner (max ${MAX_PENDING_ITEMS})`,
    };
  }
  const items = backlog?.items ?? [];
  const done = new Set(items.filter((i) => i.status === 'done').map((i) => i.id));
  const ready = (i) => i.deps.every((d) => done.has(d));
  const resume = items.find((i) => RESUMABLE.includes(i.status) && ready(i));
  if (resume) return resume;
  const todo = items.find((i) => i.status === 'todo' && ready(i));
  if (todo) return todo;
  return { none: `no ready item in ${backlog?.milestone ?? 'the backlog'}` };
}

/** Changes one item; unknown ids or statuses, and locked "tests" that are not test files, throw. */
export function setItem(backlog, id, { status, note, attempt, lockSha, tests, kind }, now) {
  const item = backlog.items.find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  // Production files a test author touched (module wiring) stay unlocked: the implementer changes them.
  const notTests = (tests ?? []).filter((t) => !isTest(t));
  if (notTests.length) throw new Error(`not test files, lock only tests: ${notTests.join(', ')}`);
  if (status !== undefined) {
    if (!STATUSES.includes(status))
      throw new Error(`status ${status}: one of ${STATUSES.join(', ')}`);
    item.status = status;
  }
  if (note !== undefined) item.note = note;
  if (attempt) item.attempts += 1;
  if (lockSha !== undefined) item.lockSha = lockSha;
  if (tests !== undefined) item.tests = tests;
  if (kind !== undefined) item.kind = kind;
  backlog.updated = now;
  return item;
}

const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '/')
    .replace(/<br\s*\/?>|\r?\n/gi, ' ')
    .trim();

/** The points of a cell, `(1) a<br>(2) b` → ['a', 'b']; an unnumbered cell is one point. */
export function points(text) {
  const t = String(text ?? '').trim();
  return t ? t.split('<br>').map((p) => p.trim().replace(/^\(\d+\)\s*/, '')) : [];
}

const numbered = (list) => list.map((p, i) => `(${i + 1}) ${p || '-'}`).join('<br>');
/** `yes` or `no` when all points agree, else one per point. */
const reversibleCell = (list) => (new Set(list).size === 1 ? list[0] : numbered(list));

/**
 * Files the decisions of one item (§3.2): one row per item, each question a point (1), (2), … of
 * its cells. An item with a provisional row gets the new points appended (questions it already has
 * are skipped); else a new row `D-nn`. Returns { id, md, added, appended }.
 */
export function addDecisions(md, { date, item, decisions }) {
  if (!item || !Array.isArray(decisions))
    throw new Error('decision needs item and decisions: [{ question, chosen, … }]');
  if (decisions.some((d) => !d.question || !d.chosen))
    throw new Error('every decision needs question and chosen');
  const rows = parseDecisions(md);
  const open = rows.find((d) => d.item === item && d.status === 'provisional');
  const list = [];
  if (open) {
    const [q, c, a, r] = [open.question, open.chosen, open.alternatives, open.reversible].map(
      points,
    );
    q.forEach((question, i) =>
      list.push({
        question,
        chosen: c[i] ?? '',
        alternatives: a[i] ?? '',
        reversible: r[i] ?? r[0],
      }),
    );
  }
  const seen = new Set(list.map((p) => p.question.toLowerCase()));
  let added = 0;
  for (const d of decisions) {
    const question = cell(d.question);
    if (seen.has(question.toLowerCase())) continue;
    seen.add(question.toLowerCase());
    list.push({
      question,
      chosen: cell(d.chosen),
      alternatives: cell(d.alternatives),
      reversible: d.reversible === false ? 'no' : 'yes',
    });
    added += 1;
  }
  if (!added) return { id: open?.id ?? null, md, added, appended: false };
  const ids = rows.map((d) => Number(d.id.slice(2)));
  const id = open?.id ?? `D-${String((ids.length ? Math.max(...ids) : 0) + 1).padStart(2, '0')}`;
  const col = (key) => numbered(list.map((p) => p[key]));
  const row = `| ${id} | ${open?.date ?? date} | ${cell(item)} | ${col('question')} | ${col('chosen')} | ${col('alternatives')} | ${reversibleCell(list.map((p) => p.reversible))} | provisional |`;
  if (!open) return { id, md: `${md.replace(/\s*$/, '')}\n${row}\n`, added, appended: false };
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => l.split('|')[1]?.trim() === id);
  lines[at] = row;
  return { id, md: lines.join('\n'), added, appended: true };
}
