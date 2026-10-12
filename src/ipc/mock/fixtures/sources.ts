import type { CommitRow } from '../../types/CommitRow';
import type { StatusSummary } from '../../types/StatusSummary';
import { BRANCH, COMMIT } from './changes';

const HOUR = 3600 * 1000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

/** The Commits column of the Start mock (F-03.1), newest first. */
export function branchCommits(): CommitRow[] {
  return [
    {
      sha: COMMIT.sha,
      shortSha: COMMIT.shortSha,
      subject: COMMIT.subject,
      author: COMMIT.author,
      date: ago(2 * HOUR),
    },
    {
      sha: '9be0d47c2a1f3e5b6d7c8e9f0a1b2c3d4e5f6a7b',
      shortSha: '9be0d47',
      subject: 'Offline queue: SqliteUploadQueue',
      author: 'Marta K.',
      date: ago(3 * HOUR),
    },
    {
      sha: '51c2e8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6',
      shortSha: '51c2e8a',
      subject: 'Fix: double tap in SendPhoto',
      author: 'You',
      date: ago(26 * HOUR),
    },
    {
      sha: 'e07d3f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
      shortSha: 'e07d3f1',
      subject: 'Update CommunityToolkit.Mvvm',
      author: 'Paweł S.',
      date: ago(30 * HOUR),
    },
    {
      sha: 'c4a19b0f1e2d3c4b5a6978877665544332211009',
      shortSha: 'c4a19b0',
      subject: 'Strings.resx: offline messages',
      author: 'Marta K.',
      date: ago(50 * HOUR),
    },
  ];
}

/** Branches the mock repository knows; the first is checked out. */
export const BRANCHES = [BRANCH, 'develop', 'main', 'feature/offline-queue'];

/** The My changes column of the Start mock (F-03.3). */
export const STATUS_SUMMARY: StatusSummary = {
  branch: BRANCH,
  target: 'origin/develop',
  targetName: 'develop',
  uncommitted: { files: 100, additions: 318, deletions: 142 },
  staged: { files: 12, additions: 41, deletions: 9 },
  branchVsTarget: { commits: 3, files: 104 },
};
