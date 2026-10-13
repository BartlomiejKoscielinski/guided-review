#!/usr/bin/env node
// PostToolUse hook (.claude/settings.json): every turn re-reads the whole context as cache, so a
// session past ~150k costs several times what a fresh one does. Reads the context size of the
// last turn from the transcript tail and, once per level, tells Claude to wrap up.
// Stdin: the hook input JSON ({ session_id, transcript_path }). Never fails the tool call.
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEVELS = [
  {
    at: 120_000,
    text: 'finish the current item, commit it, then run /handoff instead of starting the next task',
  },
  {
    at: 160_000,
    text: 'stop here: commit what is done and run /handoff now; every further turn re-reads this whole context',
  },
];
const TAIL_BYTES = 400_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function lastContext(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const l of lines) {
      if (!l.includes('"usage"') || !l.includes('"assistant"')) continue;
      try {
        const u = JSON.parse(l).message?.usage;
        if (u)
          return (
            (u.input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0)
          );
      } catch {
        /* partial first line */
      }
    }
  } finally {
    closeSync(fd);
  }
  return 0;
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const file = input.transcript_path;
  if (!file || !existsSync(file) || input.agent_id) process.exit(0);
  const ctx = lastContext(file);
  const level = LEVELS.filter((l) => ctx >= l.at).length;
  if (!level) process.exit(0);
  const stateDir = join(root, '.metrics', 'guard');
  const state = join(stateDir, `${input.session_id ?? 'unknown'}.txt`);
  const warned = existsSync(state) ? Number(readFileSync(state, 'utf8')) : 0;
  if (level <= warned) process.exit(0);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(state, String(level));
  const { at, text } = LEVELS[level - 1];
  const message = `Context guard: this session's context is ${Math.round(ctx / 1000)}k tokens (over ${at / 1000}k): ${text}. (tools/metrics/context-guard.mjs, docs/process/IMPROVEMENTS.md E2)`;
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message },
    }),
  );
} catch {
  process.exit(0);
}
