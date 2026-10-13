// Parses one Claude Code session transcript (`~/.claude/projects/<slug>/<id>.jsonl`, plus its
// `<id>/subagents/agent-*.jsonl`) into a compact record for the process feedback loop
// (tools/metrics/report.mjs, the /retro skill). Nothing from the conversation is kept beyond
// tool names, shortened command/file labels and numbers.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const CHARS_PER_TOKEN = 3.5;
const IMAGE_TOKENS = 1600;
const IDLE_GAP_MS = 5 * 60 * 1000;
const LABEL_MAX = 80;

const readLines = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });

/** Size of a tool result in estimated tokens (text by length, images at a flat rate). */
export function resultTokens(content) {
  if (typeof content === 'string') return Math.round(content.length / CHARS_PER_TOKEN);
  if (!Array.isArray(content)) return 0;
  return content.reduce(
    (n, b) =>
      n + (b.type === 'image' ? IMAGE_TOKENS : Math.round((b.text ?? '').length / CHARS_PER_TOKEN)),
    0,
  );
}

/** A short, stable key for a shell command: the program and what it runs (`node tools/verify.mjs`, `git log`). */
export function commandKey(command) {
  const first = String(command)
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .find((s) => s && !/^(cd|set|export|\$\w+\s*=)\b/.test(s) && !/^[A-Z_]+=\S+$/.test(s));
  if (!first) return 'cd';
  const words = first.replace(/^[A-Z_]+=\S+\s+/, '').split(/\s+/);
  const prog = basename(words[0].replace(/^["']|["']$/g, '')).replace(/\.(exe|cmd)$/i, '');
  if (prog === 'node' && words[1] && !words[1].startsWith('-'))
    return `node ${words[1].replace(/\\/g, '/')}`;
  if (['npm', 'npx', 'git', 'cargo', 'gh', 'docker'].includes(prog)) {
    const sub = words.slice(1).find((w) => !w.startsWith('-'));
    return sub ? `${prog} ${prog === 'npm' && sub === 'run' ? words[2] : sub}` : prog;
  }
  return prog;
}

/** Label of one tool call for "what cost the most" lists. */
export function toolLabel(name, input = {}) {
  const path = (p) =>
    String(p ?? '')
      .replace(/\\/g, '/')
      .replace(/^.*?guided-review\//i, '');
  let label = name;
  if (name === 'Bash' || name === 'PowerShell')
    label = `${name}: ${commandKey(input.command ?? '')}`;
  else if (name === 'Read' || name === 'Edit' || name === 'Write')
    label = `${name} ${path(input.file_path)}`;
  else if (name === 'Grep' || name === 'Glob') label = `${name} ${input.pattern ?? ''}`;
  else if (name === 'Skill') label = `Skill ${input.skill ?? ''}`;
  else if (name === 'Agent')
    label = `Agent ${input.subagent_type ?? 'general-purpose'}: ${input.description ?? ''}`;
  return label.slice(0, LABEL_MAX);
}

/**
 * Parses one transcript. Returns turns (unique assistant messages with usage), tool calls with
 * result size, duration and "context tax" (result tokens × later turns that re-read them), and
 * the skills and slash commands used.
 */
export function parseTranscript(lines) {
  const turns = [];
  const seen = new Set();
  const calls = new Map();
  const skills = [];
  const times = [];
  let title = null;
  let branch = null;
  let cost = null;
  let compactions = 0;
  for (const o of lines) {
    if (o.timestamp) times.push(Date.parse(o.timestamp));
    if (o.gitBranch && !branch) branch = o.gitBranch;
    if (o.type === 'custom-title' && o.customTitle) title = o.customTitle;
    if (o.type === 'cost-state') cost = o.totalCostUSD ?? cost;
    if (o.type === 'system' && /compact/i.test(o.subtype ?? '')) compactions++;
    const content = o.message?.content;
    if (o.type === 'assistant' && o.message?.usage) {
      const id = o.message.id ?? o.uuid;
      if (!seen.has(id)) {
        seen.add(id);
        const u = o.message.usage;
        turns.push({
          at: Date.parse(o.timestamp),
          model: o.message.model,
          input: u.input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
        });
      }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type !== 'tool_use') continue;
        calls.set(b.id, {
          name: b.name,
          label: toolLabel(b.name, b.input),
          turn: turns.length - 1,
          at: Date.parse(o.timestamp),
          tokens: 0,
          ms: 0,
          error: false,
        });
        if (b.name === 'Skill' && b.input?.skill) skills.push(b.input.skill);
      }
    }
    if (o.type === 'user') {
      if (typeof content === 'string') {
        const cmd = content.match(/<command-name>\/?([\w:-]+)<\/command-name>/);
        if (cmd) skills.push(cmd[1]);
      }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type !== 'tool_result') continue;
        const c = calls.get(b.tool_use_id);
        if (!c) continue;
        c.tokens = resultTokens(b.content);
        c.ms = Math.max(0, Date.parse(o.timestamp) - c.at);
        c.error = Boolean(b.is_error);
      }
    }
  }
  const n = turns.length;
  const toolCalls = [...calls.values()].map((c) => ({
    ...c,
    tax: c.tokens * Math.max(0, n - 1 - c.turn),
  }));
  times.sort((a, b) => a - b);
  let activeMs = 0;
  for (let i = 1; i < times.length; i++) activeMs += Math.min(times[i] - times[i - 1], IDLE_GAP_MS);
  return {
    title,
    branch,
    cost,
    compactions,
    turns,
    toolCalls,
    skills,
    start: times[0] ?? null,
    end: times.at(-1) ?? null,
    activeMs,
  };
}

/** Totals over turns: tokens by kind, base context (first turn) and the largest context. */
export function tokenTotals(turns) {
  const ctx = (t) => t.input + t.cacheRead + t.cacheWrite;
  const sum = (k) => turns.reduce((n, t) => n + t[k], 0);
  return {
    turns: turns.length,
    input: sum('input'),
    cacheRead: sum('cacheRead'),
    cacheWrite: sum('cacheWrite'),
    output: sum('output'),
    baseContext: turns.length ? ctx(turns[0]) : 0,
    maxContext: Math.max(0, ...turns.map(ctx)),
    cacheReadOver150k: turns.filter((t) => ctx(t) > 150_000).reduce((n, t) => n + t.cacheRead, 0),
    models: [...new Set(turns.map((t) => t.model).filter(Boolean))],
  };
}

/** Names the skill a forked subagent ran ("Base directory for this skill: …\skills\design-check"). */
function subagentKind(lines, meta) {
  const first = lines.find((o) => o.type === 'user');
  const text = typeof first?.message?.content === 'string' ? first.message.content : '';
  const skill = text.match(/Base directory for this skill:[^\n]*[\\/]skills[\\/]([\w:-]+)/);
  return skill ? `skill ${skill[1]}` : `agent ${meta?.agentType ?? 'unknown'}`;
}

const top = (items, key, n) => [...items].sort((a, b) => b[key] - a[key]).slice(0, n);

/** Groups tool calls by label: calls, tokens, tax, time, errors. */
export function byLabel(calls) {
  const g = new Map();
  for (const c of calls) {
    const e = g.get(c.label) ?? { label: c.label, calls: 0, tokens: 0, tax: 0, ms: 0, errors: 0 };
    e.calls++;
    e.tokens += c.tokens;
    e.tax += c.tax;
    e.ms += c.ms;
    e.errors += c.error ? 1 : 0;
    g.set(c.label, e);
  }
  return [...g.values()];
}

/** The ledger record of one session: main thread + subagents, compact enough to keep in git. */
export function sessionRecord(file) {
  const id = basename(file, '.jsonl');
  const main = parseTranscript(readLines(file));
  const dir = join(file, '..', id);
  const titleFile = join(dir, 'custom-title.json');
  if (!main.title && existsSync(titleFile)) {
    try {
      main.title = JSON.parse(readFileSync(titleFile, 'utf8')).customTitle ?? null;
    } catch {
      /* no title */
    }
  }
  const subDir = join(dir, 'subagents');
  const subagents = [];
  const allCalls = [...main.toolCalls];
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir).filter((x) => x.endsWith('.jsonl'))) {
      const lines = readLines(join(subDir, f));
      const metaFile = join(subDir, f.replace(/\.jsonl$/, '.meta.json'));
      const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null;
      const p = parseTranscript(lines);
      allCalls.push(...p.toolCalls);
      subagents.push({
        kind: subagentKind(lines, meta),
        ...tokenTotals(p.turns),
        toolCalls: p.toolCalls.length,
        activeMs: p.activeMs,
      });
    }
  }
  const groups = byLabel(allCalls);
  const tools = new Map();
  for (const c of allCalls) {
    const e = tools.get(c.name) ?? { name: c.name, calls: 0, tokens: 0, tax: 0, ms: 0 };
    e.calls++;
    e.tokens += c.tokens;
    e.tax += c.tax;
    e.ms += c.ms;
    tools.set(c.name, e);
  }
  const strip = ({ label, calls, tokens, tax, ms, errors }) => ({
    label,
    calls,
    tokens,
    tax,
    ms,
    errors,
  });
  return {
    id,
    title: main.title,
    branch: main.branch,
    start: main.start && new Date(main.start).toISOString(),
    end: main.end && new Date(main.end).toISOString(),
    activeMin: Math.round(main.activeMs / 60000),
    costUSD: main.cost,
    compactions: main.compactions,
    main: tokenTotals(main.turns),
    subagents,
    skills: main.skills,
    tools: [...tools.values()],
    toolErrors: allCalls.filter((c) => c.error).length,
    bigResults: top(allCalls, 'tokens', 5).map((c) => ({
      label: c.label,
      tokens: c.tokens,
      tax: c.tax,
    })),
    topTax: top(groups, 'tax', 8).map(strip),
    topTime: top(groups, 'ms', 6).map(strip),
    repeated: groups
      .filter((g) => g.calls >= 4)
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 8)
      .map(strip),
  };
}
