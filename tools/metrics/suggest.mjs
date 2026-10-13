// Heuristics over ledger records (tools/metrics/transcript.mjs › sessionRecord): each rule names
// a pattern that cost tokens or time and the usual fix. /retro turns them into experiments in
// docs/process/IMPROVEMENTS.md; the thresholds themselves are tuned there when they misfire.
export const LIMITS = {
  bigResult: 6_000, // tokens in one tool result
  baseContext: 60_000, // tokens before the first answer
  maxContext: 150_000,
  turns: 150,
  subagentTurns: 40,
  slowCallMs: 3 * 60_000,
  repeatInSession: 6,
  rereads: 3,
  crossSessions: 3,
  readShare: 0.5, // share of the top tax spent on reading files // a command repeated in this many sessions is a script/skill candidate
  callsPerTurn: 1.05, // below this, independent calls were not batched
  tinyResult: 400, // tokens per call on average
};

// Generic file readers: repeating them is normal; their cost shows up as reading tax (R11) instead.
const READER =
  /^(Bash|PowerShell): (sed|cat|grep|rg|head|tail|ls|wc|find|awk|cut|Get-Content|Select-String)$|^(Read|Grep|Glob)\b/;
// Waiting for the owner is not tool time.
const HUMAN = /^(AskUserQuestion|ExitPlanMode)/;
export const isReader = (label) => READER.test(label);

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
const min = (ms) => `${(ms / 60000).toFixed(1)} min`;

/** Rule hits for one session: [{ rule, text }]. */
export function sessionSuggestions(r) {
  const out = [];
  const hit = (rule, text) => out.push({ rule, text });
  for (const b of r.bigResults.filter((b) => b.tokens > LIMITS.bigResult))
    hit(
      'R1 big-result',
      `${b.label}: one result of ${k(b.tokens)} tokens, re-read for ${k(b.tax)}; filter it (grep/offset/--quiet) or move it into a script that prints a summary`,
    );
  if (r.main.baseContext > LIMITS.baseContext)
    hit(
      'R6 base-context',
      `base context ${k(r.main.baseContext)} before the first answer; check tool schemas, MCP servers, CLAUDE.md, MEMORY.md, skill listing`,
    );
  if (r.main.maxContext > LIMITS.maxContext || r.main.turns > LIMITS.turns)
    hit(
      'R4 long-session',
      `${r.main.turns} turns, context up to ${k(r.main.maxContext)} (${k(r.main.cacheReadOver150k)} cache read above 150k); end the phase with /handoff earlier`,
    );
  for (const g of r.repeated.filter((g) => /^Read /.test(g.label) && g.calls >= LIMITS.rereads))
    hit('R3 reread', `${g.label} read ${g.calls}×; read the needed section once, or grep`);
  for (const g of r.repeated.filter(
    (g) =>
      /^(Bash|PowerShell): /.test(g.label) &&
      !isReader(g.label) &&
      g.calls >= LIMITS.repeatInSession,
  ))
    hit(
      'R2 repeated-command',
      `${g.label} ${g.calls}× in one session (${k(g.tax)} tax); one script printing a compact report, or a skill`,
    );
  for (const s of r.subagents.filter((s) => s.turns > LIMITS.subagentTurns))
    hit(
      'R5 subagent-turns',
      `${s.kind}: ${s.turns} turns, ${k(s.cacheRead)} cache read; give it a data-gathering script or a tighter budget`,
    );
  for (const g of r.topTime.filter(
    (g) => !HUMAN.test(g.label) && g.ms / g.calls > LIMITS.slowCallMs,
  ))
    hit(
      'R7 slow-tool',
      `${g.label}: ${g.calls}× averaging ${min(g.ms / g.calls)}; narrow it (--only, one spec, sccache) or run it in the background`,
    );
  const calls = r.tools.reduce((n, t) => n + t.calls, 0);
  const totalTurns = r.main.turns + r.subagents.reduce((n, s) => n + s.turns, 0);
  const avgResult = r.tools.reduce((n, t) => n + t.tokens, 0) / Math.max(1, calls);
  if (totalTurns > 30 && calls / totalTurns < LIMITS.callsPerTurn && avgResult < LIMITS.tinyResult)
    hit(
      'R8 tiny-calls',
      `${calls} tool calls over ${totalTurns} turns with small results; batch independent calls in one turn or chain them in one shell command`,
    );
  const tax = r.topTax.reduce((n, g) => n + g.tax, 0);
  const readTax = r.topTax.filter((g) => isReader(g.label)).reduce((n, g) => n + g.tax, 0);
  if (tax > 1e6 && readTax / tax > LIMITS.readShare)
    hit(
      'R11 reading-tax',
      `${Math.round((100 * readTax) / tax)}% of the top context tax is reading files (${k(readTax)}); read narrower ranges, start from a context pack, or let an Explore subagent read and summarize`,
    );
  if (r.toolErrors >= 5)
    hit(
      'R9 tool-errors',
      `${r.toolErrors} failed tool calls; look for a wrong default (command, path, permission) worth fixing once`,
    );
  return out;
}

/** Patterns across sessions: commands repeated in many sessions, skills by cost. */
export function crossSuggestions(records) {
  const out = [];
  const perCommand = new Map();
  for (const r of records)
    for (const g of r.repeated.filter(
      (g) => /^(Bash|PowerShell): /.test(g.label) && !isReader(g.label),
    ))
      perCommand.set(g.label, [...(perCommand.get(g.label) ?? []), g.calls]);
  for (const [label, counts] of perCommand)
    if (counts.length >= LIMITS.crossSessions)
      out.push({
        rule: 'R10 recurring-command',
        text: `${label} repeated in ${counts.length} sessions (${counts.join(', ')} calls); candidate for a script or skill`,
      });
  return out;
}

/** Cost per skill/agent kind across sessions, from subagents (forked skills) and Skill calls. */
export function skillCosts(records) {
  const g = new Map();
  for (const r of records)
    for (const s of r.subagents) {
      const e = g.get(s.kind) ?? { kind: s.kind, runs: 0, turns: 0, cacheRead: 0, activeMs: 0 };
      e.runs++;
      e.turns += s.turns;
      e.cacheRead += s.cacheRead;
      e.activeMs += s.activeMs;
      g.set(s.kind, e);
    }
  return [...g.values()].sort((a, b) => b.cacheRead - a.cacheRead);
}
