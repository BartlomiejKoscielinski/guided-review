// Autopilot role prompts (docs/process/AUTOPILOT.md §5): `_common.md` + the role file, every
// `{{field}}` filled from the backlog, the run, the worktree and `.autopilot/items/<id>/`.
// Pure functions; I/O in prompt.mjs.
import { RESULTS } from './items-lib.mjs';
import { existing, render } from './playbook-lib.mjs';
import { AHEAD_PORT, AUTOPILOT_PORT, itemSlug } from './worktree-lib.mjs';

export const ROLES = ['plan', 'tests', 'implement', 'review', 'fix', 'reflect', 'curate', 'live'];
/** Roles that work in the main checkout; the others in the autopilot worktree. */
export const MAIN_CHECKOUT = ['plan', 'curate', 'live'];
/** Gate output longer than this is cut in a fix prompt (the full log stays in gate-N.json). */
const MAX_DETAIL = 2000;
/** A reason of an earlier attempt longer than this is cut in the item history. */
const MAX_REASON = 300;

const slash = (p) => String(p).replace(/\\/g, '/');

/** The `{{name}}` fields of a template. */
export function fields(text) {
  return [...new Set([...text.matchAll(/{{(\w+)}}/g)].map((m) => m[1]))];
}

/** Playbook ids the context pack offered (its "## Playbook" section). */
export function offeredIds(contextMd) {
  const section = (contextMd ?? '').split(/^## /m).find((s) => s.startsWith('Playbook')) ?? '';
  return [...section.matchAll(/^- \[(P-\d+)\]/gm)].map((m) => m[1]);
}

/** Paths of the context pack's "## Files" section (`- src/a.ts (120 lines)`). */
export function contextFiles(contextMd) {
  const section = (contextMd ?? '').split(/^## /m).find((s) => s.startsWith('Files')) ?? '';
  return [...section.matchAll(/^- (\S+)/gm)].map((m) => m[1]);
}

/** The backlog items waiting for a live check, one line each: id, criterion, its note. */
export function liveChecks(items) {
  return (items ?? [])
    .filter((i) => i.status === 'live')
    .map((i) => `- ${i.id} ${i.title}${i.note ? ` — ${i.note}` : ''}`)
    .join('\n');
}

/** The exact verify command of an item: its locked e2e specs on the autopilot port, else plain. */
export function verifyCommand(tests, port) {
  const specs = (tests ?? [])
    .map((t) => slash(t).match(/^tests\/e2e\/(.+)\.spec\.ts$/)?.[1])
    .filter(Boolean);
  return specs.length
    ? `GR_PORT=${port} node tools/verify.mjs --e2e ${specs.join(' ')}`
    : 'node tools/verify.mjs';
}

const clip = (s) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL)}\n…` : s);
const indent = (s) => s.replace(/^/gm, '    ');

/** What a fix round fixes: the failed checks of the last gate, else the review's severe and normal findings. */
export function fixProblems({ review, gates }) {
  const gate = gates?.at(-1);
  if (gate) {
    return (gate.checks ?? [])
      .filter((c) => !c.ok)
      .map((c) => `- gate check ${c.name} failed${c.detail ? `:\n${indent(clip(c.detail))}` : ''}`)
      .join('\n');
  }
  const out = (review?.findings ?? [])
    .filter((f) => f.severity === 'severe' || f.severity === 'normal')
    .map((f) => `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} ${f.text}`);
  if (review?.testDispute === 'accept') out.push(`- ${disputeVerdict(review, null)}`);
  return out.join('\n');
}

/** The implementer's dispute (for the reviewer) or the reviewer's verdict on it (for a fix round). */
function disputeVerdict(review, impl) {
  const detail = review?.testDisputeDetail;
  const what = detail ? `${detail.test}: ${detail.reason}` : (impl?.testDispute ?? 'see review');
  if (review?.testDispute === 'accept')
    return `accepted test dispute (change only this test): ${what}`;
  if (review?.testDispute === 'reject') return 'rejected by the reviewer: keep the locked tests';
  return 'none';
}

const cut = (s) => {
  const t = String(s ?? '').trim();
  return t.length > MAX_REASON ? `${t.slice(0, MAX_REASON)}…` : t;
};

/** One earlier attempt (`.autopilot/items/<id>/attempt-N/`) in a line: its verdicts in short. */
function attemptLine({ n, dir, impl, review, fixes = 0, gates = [] }) {
  const parts = [];
  if (impl)
    parts.push(
      impl.complete ? 'implement complete' : `implement partial: ${cut(impl.partialReason)}`,
    );
  if (review) {
    const count = (s) => (review.findings ?? []).filter((f) => f.severity === s).length;
    parts.push(`review ${count('severe')} severe, ${count('normal')} normal`);
  }
  if (fixes) parts.push(`${fixes} fix round${fixes > 1 ? 's' : ''}`);
  if (gates.length) {
    const runs = gates.map((g) =>
      g?.pass
        ? `passed${g.merged ? ` (merged ${g.merged})` : ''}`
        : `failed (${(g?.checks ?? [])
            .filter((c) => !c.ok)
            .map((c) => c.name)
            .join(', ')})`,
    );
    parts.push(`gate ${runs.join(', then ')}`);
  }
  const owner = [impl, review].find((v) => v?.needsOwner)?.needsOwner;
  if (owner) parts.push(`needs owner: ${cut(owner)}`);
  return `- Attempt ${n} (verdicts in ${slash(dir)}/): ${parts.join('; ') || 'no verdicts'}`;
}

/**
 * What the item went through before this attempt: the backlog note (e.g. "live check failed: …",
 * or what PROGRESS says is built) and one line per `attempt-N` folder. The tests, implement and fix
 * prompts start from it, so the conductor never copies it into context.md by hand.
 */
export function itemHistory({ note, attempts = [] }) {
  const lines = [];
  if (note?.trim()) lines.push(`- Item note: ${note.trim()}`);
  for (const a of [...attempts].sort((x, y) => x.n - y.n)) lines.push(attemptLine(a));
  return lines.length ? lines.join('\n') : 'none: first attempt, no note';
}

/**
 * The field values of one role prompt. `item` is the backlog item (null for plan and curate),
 * `files` the parsed contents of `.autopilot/items/<id>/` ({ context, impl, review, gates,
 * attempts: [{ n, dir, impl, review, fixes, gates }] from its `attempt-N` folders }),
 * `live` the backlog items (for the live role), `playbook` docs/process/playbook.json (the reflector
 * compares its lessons with the matching ones), `extra` overrides or adds fields (e.g. `problems`).
 * `ahead` = the item before, for tests written ahead in ../gr-ap-2 (E22): its branch is the base,
 * the port is 1511, and the history says what that means. Missing values stay undefined.
 */
export function promptValues({
  role,
  id,
  item,
  run,
  base,
  root,
  wt,
  itemDir,
  files = {},
  live,
  playbook,
  extra,
  ahead,
}) {
  const port = ahead ? AHEAD_PORT : AUTOPILOT_PORT;
  const from = ahead ? `ap/${itemSlug(ahead)}` : base;
  const common = { role, runId: run?.runId, base: from, port };
  let values;
  if (MAIN_CHECKOUT.includes(role)) {
    const milestone = role === 'plan' ? id : run?.milestone;
    const plan = role === 'plan' && milestone;
    values = {
      ...common,
      // The planner runs before `run.mjs start` (SKILL step 2): no run yet.
      runId: run?.runId ?? (role === 'plan' ? 'not started yet' : undefined),
      milestone,
      item:
        role === 'curate'
          ? 'playbook'
          : plan
            ? `${milestone} plan`
            : role === 'live' && milestone
              ? `${milestone} live checks`
              : undefined,
      kind: 'process',
      title:
        role === 'curate'
          ? 'curate the playbook'
          : plan
            ? `write the plan of ${milestone}`
            : role === 'live'
              ? 'check the waiting criteria in the real app'
              : undefined,
      wt: slash(root),
      branch: base,
      checks: role === 'live' ? liveChecks(live) : undefined,
    };
  } else {
    const tests = item?.tests ?? [];
    values = {
      ...common,
      item: id,
      kind: item?.kind,
      milestone: item?.milestone,
      title: item?.title,
      wt: slash(wt),
      branch: `ap/${itemSlug(id)}`,
      slug: itemSlug(id),
      context: files.context != null ? `${slash(itemDir)}/context.md` : undefined,
      rustPrefix: id.toLowerCase().replace(/-/g, '').replace(/\./g, '_'),
      tests: tests.length ? tests.join(', ') : undefined,
      verify: verifyCommand(tests, port),
      testDispute:
        role === 'review'
          ? (files.impl?.testDispute ?? 'none')
          : disputeVerdict(files.review, files.impl),
      problems: fixProblems(files),
      history: [
        ahead &&
          `- Tests ahead: ap/${itemSlug(id)} starts from ${from}, where ${ahead} is implemented and still in review (a fix round may change it); ${base} is merged in before the implementer of ${id} starts. Test ${id} only, and leave the files ${ahead} changed alone where you can: a merge conflict with its fix round discards your tests.`,
        itemHistory({ note: item?.note, attempts: files.attempts }),
      ]
        .filter(Boolean)
        .join('\n'),
      verdictsDir: slash(itemDir),
      offered: offeredIds(files.context).join(', ') || 'none',
      existing:
        role === 'reflect'
          ? render(
              existing(playbook ?? { entries: [] }, {
                kind: item?.kind,
                paths: [...contextFiles(files.context), ...tests].map(slash),
                offered: offeredIds(files.context),
              }),
            ) || 'none'
          : undefined,
      result: RESULTS.includes(item?.status) ? item.status : undefined,
    };
  }
  // `extra.base` names the milestone branch; tests ahead still start from the item before.
  return { ...values, ...extra, ...(ahead && { base: from }) };
}

/** `_common.md` + the role file, conductor comments removed; throws when a used field is empty. */
export function composePrompt(common, roleText, values) {
  const strip = (t) => t.replace(/^<!--[\s\S]*?-->[ \t]*\r?\n?/gm, '').trim();
  const text = `${strip(common)}\n\n${strip(roleText)}\n`;
  const empty = fields(text).filter((f) => values[f] == null || String(values[f]).trim() === '');
  if (empty.length) throw new Error(`empty fields: ${empty.join(', ')}`);
  return text.replace(/{{(\w+)}}/g, (_, f) => String(values[f]));
}
