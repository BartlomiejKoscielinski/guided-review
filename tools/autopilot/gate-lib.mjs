// Autopilot gate (docs/process/AUTOPILOT.md §4 B2): the deterministic checks that decide a merge.
// Pure functions; git and process calls live in gate.mjs.

/** Files nothing in the loop may change: the owner's rules and the ADRs (needs-owner, §3.2). */
export const PROTECTED = ['CLAUDE.md', '.claude/settings.json', 'docs/08-decisions.md'];

const notProse = (file) => !/\.md$/i.test(file) && !file.startsWith('tools/autopilot/');
const appCode = (file) => file.startsWith('src-tauri/src/') || file.startsWith('src/');
/** A test file by path: `*_tests.rs`, `*.test.ts(x)`, `*.spec.ts`, or anything under a `tests/` folder. */
export const isTest = (file) =>
  /(_tests\.rs|\.test\.[cm]?[jt]sx?|\.spec\.[jt]s)$|(^|\/)tests?\//.test(file.replace(/\\/g, '/'));

/** Parses `--dispute a@sha1,b@sha2`: accepted test disputes, file → commit. */
export function parseDisputes(text) {
  const out = new Map();
  for (const part of (text ?? '').split(',').filter(Boolean)) {
    const at = part.lastIndexOf('@');
    if (at <= 0 || at === part.length - 1) throw new Error(`--dispute ${part}: file@sha`);
    out.set(part.slice(0, at), part.slice(at + 1));
  }
  return out;
}

/**
 * The accepted disputes of an item: the ones the backlog remembers (`disputes` of the item, set by
 * `backlog.mjs set <id> --dispute`), then `--dispute` (wins for the same file). File → commit.
 */
export function itemDisputes(backlog, item, cli) {
  const remembered = (backlog?.items ?? []).find((i) => i.id === item)?.disputes ?? [];
  return parseDisputes([...remembered, cli].filter(Boolean).join(','));
}

/**
 * Where a verdict goes: `path`, or when that exists the next free number (`gate-1.json` →
 * `gate-2.json`, `gate.json` → `gate-2.json`), so a later gate call never overwrites an earlier one.
 */
export function freePath(path, exists) {
  if (!exists(path)) return path;
  const [, stem, n, ext = ''] = path.match(/^(.*?)(?:-(\d+))?(\.[^./\\]+)?$/);
  for (let i = Number(n ?? 1) + 1; ; i++) {
    const next = `${stem}-${i}${ext}`;
    if (!exists(next)) return next;
  }
}

const sameSha = (a, b) => a.startsWith(b) || b.startsWith(a);

/**
 * Problems of the locked tests: a locked file changed after the lock is fine only through an
 * accepted dispute `file@sha` where `sha` is the only commit after the lock touching the file and
 * changes nothing else. `history(file)` = the commits after the lock touching it, `filesOf(sha)` =
 * the files of a commit. Empty = ok.
 */
export function lockProblems(changed, disputes, history, filesOf) {
  const problems = [];
  for (const file of changed) {
    const sha = disputes.get(file);
    if (!sha) {
      problems.push(`${file} changed after the lock`);
      continue;
    }
    const commits = history(file);
    if (commits.length !== 1 || !sameSha(commits[0], sha)) {
      problems.push(`${file}: changed in ${commits.join(', ')}, the dispute allows only ${sha}`);
      continue;
    }
    const others = filesOf(sha).filter((f) => f !== file);
    if (others.length)
      problems.push(`${file}: dispute commit ${sha} also changes ${others.join(', ')}`);
  }
  return problems;
}

/**
 * Grep rules on added lines: the CLAUDE.md non-negotiables a diff can show. `clippy` and the tests
 * cover the rest (unwrap, argv profiles); these catch what they don't.
 */
export const RULES = [
  {
    id: 'claude-flags',
    text: 'never --bare or --dangerously-skip-permissions for claude (CLAUDE.md non-negotiables)',
    applies: (f) => appCode(f) && !isTest(f),
    bad: (l) =>
      /["'](--bare|--dangerously-skip-permissions)["']/.test(l) && !/assert|contains/.test(l),
  },
  {
    id: 'gitlab-token',
    text: 'no GitLab token shapes anywhere (public repo, push protection)',
    applies: notProse,
    bad: (l) => /\bgl[a-z]{2,4}-[0-9A-Za-z_-]{20,}/.test(l),
  },
  {
    id: 'shell',
    text: 'processes as argument arrays, never through cmd.exe (CLAUDE.md processes)',
    applies: (f) => f.startsWith('src-tauri/src/') && !isTest(f),
    bad: (l) => /Command::new\(\s*"cmd(\.exe)?"/.test(l) || /"\/C"/.test(l),
  },
  {
    id: 'raw-color',
    text: 'colors only through tokens.css variables (CLAUDE.md UI)',
    applies: (f) =>
      f.startsWith('src/') && /\.(css|tsx)$/.test(f) && f !== 'src/styles/tokens.css' && !isTest(f),
    bad: (l) => /(color|background|fill|stroke|border|shadow)[^;]*#[0-9a-fA-F]{3,8}\b/.test(l),
  },
];

/** Added lines of a `git diff -U0` text: [{ file, text }]. */
export function addedLines(diff) {
  const out = [];
  let file = null;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? null : line.slice(4).replace(/^b\//, '');
    } else if (file && line.startsWith('+') && !line.startsWith('+++')) {
      out.push({ file, text: line.slice(1) });
    }
  }
  return out;
}

/** Rule hits on added lines: [{ rule, file, text }]. */
export function ruleViolations(added) {
  const hits = [];
  for (const { file, text } of added) {
    for (const r of RULES) {
      if (r.applies(file) && r.bad(text))
        hits.push({ rule: r.id, file, text: text.trim().slice(0, 120) });
    }
  }
  return hits;
}

/** Changed files that are protected. */
export function protectedChanges(files) {
  return files.filter((f) => PROTECTED.includes(f));
}

/**
 * The PROGRESS line of `id` after the item: ticked with its commits when complete, else the
 * autopilot commits appended to the partial note. Throws when the line is missing.
 */
export function tickProgress(progressMd, id, shas, complete) {
  const lines = progressMd.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`- [ ] ${id} `));
  if (i < 0) throw new Error(`PROGRESS has no open line for ${id}`);
  const [head, note] = lines[i].replace(/\r$/, '').split(' — partial: ');
  if (complete) {
    // Earlier partial commits stay part of the criterion's history.
    const earlier = (note ?? '').match(/\b[0-9a-f]{7,12}\b/g) ?? [];
    const all = [...new Set([...earlier, ...shas])];
    lines[i] = `${head.replace('- [ ] ', '- [x] ')} (${all.join(', ')})`;
  } else {
    lines[i] = `${head} — partial: ${note ? `${note}; ` : ''}autopilot (${shas.join(', ')})`;
  }
  return lines.join('\n');
}
