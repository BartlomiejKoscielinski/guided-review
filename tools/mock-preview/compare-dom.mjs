// Compares the text elements of a rendered mock with the implementation (both from collect-dom.js)
// and returns report sections as text lines: copy differences, typography and color differences,
// shifted elements, and colors that are not tokens. Used by design-check.mjs.
import { readFileSync } from 'node:fs';

const STYLE_KEYS = ['ff', 'fs', 'fw', 'tt', 'ls', 'c', 'bg', 'br'];
// Structure mode (the default /design-check during a milestone; pixel polish comes at the end):
// only what breaks the design rules or the copy - font family, uppercase, token meaning, corners -
// and shifts large enough to mean a misplaced region.
const STRUCTURE_KEYS = ['ff', 'tt', 'c', 'bg', 'br'];
const STRUCTURE_SHIFT = 40;

/** Maps computed colors (`rgb(…)` / `rgba(…)`) to token names from src/styles/tokens.css. */
export function loadTokenColors(tokensCss) {
  const map = new Map();
  const css = readFileSync(tokensCss, 'utf8');
  for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) {
    const rgb = toRgb(value.trim());
    if (rgb && !map.has(rgb)) map.set(rgb, name);
  }
  return map;
}

function toRgb(v) {
  const hex = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const n = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
    if (!hex[2] || hex[2].toLowerCase() === 'ff') return `rgb(${n.join(', ')})`;
    const a = Math.round((parseInt(hex[2], 16) / 255) * 100) / 100;
    return `rgba(${n.join(', ')}, ${a})`;
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const p = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return p.length === 4 && p[3] !== 1 ? `rgba(${p.slice(0, 3).join(', ')}, ${p[3]})` : `rgb(${p.slice(0, 3).join(', ')})`;
  }
  return null;
}

const normColor = (c) => (c ? c.replace(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/, (_, r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`) : c);

function fmtValue(key, v, tokens) {
  if ((key === 'c' || key === 'bg') && v) return tokens.get(normColor(v)) ?? v;
  return v === '' ? '—' : String(v);
}

function sameStyle(key, a, b) {
  if (key === 'ls') return (a === 'normal' ? '0px' : a) === (b === 'normal' ? '0px' : b);
  if (key === 'fs') return Math.abs(a - b) < 0.5;
  if (key === 'c' || key === 'bg') return normColor(a) === normColor(b);
  return a === b;
}

const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const q = (t) => `'${t.length > 40 ? t.slice(0, 38) + '…' : t}'`;

/** Pairs mock and implementation entries with the same text, nearest first. */
function match(mock, impl) {
  const used = new Set();
  const pairs = [];
  const missing = [];
  for (const m of mock) {
    let best = null;
    for (const [i, e] of impl.entries()) {
      if (used.has(i) || e.t !== m.t) continue;
      if (!best || dist(e, m) < dist(impl[best], m)) best = i;
    }
    if (best === null) missing.push(m);
    else {
      used.add(best);
      pairs.push([m, impl[best]]);
    }
  }
  const extra = impl.filter((_, i) => !used.has(i));
  return { pairs, missing, extra };
}

/** Unmatched texts at about the same place are one copy difference rather than missing + extra. */
function copyDiffs(missing, extra) {
  const lines = [];
  const taken = new Set();
  for (const m of missing) {
    const i = extra.findIndex((e, j) => !taken.has(j) && Math.abs(e.y - m.y) <= 6 && Math.abs(e.x - m.x) <= 60);
    if (i >= 0) {
      taken.add(i);
      lines.push(`${m.x},${m.y}  ${q(m.t)} → ${q(extra[i].t)}`);
    } else lines.push(`${m.x},${m.y}  missing ${q(m.t)}`);
  }
  extra.forEach((e, j) => taken.has(j) || lines.push(`${e.x},${e.y}  extra ${q(e.t)}`));
  return lines;
}

function styleDiffs(pairs, tokens, keys = STYLE_KEYS, boxes = true) {
  // Same difference on many elements (e.g. every label 12px instead of 11px) is reported once.
  const groups = new Map();
  for (const [m, e] of pairs) {
    const diffs = keys.filter((k) => !sameStyle(k, m[k], e[k])).map((k) => `${k} ${fmtValue(k, m[k], tokens)} → ${fmtValue(k, e[k], tokens)}`);
    if (boxes && e.bg && m.bg && (Math.abs(e.w - m.w) > 3 || Math.abs(e.h - m.h) > 3)) diffs.push(`box ${m.w}×${m.h} → ${e.w}×${e.h}`);
    if (!diffs.length) continue;
    const key = diffs.join(' · ');
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups].map(([key, ms]) => `${key}  — ${ms.length}× e.g. ${ms.slice(0, 3).map((m) => `${q(m.t)}@${m.x},${m.y}`).join(' ')}`);
}

function shifts(pairs, min = 3) {
  const groups = new Map();
  for (const [m, e] of pairs) {
    const dx = e.x - m.x;
    const dy = e.y - m.y;
    if (Math.abs(dx) <= min && Math.abs(dy) <= min) continue;
    const key = `${Math.round(dx / 2) * 2},${Math.round(dy / 2) * 2}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, ms]) => {
      const ys = ms.map((m) => m.y);
      return `dx,dy ${key}  ${ms.length}× in y ${Math.min(...ys)}–${Math.max(...ys)}, e.g. ${ms.slice(0, 3).map((m) => q(m.t)).join(' ')}`;
    });
}

function nonTokenColors(impl, tokens) {
  const found = new Map();
  for (const e of impl) {
    for (const k of ['c', 'bg']) {
      const v = normColor(e[k]);
      if (v && !tokens.has(v) && !found.has(v)) found.set(v, `${k} ${v} on ${q(e.t)}@${e.x},${e.y}`);
    }
  }
  return [...found.values()];
}

// Code tokens (monospace, not line numbers) are split and colored differently by the mock and
// Shiki: they are compared for font only, never for copy, color or position.
const isCode = (e) => /mono/i.test(e.ff) && !/^\d+$/.test(e.t);
const CODE_KEYS = ['ff', 'fs', 'fw'];

function codeFontDiffs(mock, impl) {
  const font = (e) => CODE_KEYS.map((k) => e[k]).join(' ');
  const count = (list) => list.reduce((m, e) => m.set(font(e), (m.get(font(e)) ?? 0) + 1), new Map());
  const [a, b] = [count(mock), count(impl)];
  const main = (m) => [...m].sort((x, y) => y[1] - x[1])[0]?.[0];
  return main(a) && main(b) && main(a) !== main(b) ? [`main code font (ff fs fw): ${main(a)} → ${main(b)}`] : [];
}

/** Returns [title, lines[]] sections; empty sections are dropped. `structure` keeps only rule and copy differences. */
export function compareDom(mockAll, implAll, tokens, { structure = false } = {}) {
  const mock = mockAll.filter((e) => !isCode(e));
  const impl = implAll.filter((e) => !isCode(e));
  const { pairs, missing, extra } = match(mock, impl);
  if (structure)
    return [
      [`copy (${missing.length} mock texts unmatched, ${extra.length} impl texts unmatched)`, copyDiffs(missing, extra)],
      ['font family / uppercase / token / corners (mock → impl)', styleDiffs(pairs, tokens, STRUCTURE_KEYS, false)],
      [`misplaced (shift > ${STRUCTURE_SHIFT}px, impl − mock)`, shifts(pairs, STRUCTURE_SHIFT)],
      ['colors that are not tokens', nonTokenColors(impl, tokens)],
    ].filter(([, lines]) => lines.length);
  return [
    [`copy (${missing.length} mock texts unmatched, ${extra.length} impl texts unmatched)`, copyDiffs(missing, extra)],
    ['typography / color / box (mock → impl)', styleDiffs(pairs, tokens)],
    ['shifted (impl − mock, px)', shifts(pairs)],
    ['colors that are not tokens', nonTokenColors(impl, tokens)],
    ['code (syntax colors and token splits ignored)', codeFontDiffs(mockAll.filter(isCode), implAll.filter(isCode))],
  ].filter(([, lines]) => lines.length);
}
