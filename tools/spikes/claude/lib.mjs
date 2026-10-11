// Shared helpers for the M0 Claude spikes (S1–S4). Spawns claude.exe the way the runner will:
// argument array, no shell, prompt through stdin, hidden window. Every run is saved as JSON in
// <BASE>/out/<label>.json for the spike notes. Fixtures live under BASE (synthetic data only).
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  lstatSync,
  chmodSync,
  unlinkSync,
  rmdirSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

// Spaces and Polish characters on purpose (paths of real users look like this).
export const BASE = process.env.GR_SPIKE_DIR || join(tmpdir(), 'gr spikes zażółć');
export const OUT = join(BASE, 'out');
export const CLAUDE = process.env.GR_CLAUDE || join(homedir(), '.local', 'bin', 'claude.exe');
export const HAIKU = 'claude-haiku-5-5';

mkdirSync(OUT, { recursive: true });

// The environment GuidedReview.exe gets when started from Explorer: no variables of a
// surrounding Claude Code session (CLAUDECODE, CLAUDE_CODE_*, ANTHROPIC_BASE_URL, MCP_*).
// DISABLE_AUTOUPDATER keeps the CLI version stable during the spike.
export function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC_|MCP_|DISABLE_MICROCOMPACT$)/i.test(k)) continue;
    env[k] = v;
  }
  return { ...env, DISABLE_AUTOUPDATER: '1', ...extra };
}

export function claudeVersion() {
  const r = spawnSync(CLAUDE, ['--version'], {
    env: cleanEnv(),
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.stdout.trim();
}

const parseJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const parseLines = (s) => s.split(/\r?\n/).filter(Boolean).map(parseJson).filter(Boolean);

/**
 * Runs claude.exe once. `model: true` counts the call against the spike budget (it reaches the
 * model); flag errors and auth failures don't.
 */
export function run(label, args, opts = {}) {
  const { cwd = BASE, stdin = '', env = cleanEnv(), timeoutMs = 240_000, killAfterMs } = opts;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLAUDE, args, { cwd, env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), killAfterMs ?? timeoutMs);
    child.on('error', (e) => (stderr += `\n[spawn error] ${e.message}`));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const events = parseLines(stdout);
      const r = {
        label,
        args,
        cwd,
        code,
        signal,
        ms: Date.now() - t0,
        stdout,
        stderr,
        json: parseJson(stdout.trim()),
        events,
        init: events.find((e) => e.type === 'system' && e.subtype === 'init') || null,
        result: events.findLast((e) => e.type === 'result') || parseJson(stdout.trim()),
      };
      writeFileSync(join(OUT, `${label}.json`), JSON.stringify(r, null, 2));
      appendFileSync(
        join(OUT, 'calls.log'),
        `${new Date().toISOString()} ${label} exit=${code} ${r.ms}ms\n`,
      );
      resolve(r);
    });
    child.stdin.end(stdin);
  });
}

/** The read-only profile from docs/05-integrations.md, plus switches for the spike variants. */
export function readOnlyArgs({
  output = 'json',
  schema,
  model = HAIKU,
  effort = 'low',
  tools = 'Read,Grep,Glob',
  settingSources = 'user',
  systemFile,
  addDirs = [],
  persist = false,
  resume,
  extra = [],
} = {}) {
  const a = ['-p', '--output-format', output];
  if (output === 'stream-json') a.push('--verbose');
  if (schema) a.push('--json-schema', JSON.stringify(schema));
  if (model) a.push('--model', model);
  if (effort) a.push('--effort', effort);
  a.push('--tools', tools, '--permission-mode', 'dontAsk');
  if (settingSources !== null) a.push('--setting-sources', settingSources);
  a.push('--strict-mcp-config', '--disallowedTools', 'mcp__*');
  if (systemFile) a.push('--append-system-prompt-file', systemFile);
  for (const d of addDirs) a.push('--add-dir', d);
  if (!persist) a.push('--no-session-persistence');
  if (resume) a.push('--resume', resume);
  return [...a, ...extra];
}

export function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

// fs.rmSync({ recursive: true }) on Node 24.13 silently does nothing on paths with Polish
// characters on Windows, so remove trees by hand (git objects are read-only).
export function removeDir(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (lstatSync(p).isDirectory()) removeDir(p);
    else {
      chmodSync(p, 0o666);
      unlinkSync(p);
    }
  }
  rmdirSync(dir);
  if (existsSync(dir)) throw new Error(`could not remove ${dir}`);
}

export function initRepo(dir, files) {
  removeDir(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(
    dir,
    '-c',
    'user.name=Spike',
    '-c',
    'user.email=spike@example.invalid',
    'commit',
    '-q',
    '-m',
    'fixture',
  );
  return dir;
}

/** Short summary of a run for the console. */
export function summary(r) {
  const res = r.result || {};
  return {
    label: r.label,
    exit: r.code,
    ms: r.ms,
    is_error: res.is_error,
    subtype: res.subtype,
    result: typeof res.result === 'string' ? res.result.slice(0, 300) : res.result,
    structured_output: res.structured_output,
    stderr: r.stderr.slice(0, 300),
  };
}
