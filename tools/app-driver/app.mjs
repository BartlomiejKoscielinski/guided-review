#!/usr/bin/env node
// Drives the real app (`tauri dev`) through WebView2's DevTools protocol so Claude Code can start it,
// click, type, read and screenshot it without the owner (docs/09-testing.md › Driving the real app).
//
//   node tools/app-driver/app.mjs start | status | stop [--all] | logs [n]
//   node tools/app-driver/app.mjs snap [target] | shot [out.png] [--target t] [--full]
//   node tools/app-driver/app.mjs click|dblclick|hover|wait|text <target> [--shot out.png]
//   node tools/app-driver/app.mjs fill <target> <text> | press <key> | type <text> | eval <js> | goto <path>
//   node tools/app-driver/app.mjs run <steps.json>   (an array of argv arrays, one connection)
//
// A target is a Playwright selector: role=button[name="Publish"], text=Cancel, css, `>> nth=0`.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const STATE_DIR = path.join(ROOT, '.app-driver');
const STATE = path.join(STATE_DIR, 'state.json');
const LOG = path.join(STATE_DIR, 'tauri-dev.log');
// Own cargo target dir: the running exe would otherwise lock target/debug and break `cargo test`.
const TARGET_DIR = path.join(ROOT, 'src-tauri', 'target', 'app-driver');
const PORT = Number(process.env.GR_CDP_PORT ?? 9222);
const CDP = `http://127.0.0.1:${PORT}`;
const APP_URL = 'http://localhost:1420';
const APP_EXE = 'GuidedReview.exe';
const ACTION_TIMEOUT = 10_000;
const BOOLEAN_FLAGS = new Set(['full', 'all']);

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) pos.push(a);
    else if (BOOLEAN_FLAGS.has(a.slice(2))) flags[a.slice(2)] = true;
    else flags[a.slice(2)] = argv[++i];
  }
  return { pos, flags };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpVersion() {
  try {
    const res = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tasklist(image) {
  const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return out
    .split(/\r?\n/)
    .filter((l) => l.startsWith('"'))
    .map((l) => Number(l.split('","')[1]));
}

function listenerPids(port) {
  const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${port}`)) pids.add(Number(cols[4]));
  }
  return [...pids];
}

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // already gone
  }
}

function tail(file, n) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
    return text.split(/\r?\n/).slice(-n).join('\n');
  } catch {
    return '(no log)';
  }
}

async function start(flags) {
  // tauri.conf.json's devUrl and dev CSP are fixed to 1420 and every instance shares one app data dir.
  if ((process.env.GR_PORT ?? '1420') !== '1420') {
    throw new Error(
      `GR_PORT=${process.env.GR_PORT}: lane worktrees use the mock backend; run the real app from the main checkout`,
    );
  }
  if (await cdpVersion()) return console.log(`already running, CDP on ${CDP}`);
  const others = tasklist(APP_EXE);
  const vite = listenerPids(1420);
  if (others.length || vite.length) {
    throw new Error(
      `an app without CDP is running (${APP_EXE} ${others.join(',') || '-'}, port 1420 ${vite.join(',') || '-'}); ` +
        'run `stop --all` first',
    );
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const log = fs.openSync(LOG, 'w');
  const cli = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const child = spawn(process.execPath, [cli, 'dev'], {
    cwd: ROOT,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
      CARGO_TARGET_DIR: TARGET_DIR,
    },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  fs.writeFileSync(
    STATE,
    JSON.stringify({ pid: child.pid, port: PORT, started: new Date().toISOString() }),
  );
  const deadline = Date.now() + Number(flags.timeout ?? 600) * 1000;
  while (Date.now() < deadline) {
    if (!alive(child.pid)) throw new Error(`tauri dev exited:\n${tail(LOG, 30)}`);
    if (await cdpVersion()) {
      const { page } = await connect(Date.now() + 60_000);
      await page.waitForLoadState('domcontentloaded');
      return console.log(`started (pid ${child.pid}), CDP on ${CDP}, page ${page.url()}`);
    }
    await sleep(2000);
  }
  throw new Error(`no CDP after ${flags.timeout ?? 600}s; see ${LOG}:\n${tail(LOG, 20)}`);
}

function stop(flags) {
  const state = readState();
  if (state?.pid) killTree(state.pid);
  if (flags.all) {
    for (const pid of tasklist(APP_EXE)) killTree(pid);
    for (const pid of listenerPids(1420)) killTree(pid);
  }
  fs.rmSync(STATE, { force: true });
  console.log(
    flags.all
      ? 'stopped (all)'
      : state
        ? `stopped pid ${state.pid}`
        : 'nothing started by the driver',
  );
}

async function connect(deadline = Date.now() + 5000) {
  const browser = await chromium.connectOverCDP(CDP);
  for (;;) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    const page = pages.find((p) => p.url().startsWith(APP_URL)) ?? pages[0];
    if (page) {
      page.setDefaultTimeout(ACTION_TIMEOUT);
      return { browser, page };
    }
    if (Date.now() > deadline) throw new Error('connected, but the app has no page');
    await sleep(500);
  }
}

async function shot(page, out, target, full) {
  const file = path.resolve(out ?? path.join(STATE_DIR, 'shot.png'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (target) await page.locator(target).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: !!full });
  console.log(`screenshot ${file}`);
}

// One page command; `run` calls it for each step over the same connection.
async function act(page, argv) {
  const { pos, flags } = parseArgs(argv);
  const [cmd, a, b] = pos;
  const loc = () => {
    if (!a) throw new Error(`${cmd} needs a target`);
    return page.locator(a);
  };
  switch (cmd) {
    case 'snap':
      console.log(await page.locator(a ?? 'body').ariaSnapshot());
      break;
    case 'shot':
      await shot(page, a, flags.target, flags.full);
      return;
    case 'click':
      await loc().click();
      break;
    case 'dblclick':
      await loc().dblclick();
      break;
    case 'hover':
      await loc().hover();
      break;
    case 'drag': {
      // A real mouse drag in small moves, so pointer sensors with an activation distance start it.
      if (!b) throw new Error('drag needs a source and a target');
      const center = async (l) => {
        const box = await l.boundingBox();
        if (!box) throw new Error('drag: an element is not visible');
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const from = await center(loc());
      const to = await center(page.locator(b));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x, from.y + 8, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 20 });
      await sleep(150);
      await page.mouse.up();
      break;
    }
    case 'fill':
      await loc().fill(b ?? '');
      break;
    case 'press':
      await page.keyboard.press(a);
      break;
    case 'type':
      await page.keyboard.type(a ?? '');
      break;
    case 'wait':
      await loc().waitFor({
        state: flags.state ?? 'visible',
        timeout: Number(flags.timeout ?? ACTION_TIMEOUT),
      });
      break;
    case 'text':
      console.log(await loc().innerText());
      break;
    case 'eval':
      console.log(JSON.stringify(await page.evaluate(a), null, 2));
      break;
    case 'goto':
      await page.goto(new URL(a ?? '/', APP_URL).href);
      break;
    case 'sleep':
      await sleep(Number(a ?? 500));
      break;
    default:
      throw new Error(`unknown command ${cmd}`);
  }
  if (!['snap', 'text', 'eval'].includes(cmd)) console.log(`ok ${cmd}${a ? ` ${a}` : ''}`);
  if (flags.shot) await shot(page, flags.shot);
}

async function main() {
  const argv = process.argv.slice(2);
  const { pos, flags } = parseArgs(argv);
  switch (pos[0]) {
    case 'start':
      return start(flags);
    case 'stop':
      return stop(flags);
    case 'status': {
      const v = await cdpVersion();
      if (!v)
        return console.log(
          `not reachable on ${CDP}; app processes: ${tasklist(APP_EXE).join(',') || 'none'}`,
        );
      const { page } = await connect();
      return console.log(`running, ${v.Browser}, page ${page.url()} "${await page.title()}"`);
    }
    case 'logs':
      return console.log(tail(LOG, Number(pos[1] ?? 40)));
    case 'run': {
      const steps = JSON.parse(fs.readFileSync(pos[1], 'utf8'));
      const { page } = await connect();
      for (const step of steps) await act(page, step);
      return;
    }
    case undefined:
      throw new Error('usage: see the header of tools/app-driver/app.mjs');
    default: {
      if (!(await cdpVersion())) throw new Error(`app not reachable on ${CDP}; run \`start\``);
      const { page } = await connect();
      return act(page, argv);
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`error: ${e instanceof Error ? e.message.split('\n=====')[0] : String(e)}`);
    process.exit(1);
  },
);
