import type { FileStatus } from '../../types/FileStatus';
import type { MockFile, MockRow } from './changes';

/** Branches of the mock MRs (the Overview mock: `feature/offline-upload → develop`). */
export const MR_BRANCHES = { source: 'feature/offline-upload', target: 'develop' };

/** !482 "Offline queue for delivery photos": path, status, added and deleted lines (+462 −61). */
const MR_482: readonly [string, FileStatus, number, number][] = [
  ['src/Mobile.Core/Uploads/QueuedPhoto.cs', 'added', 38, 0],
  ['src/Mobile.Core/Uploads/IUploadQueue.cs', 'added', 22, 0],
  ['src/Mobile.Core/Uploads/RetryPolicy.cs', 'added', 41, 0],
  ['src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs', 'added', 86, 0],
  ['src/Mobile.Infrastructure/Uploads/UploadWorker.cs', 'added', 74, 0],
  ['src/Mobile.Infrastructure/DependencyInjection.cs', 'modified', 6, 1],
  ['src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs', 'modified', 34, 22],
  ['src/Mobile.App/Services/PhotoUploadService.cs', 'modified', 18, 27],
  ['src/Mobile.App/Views/DeliveryPhotoPage.xaml', 'modified', 14, 2],
  ['src/Mobile.App/Views/OfflineBanner.xaml', 'added', 21, 0],
  ['src/Mobile.App/Converters/PendingCountConverter.cs', 'added', 12, 0],
  ['src/Mobile.App/Platforms/Android/AndroidManifest.xml', 'modified', 2, 0],
  ['src/Mobile.App/Resources/Strings/AppResources.resx', 'modified', 8, 0],
  ['tests/Mobile.Core.Tests/RetryPolicyTests.cs', 'added', 48, 0],
  ['tests/Mobile.Infrastructure.Tests/SqliteUploadQueueTests.cs', 'added', 36, 0],
  ['src/Mobile.App/Mobile.App.csproj', 'modified', 2, 9],
];

function lineText(path: string, n: number): string {
  const name = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
  if (path.endsWith('.xaml') || path.endsWith('.xml') || path.endsWith('.resx')) {
    return `    <!-- ${name} ${String(n)} -->`;
  }
  return `    // ${name}: line ${String(n)}`;
}

/** One hunk per file: a context line, the deletions, then the additions. */
function hunkRows(path: string, status: FileStatus, add: number, del: number): MockRow[] {
  if (status === 'added') {
    return Array.from({ length: add }, (_, i): MockRow => ['a', i + 1, lineText(path, i + 1)]);
  }
  return [
    ['c', 1, 1, lineText(path, 0)],
    ...Array.from({ length: del }, (_, i): MockRow => [
      'd',
      i + 2,
      `${lineText(path, i + 2)} (old)`,
    ]),
    ...Array.from({ length: add }, (_, i): MockRow => ['a', i + 2, lineText(path, i + 2)]),
  ];
}

/** The files of a mock MR session (S-06 MR browse); every MR shows !482's change. */
export function mrFiles(): MockFile[] {
  return MR_482.map(([path, status, add, del]) => ({
    path,
    status,
    hunks: [{ id: `${path}#h1`, header: '', rows: hunkRows(path, status, add, del) }],
  }));
}

/** Added and deleted lines of a mock file. */
export function lineCounts(file: MockFile): { additions: number; deletions: number } {
  const rows = file.hunks.flatMap((h) => h.rows);
  return {
    additions: rows.filter((r) => r[0] === 'a').length,
    deletions: rows.filter((r) => r[0] === 'd').length,
  };
}
