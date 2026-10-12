import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import { layerOf } from './layer';
import { createMockRepos, type MockRepos } from './repos';
import type { CommitInfo } from '../types/CommitInfo';
import type { FileDiff } from '../types/FileDiff';
import type { FileGroup } from '../types/FileGroup';
import type { Hunk } from '../types/Hunk';
import type { Line } from '../types/Line';
import type { LocalChanges } from '../types/LocalChanges';
import type { RepoOperation } from '../types/RepoOperation';
import type { StageState } from '../types/StageState';
import type { TreeFile } from '../types/TreeFile';
import {
  BRANCH,
  COMMIT,
  commitFiles,
  localFiles,
  manyFiles,
  NEW_COMMIT,
  stagedAtStart,
  type MockFile,
  type MockRow,
} from './fixtures/changes';

/** Variations of the S-06 data for e2e tests and design shots (`MOCK_CHANGES_KEY`). */
export interface ChangesScenario {
  /** No repository picked yet ("Pick a repository"). */
  noRepo?: boolean;
  /** Replace the 100 files of the mock with this many generated ones (F-15.2). */
  files?: number;
  /** Nothing changed ("Working tree clean."). */
  clean?: boolean;
  operation?: RepoOperation;
  /** `git_commit` fails like a rejecting hook. */
  commitFails?: 'hook';
  /** `git_push` is rejected by the remote. */
  pushFails?: 'rejected';
}

type ChangesClient = Pick<
  IpcClient,
  | 'repoActive'
  | 'repoPick'
  | 'gitStatus'
  | 'gitCommitInfo'
  | 'gitFileDiff'
  | 'gitStage'
  | 'gitUnstage'
  | 'gitCommit'
  | 'gitLastMessage'
  | 'gitPush'
  | 'riderOpen'
  | 'onRepoChanged'
>;

/** Key of a change line: `o12` (deleted, HEAD number) or `n14` (added, working-tree number). */
const keyOf = (row: MockRow): string | null =>
  row[0] === 'd' ? `o${String(row[1])}` : row[0] === 'a' ? `n${String(row[1])}` : null;

const splitPath = (path: string): [string, string] => {
  const i = path.lastIndexOf('/');
  return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
};

/** Same order as the core's `tree::group`: directories, then files, case-insensitively. */
export function groupFiles(files: TreeFile[]): FileGroup[] {
  const collator = (a: string, b: string) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const sorted = [...files].sort((a, b) => {
    const [da, na] = splitPath(a.path);
    const [db, nb] = splitPath(b.path);
    return collator(da, db) || collator(na, nb);
  });
  const groups: FileGroup[] = [];
  for (const file of sorted) {
    const dir = splitPath(file.path)[0];
    const last = groups.at(-1);
    if (last?.dir === dir) last.files.push(file);
    else groups.push({ dir, files: [file] });
  }
  return groups;
}

function fail(code: 'INVALID_INPUT' | 'GIT_FAILED' | 'CONFLICT', message: string, detail?: string) {
  return new IpcError({ code, message, detail, retryable: false });
}

/** The S-06 part of the mock backend: in-memory index state over the fixture files. */
export function createChangesBackend(
  scenario: ChangesScenario,
  respond: <T>(value: T) => Promise<T>,
  repos: MockRepos = createMockRepos(scenario.noRepo ?? false),
): ChangesClient {
  const files: MockFile[] = scenario.clean
    ? []
    : scenario.files
      ? manyFiles(scenario.files)
      : localFiles();
  const commit = commitFiles();
  /** Change-line keys in the index, per path. */
  const staged = new Map<string, Set<string>>();
  /** Change-line keys already committed (they leave the diff). */
  const committed = new Map<string, Set<string>>();
  let lastMessage = `${COMMIT.subject}\n\n${COMMIT.body}`;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const commitDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

  const set = (map: Map<string, Set<string>>, path: string) => {
    let s = map.get(path);
    if (!s) {
      s = new Set();
      map.set(path, s);
    }
    return s;
  };
  const changeKeys = (file: MockFile): string[] => {
    const done = committed.get(file.path);
    return file.hunks
      .flatMap((h) => h.rows.map(keyOf))
      .filter((k): k is string => k !== null && !done?.has(k));
  };
  for (const file of files) {
    if (stagedAtStart(file.path)) changeKeys(file).forEach((k) => set(staged, file.path).add(k));
  }

  const toDiff = (file: MockFile, local: boolean): FileDiff => {
    const done = local ? committed.get(file.path) : undefined;
    const inIndex = local ? staged.get(file.path) : undefined;
    const hunks: Hunk[] = [];
    for (const hunk of file.hunks) {
      const lines: Line[] = [];
      for (const row of hunk.rows) {
        const key = keyOf(row);
        if (row[0] === 'c') {
          lines.push({ kind: 'ctx', oldNo: row[1], newNo: row[2], text: row[3], emphasis: [] });
        } else if (key && done?.has(key)) {
          // Committed: an added line is now context, a deleted line is gone.
          if (row[0] === 'a') {
            lines.push({ kind: 'ctx', oldNo: row[1], newNo: row[1], text: row[2], emphasis: [] });
          }
        } else if (row[0] === 'a') {
          lines.push({
            kind: 'add',
            newNo: row[1],
            text: row[2],
            emphasis: [],
            ...(local ? { staged: inIndex?.has(key ?? '') ?? false } : {}),
          });
        } else {
          lines.push({
            kind: 'del',
            oldNo: row[1],
            text: row[2],
            emphasis: [],
            ...(local ? { staged: inIndex?.has(key ?? '') ?? false } : {}),
          });
        }
      }
      if (!lines.some((l) => l.kind !== 'ctx')) continue;
      const oldNos = lines.map((l) => l.oldNo).filter((n): n is number => n !== undefined);
      const newNos = lines.map((l) => l.newNo).filter((n): n is number => n !== undefined);
      hunks.push({
        id: hunk.id,
        oldStart: oldNos[0] ?? 0,
        oldLines: oldNos.length,
        newStart: newNos[0] ?? 0,
        newLines: newNos.length,
        header: hunk.header,
        lines,
        fileLevel: false,
        stagedDiffers: false,
      });
    }
    const count = (kind: Line['kind']) =>
      hunks.flatMap((h) => h.lines).filter((l) => l.kind === kind).length;
    return {
      oldPath: file.status === 'added' ? undefined : (file.oldPath ?? file.path),
      newPath: file.status === 'deleted' ? undefined : file.path,
      status: file.status,
      binary: false,
      additions: count('add'),
      deletions: count('del'),
      layer: layerOf(file.path),
      hunks,
      lineStaging: local,
    };
  };

  const treeFile = (file: MockFile, local: boolean): TreeFile => {
    const diff = toDiff(file, local);
    let stagedState: StageState | undefined;
    if (local) {
      const keys = changeKeys(file);
      const inIndex = keys.filter((k) => staged.get(file.path)?.has(k)).length;
      stagedState = inIndex === 0 ? 'none' : inIndex === keys.length ? 'all' : 'partial';
    }
    return {
      path: file.path,
      name: splitPath(file.path)[1],
      oldPath: file.oldPath,
      status: file.status,
      binary: false,
      additions: diff.additions,
      deletions: diff.deletions,
      staged: stagedState,
      untracked: false,
    };
  };

  const requireRepo = () => {
    if (!repos.active()) throw fail('INVALID_INPUT', 'Pick a repository first.');
  };
  const visible = () => files.filter((f) => changeKeys(f).length > 0);
  const find = (path: string) => {
    const file = files.find((f) => f.path === path);
    if (!file) throw fail('INVALID_INPUT', 'That file has no changes.');
    return file;
  };

  return {
    repoActive: async () => respond(repos.active()),
    repoPick: async () => respond(repos.pick()),
    gitStatus: async () => {
      requireRepo();
      const rows = visible().map((f) => treeFile(f, true));
      const result: LocalChanges = {
        branch: BRANCH,
        head: COMMIT.sha,
        upstream: `origin/${BRANCH}`,
        operation: scenario.operation,
        groups: groupFiles(rows),
        totalFiles: rows.length,
        stagedFiles: rows.filter((r) => r.staged !== 'none').length,
      };
      return respond(result);
    },
    gitCommitInfo: async () => {
      requireRepo();
      const info: CommitInfo = {
        ...COMMIT,
        date: commitDate,
        groups: groupFiles(commit.map((f) => treeFile(f, false))),
        totalFiles: commit.length,
      };
      return respond(info);
    },
    gitFileDiff: async (source, file) => {
      requireRepo();
      if (source.kind === 'commit') {
        const found = commit.find((f) => f.path === file.path);
        if (!found) throw fail('INVALID_INPUT', 'That file is not in the commit.');
        return respond(toDiff(found, false));
      }
      return respond(toDiff(find(file.path), true));
    },
    gitStage: async (selection) => {
      requireRepo();
      if (selection.kind === 'files') {
        for (const ref of selection.files) {
          const file = find(ref.path);
          changeKeys(file).forEach((k) => set(staged, file.path).add(k));
        }
      } else {
        const keys = set(staged, selection.file.path);
        for (const line of selection.lines)
          keys.add(`${line.side === 'old' ? 'o' : 'n'}${String(line.no)}`);
      }
      return respond(undefined);
    },
    gitUnstage: async (selection) => {
      requireRepo();
      if (selection.kind === 'files') {
        for (const ref of selection.files) staged.delete(ref.path);
      } else {
        const keys = staged.get(selection.file.path);
        for (const line of selection.lines)
          keys?.delete(`${line.side === 'old' ? 'o' : 'n'}${String(line.no)}`);
      }
      return respond(undefined);
    },
    gitCommit: async (message, amend) => {
      requireRepo();
      if (!message.trim()) throw fail('INVALID_INPUT', 'Write a commit message first.');
      if (scenario.commitFails === 'hook') {
        throw fail(
          'GIT_FAILED',
          'Commit failed. A hook rejected it.',
          'dotnet format --verify-no-changes\nsrc/App/MauiProgram.cs(24,1): error WHITESPACE: Fix whitespace formatting.',
        );
      }
      const anything = [...staged.values()].some((s) => s.size > 0);
      if (!anything && !amend) throw fail('INVALID_INPUT', 'Nothing is staged for this commit.');
      for (const [path, keys] of staged) {
        keys.forEach((k) => set(committed, path).add(k));
      }
      staged.clear();
      lastMessage = message;
      changed();
      return respond({ ...NEW_COMMIT });
    },
    gitLastMessage: async () => respond(lastMessage),
    gitPush: async () => {
      if (scenario.pushFails === 'rejected') {
        throw fail(
          'CONFLICT',
          "Push rejected: the remote has commits you don't have.",
          '[rejected] (fetch first)',
        );
      }
      return respond({ remoteBranch: `origin/${BRANCH}` });
    },
    riderOpen: async () => respond(undefined),
    onRepoChanged: (listener) => {
      listeners.add(listener);
      return Promise.resolve(() => {
        listeners.delete(listener);
      });
    },
  };
}
