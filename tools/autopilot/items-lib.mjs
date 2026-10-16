// Autopilot outcome metrics (docs/process/AUTOPILOT.md §1, §4 B7): one row per item attempt in
// .metrics/items.jsonl, and the judge that keeps or reverts a process experiment. Pure functions.

/**
 * Results of an item attempt (the backlog status after the gate): `live` = built and merged, only
 * the check in the real app is left (the live role in "Closing" does it).
 */
export const RESULTS = ['done', 'partial', 'live', 'blocked', 'needs-owner'];

/** Higher is better for rates, lower for costs and defects. */
export const METRICS = {
  gateFirstPass: { better: 'higher', of: (r) => (r.gateFirstPass ? 1 : 0) },
  done: { better: 'higher', of: (r) => (r.result === 'done' ? 1 : 0) },
  tokens: { better: 'lower', of: (r) => r.tokens?.total ?? 0 },
  severe: { better: 'lower', of: (r) => r.findings?.severe ?? 0 },
  rounds: { better: 'lower', of: (r) => r.rounds ?? 0 },
  wallMin: { better: 'lower', of: (r) => r.wallMin ?? 0 },
  // E22: an accepted dispute means the locked tests were wrong.
  disputes: { better: 'lower', of: (r) => (r.testDispute === 'accept' ? 1 : 0) },
};
/** A change this much worse (relative; absolute for rates) is reverted. */
const WORSE = 0.1;

const ROLE_OF = (name) => name.replace(/-\d+$/, '');
/** Agent descriptions name the implementer `implement`; its verdict file is `impl`. */
const ROLE_ALIAS = { implement: 'impl' };

/**
 * Tokens per role from the role subagents' transcripts: `subagents` = [{ description, start,
 * totals }] (`description` "ap <role> <item>", `start` ms, `totals` from metrics/transcript.mjs
 * tokenTotals). Every kind is summed (input, cache read and write, output), as the session ledger
 * counts cost; the cache read is kept apart for the comparison with the P-x sessions. Only
 * subagents of `item` started at or after `since` (ISO) count; the test author from `testsSince`
 * (E22: tests written ahead start before their item, within the run). Null when none matched.
 */
export function roleUsage(subagents, { item, since = null, testsSince = null }) {
  const at = (iso) => (iso ? Date.parse(iso) : null);
  const tokens = { total: 0 };
  let cacheRead = 0;
  let matched = 0;
  for (const s of subagents) {
    const m = /^ap (\S+) (\S+)$/.exec(s.description ?? '');
    if (!m || m[2] !== item) continue;
    const role = ROLE_OF(ROLE_ALIAS[m[1]] ?? m[1]);
    const from = at(role === 'tests' && testsSince ? testsSince : since);
    if (from !== null && s.start !== null && s.start < from) continue;
    const t = s.totals;
    const all = t.input + t.cacheRead + t.cacheWrite + t.output;
    tokens[role] = (tokens[role] ?? 0) + all;
    tokens.total += all;
    cacheRead += t.cacheRead;
    matched += 1;
  }
  return matched ? { tokens, cacheRead } : null;
}

/**
 * The row of one item attempt from its verdict files (`tests`, `impl`, `review`, `fix-1`, `gate-1`,
 * `reflect`…). Tokens come from `usage` (roleUsage of the transcripts) when given, else from the
 * optional `tokens` number the conductor copied from each Agent result (`tokenSource` says which).
 */
export function buildRow({ item, run, result, verdicts, startedAt, endedAt, usage = null }) {
  let tokens = { total: 0 };
  if (usage) tokens = usage.tokens;
  else {
    for (const [name, v] of Object.entries(verdicts)) {
      const n = Number(v?.tokens ?? 0);
      if (!n) continue;
      const role = ROLE_OF(name);
      tokens[role] = (tokens[role] ?? 0) + n;
      tokens.total += n;
    }
  }
  const findings = { severe: 0, normal: 0, nit: 0 };
  for (const f of verdicts.review?.findings ?? []) {
    if (f.severity in findings) findings[f.severity] += 1;
  }
  // Every gate call has its own file (gate.mjs never overwrites one): the first call decides.
  const gates = Object.keys(verdicts)
    .filter((k) => /^gate-\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  return {
    ts: endedAt,
    run,
    item,
    result,
    gateFirstPass: gates.length > 0 && verdicts[gates[0]]?.pass === true,
    gates: gates.length,
    rounds: Object.keys(verdicts).filter((k) => /^fix-\d+$/.test(k)).length,
    findings,
    testDispute: verdicts.review?.testDispute ?? null,
    decisions: (verdicts.impl?.decisions ?? []).length + (verdicts.tests?.decisions ?? []).length,
    // E17: the reflector's new lessons and its confirmations of existing ones (`same`).
    lessons: {
      new: (verdicts.reflect?.lessons ?? []).filter((l) => !l?.same).length,
      same: (verdicts.reflect?.lessons ?? []).filter((l) => l?.same).length,
    },
    tokens,
    tokenSource: usage ? 'transcript' : 'agent',
    cacheRead: usage ? usage.cacheRead : null,
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

/**
 * Minutes per finished criterion (`done` or `live`) of one run's rows, from the start of its first
 * item to the end of its last (E22: with tests ahead the items overlap, so their own times do not
 * add up). Null without a timed row or a finished item.
 */
export function pace(rows) {
  const timed = rows.filter((r) => r.wallMin != null && r.ts);
  const finished = new Set(
    rows.filter((r) => r.result === 'done' || r.result === 'live').map((r) => r.item),
  );
  if (!timed.length || !finished.size) return null;
  const start = Math.min(...timed.map((r) => Date.parse(r.ts) - r.wallMin * 60_000));
  const end = Math.max(...timed.map((r) => Date.parse(r.ts)));
  return Math.round(((end - start) / 60_000 / finished.size) * 10) / 10;
}

/** Means of every metric over the rows (of one run when given, then with its `pace`). */
export function summary(rows, run = null) {
  const pick = run ? rows.filter((r) => r.run === run) : rows;
  const out = { items: pick.length };
  for (const [name, m] of Object.entries(METRICS)) out[name] = mean(pick.map(m.of));
  if (run) out.pace = pace(pick);
  return out;
}

/**
 * The E22 verdict of one run against an earlier one, computed so that nobody has to judge it:
 * `keep` when its `pace` is below `paceBelow` and neither the gate first pass nor the accepted test
 * disputes got worse, else `revert` with the reasons. `wait` with fewer than `min` finished items,
 * or when one of them came with tests written in an earlier run (its time would flatter the run).
 */
export function judgeRun(rows, { run, against, paceBelow, min = 3 }) {
  const finished = rows.filter(
    (r) => r.run === run && (r.result === 'done' || r.result === 'live'),
  );
  const now = summary(rows, run);
  const before = summary(rows, against);
  if (!before.items) throw new Error(`no rows of run ${against}`);
  const pick = (s) => ({ pace: s.pace, gateFirstPass: s.gateFirstPass, disputes: s.disputes });
  const out = { run, against, finished: new Set(finished.map((r) => r.item)).size, ...pick(now) };
  out.before = pick(before);
  const old = finished.filter((r) => !(r.tokens?.tests > 0)).map((r) => r.item);
  if (out.finished < min)
    return { verdict: 'wait', reasons: [`${out.finished} finished items, ${min} needed`], ...out };
  if (old.length)
    return { verdict: 'wait', reasons: [`tests from an earlier run: ${old.join(', ')}`], ...out };
  const reasons = [];
  if (now.gateFirstPass < before.gateFirstPass)
    reasons.push(`gate first pass ${now.gateFirstPass} < ${before.gateFirstPass}`);
  if (now.disputes > before.disputes)
    reasons.push(`accepted test disputes ${now.disputes} > ${before.disputes}`);
  if (!(now.pace < paceBelow)) reasons.push(`pace ${now.pace} min is not below ${paceBelow}`);
  return { verdict: reasons.length ? 'revert' : 'keep', reasons, ...out };
}
