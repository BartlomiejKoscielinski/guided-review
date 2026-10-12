// Pure helpers for tools/audit.mjs: parse the spec, PROGRESS and the manual checklist, and find
// acceptance-criterion IDs in tests. Kept free of I/O so tools/audit-lib.test.mjs can test them.

const AC_OR_NFR = /^- \*\*((?:F-\d\d\.\d+)|(?:NFR-\d\d))\b/gm;

/** IDs of acceptance criteria and NFRs defined in docs/01-product.md. */
export function parseSpecIds(productMd) {
  return [...productMd.matchAll(AC_OR_NFR)].map((m) => m[1]);
}

/** PROGRESS.md: "## M3 · …" headers and "- [x] F-06.4 … (sha)" lines. */
export function parseProgress(progressMd) {
  const items = new Map();
  let milestone = null;
  for (const line of progressMd.split(/\r?\n/)) {
    const h = line.match(/^## (M\d+) /);
    if (h) {
      milestone = h[1];
      continue;
    }
    const m = line.match(/^- \[( |x)\] ((?:F-\d\d\.\d+)|(?:NFR-\d\d))\b(.*)$/);
    if (m) {
      items.set(m[2], {
        milestone,
        done: m[1] === 'x',
        // "(sha)" or "(sha, sha, …)" when several commits completed the criterion.
        sha: (m[3].match(/\(([0-9a-f]{7,40})(?:,\s*[0-9a-f]{7,40})*\)\s*$/) || [])[1] || null,
        partial: /— partial:/.test(m[3]),
      });
    }
  }
  return items;
}

/** IDs listed in the manual checklist of docs/09-testing.md. */
export function parseManualChecklist(testingMd) {
  return new Set(
    [...testingMd.matchAll(/^- \[ \] ((?:F-\d\d\.\d+)|(?:NFR-\d\d))\b/gm)].map((m) => m[1]),
  );
}

const SCRIPT_EXT = /\.(?:ts|tsx|mjs|js)$/;
// A segment of the path is "test", "tests", "spec" or "__tests__" (foo.test.ts, tests/e2e/x.ts).
const SCRIPT_TEST_PATH = /(?:^|[\\/.])(?:tests?|spec|__tests__)(?:[\\/.]|$)/i;

/** Whether a file (path relative to the repository root) can contain test references. */
export function isTestFile(relPath) {
  if (relPath.endsWith('.rs')) return true; // unit tests live inside module files
  return SCRIPT_EXT.test(relPath) && SCRIPT_TEST_PATH.test(relPath);
}

/** Acceptance-criterion IDs referenced by the tests in one file. */
export function extractTestRefs(relPath, text) {
  if (!isTestFile(relPath)) return [];
  return relPath.endsWith('.rs') ? rustTestRefs(text) : scriptTestRefs(text);
}

// Vitest / Playwright: "it('F-06.10 missing hunks go to the Other step', …)".
function scriptTestRefs(text) {
  const ids = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9])(?:F-(\d\d)\.(\d+)|NFR-(\d\d))(?!\d)/g)) {
    ids.push(m[1] ? `F-${m[1]}.${m[2]}` : `NFR-${m[3]}`);
  }
  return ids;
}

// A test attribute: #[test], #[tokio::test], #[tokio::test(flavor = "…")], #[rstest], #[test_case(…)].
const RUST_TEST_ATTR = /#\[\s*(?:[A-Za-z_]\w*::)*(?:test|rstest|test_case)\b[^\]]*\]/g;
// After the test attribute: more attributes, comments and whitespace, then the fn signature.
const RUST_FN_AFTER_ATTR =
  /(?:\s+|\/\/[^\n]*|#\[[^\]]*\])*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/y;

/** Names of test functions in a Rust source file (module files and tests/ alike). */
export function rustTestNames(text) {
  const names = [];
  for (const attr of text.matchAll(RUST_TEST_ATTR)) {
    RUST_FN_AFTER_ATTR.lastIndex = attr.index + attr[0].length;
    const fn = RUST_FN_AFTER_ATTR.exec(text);
    if (fn) names.push(fn[1]);
  }
  return names;
}

// Rust: "fn f06_10_missing_hunks_go_to_other_step()", "fn nfr08_redacts_tokens()".
function rustTestRefs(text) {
  const ids = [];
  for (const name of rustTestNames(text)) {
    for (const m of name.matchAll(/(?:^|_)(?:f(\d\d)_(\d+)|nfr_?(\d\d))(?=_|$)/g)) {
      ids.push(m[1] ? `F-${m[1]}.${Number(m[2])}` : `NFR-${m[3]}`);
    }
  }
  return ids;
}

/** One row per spec ID with its PROGRESS state, tests and problems. */
export function buildRows({ specIds, progressItems, refs, manual, onlyMilestone = null }) {
  return specIds
    .map((id) => {
      const p = progressItems.get(id);
      const tests = refs.get(id) ? [...refs.get(id)] : [];
      const problems = [];
      if (!p) problems.push('missing in PROGRESS');
      if (p && p.done && !p.sha) problems.push('ticked without commit SHA');
      if (p && p.done && tests.length === 0 && !manual.has(id))
        problems.push('ticked without test or manual check');
      if (p && !p.done && tests.length > 0) problems.push('has tests but not ticked');
      return {
        id,
        milestone: p ? p.milestone : null,
        done: !!(p && p.done),
        partial: !!(p && p.partial),
        tests,
        manual: manual.has(id),
        problems,
      };
    })
    .filter((r) => !onlyMilestone || r.milestone === onlyMilestone);
}

/** Exit with 1 when a ticked item lacks evidence or an ID is missing in PROGRESS. */
export function isFailing(rows) {
  return rows.some((r) =>
    r.problems.some((p) => p.startsWith('ticked without') || p === 'missing in PROGRESS'),
  );
}
