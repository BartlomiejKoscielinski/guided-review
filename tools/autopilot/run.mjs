#!/usr/bin/env node
// Autopilot run state .autopilot/run.json (docs/process/AUTOPILOT.md §3.1), read by the Stop hook.
//   node tools/autopilot/run.mjs start --milestone M3 [--cap 12] [--budget 60000000]  → prints the marker
//   node tools/autopilot/run.mjs status | stop (kill switch: .autopilot/STOP) | end (after the closing turn)
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, '.autopilot');
const runPath = join(dir, 'run.json');
const stopPath = join(dir, 'STOP');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};

switch (argv[0]) {
  case 'start': {
    const milestone = String(flag('milestone', '')).toUpperCase();
    if (!/^M\d+$/.test(milestone)) {
      console.error('usage: run.mjs start --milestone Mx [--cap 12] [--budget tokens]');
      process.exit(2);
    }
    if (existsSync(runPath)) {
      console.error(`a run is active (${runPath}): status, stop or end it first`);
      process.exit(1);
    }
    mkdirSync(dir, { recursive: true });
    if (existsSync(stopPath)) unlinkSync(stopPath);
    const now = new Date();
    const runId = `ap-${now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}`;
    const run = {
      runId,
      milestone,
      startedAt: now.toISOString(),
      cap: Number(flag('cap', 12)),
      iterations: 0,
      budgetTokens: Number(flag('budget', 0)) || null,
      finalized: false,
    };
    writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);
    console.log(`AUTOPILOT ${runId}`);
    break;
  }
  case 'status':
    console.log(existsSync(runPath) ? readFileSync(runPath, 'utf8').trim() : 'no active run');
    if (existsSync(stopPath)) console.log('STOP requested');
    break;
  case 'stop':
    mkdirSync(dir, { recursive: true });
    writeFileSync(stopPath, `${new Date().toISOString()}\n`);
    console.log('STOP written: the conductor finishes its current item and closes the run');
    break;
  case 'end':
    if (existsSync(runPath)) unlinkSync(runPath);
    if (existsSync(stopPath)) unlinkSync(stopPath);
    console.log('run ended');
    break;
  default:
    console.error('usage: run.mjs start|status|stop|end');
    process.exit(2);
}
