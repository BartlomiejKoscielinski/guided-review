/// <reference lib="webworker" />
/**
 * Syntax highlighting off the UI thread (NFR-01, docs/04 › Stack). Shiki with its JavaScript
 * regex engine (no WebAssembly, ADR-023) and the css-variables theme, so colors come from
 * `--syn-*` tokens. Each request is a list of blocks (one per hunk side); grammar state carries
 * over the lines of a block.
 */
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { HighlightRequest, HighlightResponse, Token } from './highlight-protocol';
import type { Language } from './language';

const THEME = 'guided-review';

const loaders: Record<Language, () => Promise<{ default: unknown }>> = {
  csharp: () => import('shiki/langs/csharp.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  'objective-c': () => import('shiki/langs/objective-c.mjs'),
};

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<Language>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [createCssVariablesTheme({ name: THEME, variablePrefix: '--shiki-' })],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

async function tokenize(request: HighlightRequest): Promise<Token[][][]> {
  const hl = await getHighlighter();
  if (!loaded.has(request.lang)) {
    const grammar = await loaders[request.lang]();
    await hl.loadLanguage(grammar.default as Parameters<HighlighterCore['loadLanguage']>[0]);
    loaded.add(request.lang);
  }
  return request.blocks.map((lines) =>
    hl
      .codeToTokensBase(lines.join('\n'), { lang: request.lang, theme: THEME })
      .map((line) => line.map((t) => ({ text: t.content, color: t.color ?? '' }))),
  );
}

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const request = event.data;
  tokenize(request)
    .then((blocks) => {
      const response: HighlightResponse = { id: request.id, blocks };
      self.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: HighlightResponse = {
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    });
};
