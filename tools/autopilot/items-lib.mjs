// Autopilot outcome metrics (docs/process/AUTOPILOT.md §1, §4 B7): one row per item attempt in
// .metrics/items.jsonl, and the judge that keeps or reverts a process experiment. Pure functions.

/** Higher is better for rates, lower for costs and defects. */
export const METRICS = {
  gateFirstPass: { better: 'higher', of: (r) => (r.gateFirstPass ? 1 : 0) },
  done: { better: 'higher', of: (r) => (r.result === 'done' ? 1 : 0) },
  tokens: { better: 'lower', of: (r) => r.tokens?.total ?? 0 },
  severe: { better: 'lower', of: (r) => r.findings?.severe ?? 0 },
  rounds: { better: 'lower', of: (r) => r.rounds ?? 0 },
  wallMin: { better: 'lower', of: (r) => r.wallMin ?? 0 },
};
/** A change this much worse (relative; absolute for rates) is reverted. */
const WORSE = 0.1;

const ROLE_OF = (name) => name.replace(/-\d+$/, '');

/**
 * The row of one item attempt from its verdict files (`tests`, `impl`, `review`, `fix-1`, `gate-1`,
 * `reflect`…, each with an optional `tokens` number the conductor copied from the Agent result).
 */
export function buildRow({ item, run, result, verdicts, startedAt, endedAt }) {
  const tokens = { total: 0 };
  for (const [name, v] of Object.entries(verdicts)) {
    const n = Number(v?.tokens ?? 0);
    if (!n) continue;
    const role = ROLE_OF(name);
    tokens[role] = (tokens[role] ?? 0) + n;
    tokens.total += n;
  }
  const findings = { severe: 0, normal: 0, nit: 0 };
  for (const f of verdicts.review?.findings ?? []) {
    if (f.severity in findings) findings[f.severity] += 1;
  }
  const gates = Object.keys(verdicts)
    .filter((k) => /^gate-\d+$/.test(k))
    .sort();
  return {
    ts: endedAt,
    run,
    item,
    result,
    gateFirstPass: verdicts['gate-1']?.pass === true,
    gates: gates.length,
    rounds: Object.keys(verdicts).filter((k) => /^fix-\d+$/.test(k)).length,
    findings,
    testDispute: verdicts.review?.testDispute ?? null,
    decisions: (verdicts.impl?.decisions ?? []).length + (verdicts.tests?.decisions ?? []).length,
    tokens,
    wallMin: startedAt
      ? Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 6000) / 10
      : null,
  };
}

export function parseRows(jsonl) {
  return jsonl
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Keep or revert an experiment started at `since` (ISO): the metric's mean over the first `k` rows
 * after it against the last `k` before it. `wait` until both sides have `k` rows.
 */
export function judge(rows, { since, metric, k = 5 }) {
  const m = METRICS[metric];
  if (!m) throw new Error(`metric: one of ${Object.keys(METRICS).join(', ')}`);
  const sorted = [...rows].sort((a, b) => a.ts.localeCompare(b.ts));
  const before = sorted
    .filter((r) => r.ts < since)
    .slice(-k)
    .map(m.of);
  const after = sorted
    .filter((r) => r.ts >= since)
    .slice(0, k)
    .map(m.of);
  if (before.length < k || after.length < k) {
    return {
      metric,
      verdict: 'wait',
      before: mean(before),
      after: mean(after),
      n: [before.length, after.length],
    };
  }
  const b = mean(before);
  const a = mean(after);
  const rate = metric === 'gateFirstPass' || metric === 'done';
  const delta = rate ? a - b : b === 0 ? a - b : (a - b) / b;
  const worse = m.better === 'higher' ? delta < -WORSE : delta > WORSE;
  return { metric, verdict: worse ? 'revert' : 'keep', before: b, after: a, n: [k, k] };
}

/** Means of every metric over the rows (of one run when given). */
export function summary(rows, run = null) {
  const pick = run ? rows.filter((r) => r.run === run) : rows;
  const out = { items: pick.length };
  for (const [name, m] of Object.entries(METRICS)) out[name] = mean(pick.map(m.of));
  return out;
}
