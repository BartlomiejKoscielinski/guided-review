import type { LocalScope } from '../../ipc/types/LocalScope';
import type { StatusSummary } from '../../ipc/types/StatusSummary';

export type ScopeId = LocalScope['kind'];

export interface ScopeOption {
  id: ScopeId;
  label: string;
  meta: string;
  scope: LocalScope;
}

const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * The My changes radio cards (F-03.3): "100 files · +318 −142", "3 commits · 104 files". Whole
 * branch only with a target (`origin/HEAD`).
 */
export function scopeOptions(summary: StatusSummary): ScopeOption[] {
  const files = (c: { files: number; additions: number; deletions: number }) =>
    `${count(c.files, 'file', 'files')} · +${String(c.additions)} −${String(c.deletions)}`;
  const options: ScopeOption[] = [
    {
      id: 'uncommitted',
      label: 'Uncommitted changes',
      meta: files(summary.uncommitted),
      scope: { kind: 'uncommitted' },
    },
    {
      id: 'staged',
      label: 'Staged only',
      meta: files(summary.staged),
      scope: { kind: 'staged' },
    },
  ];
  const branch = summary.branchVsTarget;
  if (summary.target === undefined || branch === undefined) return options;
  return [
    ...options,
    {
      id: 'branchVsTarget',
      label: `Whole branch vs ${summary.targetName ?? summary.target}`,
      meta: `${count(branch.commits, 'commit', 'commits')} · ${count(branch.files, 'file', 'files')}`,
      scope: { kind: 'branchVsTarget', target: summary.target },
    },
  ];
}
