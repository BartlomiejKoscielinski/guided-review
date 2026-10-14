import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, lastAssistantText, spentByRun } from './autopilot/hook-lib.mjs';

const run = { runId: 'ap-1', cap: 3, iterations: 0, budgetTokens: 1000, finalized: false };
const item = { id: 'F-07.2', status: 'todo' };
const line = (type, content) => JSON.stringify({ type, message: { content } });

test('autopilot hook: last assistant text skips tool-only messages', () => {
  const lines = [
    line('assistant', [{ type: 'text', text: 'Done. AUTOPILOT ap-1 next' }]),
    line('user', [{ type: 'tool_result', content: 'x' }]),
    line('assistant', [{ type: 'tool_use', name: 'Bash', input: {} }]),
    '{"partial',
  ];
  assert.equal(lastAssistantText(lines), 'Done. AUTOPILOT ap-1 next');
  assert.equal(lastAssistantText([]), '');
});

test('autopilot hook: only the conductor of the run is continued, with the iteration counted', () => {
  assert.equal(decide({ run: null, text: '', nextItem: item }).block, false);
  assert.equal(decide({ run, text: 'some other session', nextItem: item }).block, false);
  const go = decide({ run, text: 'AUTOPILOT ap-1 next', spentTokens: 10, nextItem: item });
  assert.equal(go.block, true);
  assert.equal(go.run.iterations, 1);
  assert.match(go.reason, /next item F-07\.2 \(todo\), iteration 1\/3/);
  assert.equal(decide({ run, text: 'AUTOPILOT ap-1 stop: done', nextItem: item }).block, false);
});

test('autopilot hook: cap, budget, STOP and an empty backlog close the run once, then allow the stop', () => {
  const cases = [
    { run: { ...run, iterations: 3 }, re: /cap 3/ },
    { run, spentTokens: 1000, re: /budget/ },
    { run, stopFile: true, re: /STOP/ },
    { run, nextItem: { none: 'no ready item in M3' }, re: /no ready item/ },
  ];
  for (const c of cases) {
    const first = decide({ text: 'AUTOPILOT ap-1 next', nextItem: item, spentTokens: 0, ...c });
    assert.equal(first.block, true);
    assert.match(first.reason, c.re);
    assert.match(first.reason, /Closing/);
    const again = decide({
      text: 'AUTOPILOT ap-1 next',
      nextItem: item,
      spentTokens: 0,
      ...c,
      run: first.run,
    });
    assert.equal(again.block, false);
  }
});

test('autopilot hook: tokens spent by a run', () => {
  const jsonl = [
    JSON.stringify({ run: 'ap-1', tokens: { total: 300 } }),
    JSON.stringify({ run: 'ap-0', tokens: { total: 999 } }),
    'broken',
    JSON.stringify({ run: 'ap-1', tokens: { total: 200 } }),
  ].join('\n');
  assert.equal(spentByRun(jsonl, 'ap-1'), 500);
});
