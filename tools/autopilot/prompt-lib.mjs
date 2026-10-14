// Autopilot role prompts (docs/process/AUTOPILOT.md §5): `_common.md` + the role file, every
// `{{field}}` filled from the backlog, the run, the worktree and `.autopilot/items/<id>/`.
// Pure functions; I/O in prompt.mjs.
import { AUTOPILOT_PORT, itemSlug } from './worktree-lib.mjs';

export const ROLES = ['plan', 'tests', 'implement', 'review', 'fix', 'reflect', 'curate'];
/** Roles that work in the main checkout; the others in the autopilot worktree. */
const MAIN_CHECKOUT = ['plan', 'curate'];
/** Item results the reflector learns from (backlog statuses after the gate). */
const RESULTS = ['done', 'partial', 'blocked', 'needs-owner'];
/** Gate output longer than this is cut in a fix prompt (the full log stays in gate-N.json). */
const MAX_DETAIL = 2000;

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

/**
 * The field values of one role prompt. `item` is the backlog item (null for plan and curate),
 * `files` the parsed contents of `.autopilot/items/<id>/` ({ context, impl, review, gates }),
 * `extra` overrides or adds fields (e.g. `problems`). Missing values stay undefined.
 */
export function promptValues({ role, id, item, run, base, root, wt, itemDir, files = {}, extra }) {
  const port = AUTOPILOT_PORT;
  const common = { role, runId: run?.runId, base, port };
  let values;
  if (MAIN_CHECKOUT.includes(role)) {
    const milestone = role === 'plan' ? id : run?.milestone;
    const plan = role === 'plan' && milestone;
    values = {
      ...common,
      // The planner runs before `run.mjs start` (SKILL step 2): no run yet.
      runId: run?.runId ?? (role === 'plan' ? 'not started yet' : undefined),
      milestone,
      item: role === 'curate' ? 'playbook' : plan ? `${milestone} plan` : undefined,
      kind: 'process',
      title:
        role === 'curate'
          ? 'curate the playbook'
          : plan
            ? `write the plan of ${milestone}`
            : undefined,
      wt: slash(root),
      branch: base,
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
      context: files.context != null ? `${slash(itemDir)}/context.md` : undefined,
      rustPrefix: id.toLowerCase().replace(/-/g, '').replace(/\./g, '_'),
      tests: tests.length ? tests.join(', ') : undefined,
      verify: verifyCommand(tests, port),
      testDispute:
        role === 'review'
          ? (files.impl?.testDispute ?? 'none')
          : disputeVerdict(files.review, files.impl),
      problems: fixProblems(files),
      verdictsDir: slash(itemDir),
      offered: offeredIds(files.context).join(', ') || 'none',
      result: RESULTS.includes(item?.status) ? item.status : undefined,
    };
  }
  return { ...values, ...extra };
}

/** `_common.md` + the role file, conductor comments removed; throws when a used field is empty. */
export function composePrompt(common, roleText, values) {
  const strip = (t) => t.replace(/^<!--[\s\S]*?-->[ \t]*\r?\n?/gm, '').trim();
  const text = `${strip(common)}\n\n${strip(roleText)}\n`;
  const empty = fields(text).filter((f) => values[f] == null || String(values[f]).trim() === '');
  if (empty.length) throw new Error(`empty fields: ${empty.join(', ')}`);
  return text.replace(/{{(\w+)}}/g, (_, f) => String(values[f]));
}
