// Autopilot gate (docs/process/AUTOPILOT.md §4 B2): the deterministic checks that decide a merge.
// Pure functions; git and process calls live in gate.mjs.

/** Files nothing in the loop may change: the owner's rules and the ADRs (needs-owner, §3.2). */
export const PROTECTED = ['CLAUDE.md', '.claude/settings.json', 'docs/08-decisions.md'];

const notProse = (file) => !/\.md$/i.test(file) && !file.startsWith('tools/autopilot/');
const appCode = (file) => file.startsWith('src-tauri/src/') || file.startsWith('src/');
const isTest = (file) => /(_tests\.rs|\.test\.[cm]?[jt]sx?|\.spec\.[jt]s)$|\/tests?\//.test(file);

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
