import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, lastAssistantText, runEnding, spentByRun } from './autopilot/hook-lib.mjs';

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
  assert.match(go.reason, /next item F-07\.2 \(todo\), iteration 2\/3/);
  assert.equal(decide({ run, text: 'AUTOPILOT ap-1 stop: done', nextItem: item }).block, false);
});

test('autopilot hook: --cap N runs N items, the first one started by the skill included', () => {
  for (const cap of [1, 3, 6]) {
    let state = { ...run, cap };
    let items = 1;
    for (let guard = 0; guard < 20; guard += 1) {
      const d = decide({ run: state, text: 'AUTOPILOT ap-1 next', nextItem: item, spentTokens: 0 });
      if (d.run.finalized) {
        assert.match(d.reason, new RegExp(`cap ${cap} reached`));
        break;
      }
      items += 1;
      assert.match(d.reason, new RegExp(`iteration ${items}/${cap}`));
      state = d.run;
    }
    assert.equal(items, cap);
  }
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

test('autopilot hook E22: a turn that waits for a background test author is not continued', () => {
  const lines = [
    line('assistant', [{ type: 'text', text: 'F-07.2 done. AUTOPILOT ap-1 next' }]),
    line('user', 'Autopilot ap-1: next item F-07.3 (todo)'),
    line('assistant', [{ type: 'text', text: 'Waiting for the tests of F-07.3.' }]),
  ];
  const waiting = decide({
    run,
    text: lastAssistantText(lines),
    stopFile: false,
    spentTokens: 0,
    nextItem: { id: 'F-07.3', status: 'todo' },
  });
  assert.deepEqual(waiting, { block: false, reason: 'not the conductor' }, 'no iteration counted');
  // The agent's notification wakes the conductor; that turn ends with the marker as usual.
  const woken = decide({
    run,
    text: 'F-07.3 done. AUTOPILOT ap-1 next',
    stopFile: false,
    spentTokens: 0,
    nextItem: item,
  });
  assert.equal(woken.run.iterations, 1);
});

test('autopilot hook E22: the run ending after the current item gets no tests ahead', () => {
  const at = (over) => runEnding({ run, stopFile: false, spentTokens: 0, ...over });
  assert.equal(at({}), null);
  assert.match(at({ run: { ...run, iterations: 2 } }), /iteration cap 3 reached/);
  assert.match(at({ stopFile: true }), /\.autopilot\/STOP/);
  assert.match(at({ spentTokens: 1000 }), /token budget 1000 spent/);
});
