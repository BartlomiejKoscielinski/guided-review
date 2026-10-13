import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commandKey,
  parseTranscript,
  projectDirs,
  resultTokens,
  tokenTotals,
} from './metrics/transcript.mjs';
import { sessionSuggestions } from './metrics/suggest.mjs';

test('commandKey names the program and what it runs', () => {
  assert.equal(
    commandKey('cd /c/Repos/guided-review && node tools/verify.mjs --only lint'),
    'node tools/verify.mjs',
  );
  assert.equal(commandKey('git log --oneline -3'), 'git log');
  assert.equal(commandKey('npm run test:tools'), 'npm test:tools');
  assert.equal(commandKey('FORCE_COLOR=0 npx playwright test step'), 'npx playwright');
  assert.equal(commandKey('sed -n 1,40p a.ts | grep x'), 'sed');
});

test('resultTokens counts text by length and images at a flat rate', () => {
  assert.equal(resultTokens('x'.repeat(350)), 100);
  assert.equal(resultTokens([{ type: 'text', text: 'x'.repeat(35) }, { type: 'image' }]), 1610);
});

const at = (s) => `2026-10-13T10:00:${String(s).padStart(2, '0')}.000Z`;
const assistant = (id, s, ctx, blocks = []) => ({
  type: 'assistant',
  timestamp: at(s),
  message: {
    id,
    model: 'm',
    content: blocks,
    usage: {
      input_tokens: 0,
      cache_read_input_tokens: ctx,
      cache_creation_input_tokens: 0,
      output_tokens: 10,
    },
  },
});
const result = (id, s, text) => ({
  type: 'user',
  timestamp: at(s),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
});

test('a tool result is taxed once per later turn, split assistant lines count as one turn', () => {
  const p = parseTranscript([
    assistant('a', 0, 1000, [
      {
        type: 'tool_use',
        id: 't1',
        name: 'Read',
        input: { file_path: 'C:\\Repos\\guided-review\\docs\\x.md' },
      },
    ]),
    assistant('a', 0, 1000),
    result('t1', 4, 'x'.repeat(3500)),
    assistant('b', 6, 2000),
    assistant('c', 9, 2100),
  ]);
  assert.equal(p.turns.length, 3);
  const [c] = p.toolCalls;
  assert.equal(c.label, 'Read docs/x.md');
  assert.equal(c.tokens, 1000);
  assert.equal(c.tax, 2000);
  assert.equal(c.ms, 4000);
  assert.equal(tokenTotals(p.turns).maxContext, 2100);
});

test('rules: reading tax and long sessions are reported, waiting for the owner is not slow tool time', () => {
  const r = {
    main: { turns: 160, baseContext: 50_000, maxContext: 200_000, cacheReadOver150k: 3e6 },
    subagents: [],
    tools: [{ name: 'Bash', calls: 160, tokens: 160_000 }],
    toolErrors: 0,
    bigResults: [],
    repeated: [],
    topTax: [
      { label: 'Bash: sed', tax: 2e6 },
      { label: 'Bash: node tools/verify.mjs', tax: 5e5 },
    ],
    topTime: [{ label: 'AskUserQuestion', calls: 1, ms: 9 * 60_000 }],
  };
  const rules = sessionSuggestions(r).map((s) => s.rule);
  assert.deepEqual(rules, ['R4 long-session', 'R11 reading-tax']);
});

test('E4 transcript folders: the checkout, worktrees under it and lanes next to it with their lane', () => {
  const names = [
    'C--Repos-guided-review',
    'c--repos-guided-review--claude-worktrees-x',
    'C--Repos-gr-focus-b',
    'C--Repos-gr-',
    'C--Repos-gr--x',
    'C--Repos-other',
  ];
  assert.deepEqual(projectDirs('C:/Repos/guided-review', names), [
    { name: 'C--Repos-guided-review', lane: null },
    { name: 'c--repos-guided-review--claude-worktrees-x', lane: null },
    { name: 'C--Repos-gr-focus-b', lane: 'focus-b' },
  ]);
});
