// Autopilot playbook (docs/process/AUTOPILOT.md §2.6, §4 B6): lessons as small itemized entries with
// counters (ACE: delta updates, grow and refine; never rewritten wholesale). Pure functions.
import { globToRegExp } from '../lanes-lib.mjs';

/** Entries hurting more than helping by this much are pruned. */
const HARM_MARGIN = 2;
/** Unhelpful entries not selected for this many items are pruned. */
const STALE_ITEMS = 30;
/** A lesson seen this often becomes a rule proposal for a skill. */
const PROMOTE_SEEN = 3;

export const empty = () => ({ items: 0, entries: [] });

const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Adds a lesson; the same lesson again only counts `seen` and merges tags. */
export function addEntry(pb, { tags = [], text, source = '' }, now) {
  if (!text?.trim()) throw new Error('a lesson needs text');
  const key = normalize(text);
  const same = pb.entries.find((e) => normalize(e.text) === key);
  if (same) {
    same.seen += 1;
    same.tags = [...new Set([...same.tags, ...tags])];
    return { id: same.id, duplicate: true };
  }
  const n = pb.entries.reduce((max, e) => Math.max(max, Number(e.id.slice(2))), 0) + 1;
  const id = `P-${String(n).padStart(3, '0')}`;
  pb.entries.push({
    id,
    tags,
    text: text.trim(),
    helpful: 0,
    harmful: 0,
    seen: 1,
    created: now,
    lastUsedItem: pb.items,
    source,
  });
  return { id, duplicate: false };
}

/** A tag matches a word tag (kind, role) or, when it looks like a path glob, one of the paths. */
export function matches(entry, { tags = [], paths = [] }) {
  return entry.tags.some((t) =>
    /[/*]/.test(t) ? paths.some((p) => globToRegExp(t).test(p)) : tags.includes(t),
  );
}

const score = (e) => e.helpful - 2 * e.harmful + e.seen;
const tokens = (text) => Math.ceil(text.length / 4);

/** The matching entries, best first, within `maxTokens`. */
export function select(pb, query, maxTokens = 1500) {
  const out = [];
  let used = 0;
  for (const e of pb.entries.filter((x) => matches(x, query)).sort((a, b) => score(b) - score(a))) {
    const cost = tokens(e.text) + 4;
    if (used + cost > maxTokens) break;
    out.push(e);
    used += cost;
  }
  return out;
}

export function touch(pb, ids) {
  for (const e of pb.entries) if (ids.includes(e.id)) e.lastUsedItem = pb.items;
}

export function rate(pb, id, verdict) {
  const e = pb.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no entry ${id}`);
  if (verdict === 'helpful') e.helpful += 1;
  else if (verdict === 'harmful') e.harmful += 1;
  else throw new Error('helpful or harmful');
  return e;
}

/** Prunes harmful and stale entries; lists the ones that recur enough to become a skill rule. */
export function curate(pb) {
  const removed = pb.entries.filter(
    (e) =>
      e.harmful >= e.helpful + HARM_MARGIN ||
      (e.helpful === 0 && pb.items - e.lastUsedItem >= STALE_ITEMS),
  );
  pb.entries = pb.entries.filter((e) => !removed.includes(e));
  const proposals = pb.entries.filter((e) => e.seen >= PROMOTE_SEEN && !e.promoted);
  return { removed: removed.map((e) => e.id), proposals };
}

export function render(entries) {
  return entries.map((e) => `- [${e.id}] ${e.text}`).join('\n');
}
