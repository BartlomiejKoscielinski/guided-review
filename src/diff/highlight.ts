import { useEffect, useState } from 'react';
import type { FileDiff } from '../ipc/types/FileDiff';
import type { HighlightRequest, HighlightResponse, Token } from './highlight-protocol';
import { languageOf } from './language';

/** Tokens of a diff by side and line number. */
export interface DiffTokens {
  old: ReadonlyMap<number, Token[]>;
  new: ReadonlyMap<number, Token[]>;
}

const CACHE_SIZE = 64;
const cache = new Map<string, Promise<DiffTokens | null>>();
let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, (response: HighlightResponse) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') {
    worker = null;
    return worker;
  }
  try {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      resolve?.(event.data);
    };
  } catch {
    worker = null;
  }
  return worker;
}

interface Block {
  side: 'old' | 'new';
  numbers: number[];
  lines: string[];
}

/** One block per hunk side: context and deleted lines (old), context and added lines (new). */
export function sideBlocks(diff: FileDiff): Block[] {
  const blocks: Block[] = [];
  for (const hunk of diff.hunks) {
    const old: Block = { side: 'old', numbers: [], lines: [] };
    const neu: Block = { side: 'new', numbers: [], lines: [] };
    for (const line of hunk.lines) {
      if (line.kind !== 'add' && line.oldNo !== undefined) {
        old.numbers.push(line.oldNo);
        old.lines.push(line.text);
      }
      if (line.kind !== 'del' && line.newNo !== undefined) {
        neu.numbers.push(line.newNo);
        neu.lines.push(line.text);
      }
    }
    if (old.lines.length) blocks.push(old);
    if (neu.lines.length) blocks.push(neu);
  }
  return blocks;
}

async function run(path: string, diff: FileDiff): Promise<DiffTokens | null> {
  const lang = languageOf(path);
  const w = getWorker();
  if (!lang || !w || diff.binary) return null;
  const blocks = sideBlocks(diff);
  const id = nextId++;
  const request: HighlightRequest = { id, lang, blocks: blocks.map((b) => b.lines) };
  const response = await new Promise<HighlightResponse>((resolve) => {
    pending.set(id, resolve);
    w.postMessage(request);
  });
  if (!response.blocks) return null;
  const result = { old: new Map<number, Token[]>(), new: new Map<number, Token[]>() };
  blocks.forEach((block, i) => {
    const tokens = response.blocks?.[i] ?? [];
    block.numbers.forEach((no, j) => {
      result[block.side].set(no, tokens[j] ?? []);
    });
  });
  return result;
}

/** Highlights a file diff in the worker; results are cached per `key` (file + content). */
export function highlightDiff(
  key: string,
  path: string,
  diff: FileDiff,
): Promise<DiffTokens | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = run(path, diff).catch(() => null);
  cache.set(key, promise);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return promise;
}

/** A key that changes whenever the diff's content changes. */
export function diffKey(path: string, diff: FileDiff): string {
  return `${path}\u0000${diff.hunks.map((h) => h.id).join(',')}\u0000${String(diff.additions)}/${String(diff.deletions)}`;
}

/** Tokens for the diff once the worker has them; null meanwhile (plain text is shown). */
export function useHighlight(path: string, diff: FileDiff | undefined): DiffTokens | null {
  const [state, setState] = useState<{ key: string; tokens: DiffTokens | null } | null>(null);
  const key = diff ? diffKey(path, diff) : null;
  useEffect(() => {
    if (!diff || key === null) return;
    let live = true;
    void highlightDiff(key, path, diff).then((tokens) => {
      if (live) setState({ key, tokens });
    });
    return () => {
      live = false;
    };
  }, [key, path, diff]);
  return state && state.key === key ? state.tokens : null;
}
