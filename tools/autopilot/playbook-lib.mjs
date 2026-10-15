// Autopilot playbook (docs/process/AUTOPILOT.md §2.6, §4 B6): lessons as small itemized entries with
// counters (ACE: delta updates, grow and refine; never rewritten wholesale). Pure functions.
import { globToRegExp } from '../lanes-lib.mjs';

/** Entries hurting more than helping by this much are pruned. */
const HARM_MARGIN = 2;
/** Unhelpful entries not selected for this many items are pruned. */
const STALE_ITEMS = 30;
/** A lesson seen this often becomes a rule proposal for a role (E17: or confirmed helpful this often, never harmful). */
const PROMOTE_SEEN = 3;
const PROMOTE_HELPFUL = 3;
/** Budget of the existing lessons the reflector compares its own with (E17). */
const EXISTING_TOKENS = 2500;

export const empty = () => ({ items: 0, entries: [] });

const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Adds a lesson; the same lesson again only counts `seen` and merges tags. The same lesson is the
 * same text, or `same: "P-003"` when the reflector found its lesson already in the playbook (E17).
 */
export function addEntry(pb, { tags = [], text, source = '', same }, now) {
  if (same) {
    const e = pb.entries.find((x) => x.id === same);
    if (!e) throw new Error(`no entry ${same}`);
    e.seen += 1;
    e.tags = [...new Set([...e.tags, ...tags])];
    return { id: e.id, duplicate: true };
  }
  if (!text?.trim()) throw new Error('a lesson needs text');
  const key = normalize(text);
  const dup = pb.entries.find((e) => normalize(e.text) === key);
  if (dup) {
    dup.seen += 1;
    dup.tags = [...new Set([...dup.tags, ...tags])];
    return { id: dup.id, duplicate: true };
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

/**
 * The lessons the reflector compares its own with (E17): those matching the item kind or its files,
 * best first within the budget, then the ones the context pack offered.
 */
export function existing(pb, { kind, paths = [], offered = [] }, maxTokens = EXISTING_TOKENS) {
  const chosen = select(pb, { tags: kind ? [kind] : [], paths }, maxTokens);
  const ids = new Set(chosen.map((e) => e.id));
  return [...chosen, ...pb.entries.filter((e) => offered.includes(e.id) && !ids.has(e.id))];
}

/** Merges `drop` into `keep` (same advice in other words): counts summed, tags joined, `drop` deleted. */
export function merge(pb, keep, drop) {
  const k = pb.entries.find((e) => e.id === keep);
  const d = pb.entries.find((e) => e.id === drop);
  if (!k || !d || k === d) throw new Error(`merge needs two entries: ${keep} ${drop}`);
  for (const n of ['helpful', 'harmful', 'seen']) k[n] += d[n];
  k.tags = [...new Set([...k.tags, ...d.tags])];
  k.lastUsedItem = Math.max(k.lastUsedItem, d.lastUsedItem);
  if (d.promoted) k.promoted = true;
  if (d.hold && !k.hold) k.hold = d.hold;
  pb.entries = pb.entries.filter((e) => e !== d);
  return k;
}

/**
 * A rule proposal: seen 3× or more, or helpful 3× or more and never harmful (E17). An entry on
 * `hold` (a planned rule elsewhere replaces it, e.g. a lint of E18) is never proposed.
 */
export const promotable = (e) =>
  !e.promoted &&
  !e.hold &&
  (e.seen >= PROMOTE_SEEN || (e.helpful >= PROMOTE_HELPFUL && e.harmful === 0));

/** Keeps entries from becoming rule proposals, with the reason (they stay usable as lessons). */
export function hold(pb, ids, reason) {
  if (!String(reason ?? '').trim()) throw new Error('hold needs a reason');
  const missing = ids.filter((id) => !pb.entries.some((e) => e.id === id));
  if (missing.length) throw new Error(`no entry ${missing.join(', ')}`);
  for (const e of pb.entries) if (ids.includes(e.id)) e.hold = reason.trim();
}

/** Role prompts a learned rule may go into (`.claude/autopilot/roles/<role>.md`). */
export const RULE_ROLES = ['plan', 'tests', 'implement', 'review', 'fix', 'reflect', 'live'];
const RULES_HEADING = '## Rules learned';

/**
 * The role file with one more learned rule `- <rule> (P-003)` at the end of its "## Rules learned"
 * section (created at the end of the file when missing); unchanged when the entry is already there.
 */
export function addRule(roleMd, id, rule) {
  const text = String(rule ?? '').trim();
  if (!text || /[\r\n]/.test(text) || text.length > 300 || /{{|}}|<!--|undefined/.test(text))
    throw new Error(
      'a rule is one line of at most 300 characters, without {{, }}, <!-- or the word undefined (the prompt test reads it as an unfilled field)',
    );
  if (roleMd.includes(`(${id})`)) return roleMd;
  const line = `- ${text} (${id})`;
  const body = roleMd.replace(/\s*$/, '');
  const at = body.indexOf(`\n${RULES_HEADING}\n`);
  if (at < 0) return `${body}\n\n${RULES_HEADING}\n\n${line}\n`;
  const next = body.indexOf('\n## ', at + 1);
  const end = next < 0 ? body.length : next;
  const rest = body.slice(end);
  return `${body.slice(0, end).replace(/\s*$/, '')}\n${line}\n${rest ? `${rest}\n` : ''}`;
}

/** Marks a rule proposal promoted into `role`; refuses an entry that is not a proposal. */
export function promote(pb, id, role) {
  const e = pb.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no entry ${id}`);
  if (!RULE_ROLES.includes(role)) throw new Error(`role ${role}: one of ${RULE_ROLES.join(', ')}`);
  if (!promotable(e))
    throw new Error(
      `${id} is not a rule proposal (seen ${e.seen}, helpful ${e.helpful}, harmful ${e.harmful}${e.promoted ? ', already promoted' : ''}${e.hold ? `, on hold: ${e.hold}` : ''})`,
    );
  e.promoted = true;
  e.promotedTo = role;
  return e;
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
  const proposals = pb.entries.filter(promotable);
  return { removed: removed.map((e) => e.id), proposals };
}

export function render(entries) {
  return entries.map((e) => `- [${e.id}] ${e.text}`).join('\n');
}
