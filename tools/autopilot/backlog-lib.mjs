// Autopilot backlog (docs/process/AUTOPILOT.md §3.1): the open acceptance criteria of a milestone
// as machine-readable items, synced from docs/PROGRESS.md and the plan's AC table, plus the
// provisional decisions of docs/process/DECISIONS-PENDING.md. Pure functions; I/O in backlog.mjs.
import { parseProgress } from '../audit-lib.mjs';

export const STATUSES = [
  'todo',
  'tests',
  'impl',
  'review',
  'done',
  'partial',
  'blocked',
  'needs-owner',
];
/** Statuses the loop may (re)start: a run that stopped mid-item resumes it first. */
const RESUMABLE = ['tests', 'impl', 'review'];
/** More unreviewed provisional decisions than this stop the loop (§3.2). */
export const MAX_PROVISIONAL = 5;

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
 * known items kept; ticked ones become done), plus a rework item per vetoed decision.
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
    items.push({
      id,
      milestone,
      title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
      kind: old?.kind ?? kindOf(rows.get(id)),
      deps: old?.deps ?? [],
      status: old?.status ?? 'todo',
      attempts: old?.attempts ?? 0,
      note: old?.note ?? note,
      ...(old?.lockSha ? { lockSha: old.lockSha, tests: old.tests ?? [] } : {}),
    });
  }
  for (const d of parseDecisions(decisionsMd)) {
    if (d.status !== 'vetoed') continue;
    const old = known.get(d.id);
    items.push(
      old ?? {
        id: d.id,
        milestone,
        title: `Rework after veto: ${d.question}`,
        kind: 'mixed',
        deps: [],
        status: 'todo',
        attempts: 0,
        note: `vetoed: ${d.chosen}; item ${d.item}`,
      },
    );
  }
  return { milestone, updated: now, items };
}

/** The next item to work on, or `{ none: reason }`. */
export function next(backlog, decisions = []) {
  const provisional = decisions.filter((d) => d.status === 'provisional').length;
  if (provisional > MAX_PROVISIONAL) {
    return {
      none: `${provisional} provisional decisions wait for the owner (max ${MAX_PROVISIONAL})`,
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

/** Changes one item; unknown ids or statuses throw. */
export function setItem(backlog, id, { status, note, attempt, lockSha, tests, kind }, now) {
  const item = backlog.items.find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
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

/** Appends a provisional decision row and returns its id (`D-01`, `D-02`, …). */
export function addDecision(md, { date, item, question, chosen, alternatives, reversible }) {
  const ids = parseDecisions(md).map((d) => Number(d.id.slice(2)));
  const id = `D-${String((ids.length ? Math.max(...ids) : 0) + 1).padStart(2, '0')}`;
  const cell = (s) =>
    String(s ?? '')
      .replace(/\|/g, '/')
      .replace(/\r?\n/g, ' ');
  const row = `| ${id} | ${date} | ${cell(item)} | ${cell(question)} | ${cell(chosen)} | ${cell(alternatives)} | ${reversible ? 'yes' : 'no'} | provisional |`;
  return { id, md: `${md.replace(/\s*$/, '')}\n${row}\n` };
}
