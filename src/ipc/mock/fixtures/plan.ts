import type { ChangeStats } from '../../types/ChangeStats';
import type { Layer } from '../../types/Layer';
import type { Plan } from '../../types/Plan';
import type { Step } from '../../types/Step';
import type { Strategy } from '../../types/Strategy';

/** A file of !482 (`fixtures/mr.ts`) as a hunk ID; every mock file has one hunk. */
const hunk = (path: string) => `${path}#h1`;

const CORE = 'src/Mobile.Core/Uploads/';
const INFRA = 'src/Mobile.Infrastructure/';
const APP = 'src/Mobile.App/';

interface MockStep {
  step: Step;
  stats: ChangeStats;
}

const step = (
  id: string,
  title: string,
  shortTitle: string,
  layer: Layer,
  reason: string,
  files: string[],
  [additions, deletions]: [number, number],
  description = reason,
  buildsOn: string[] = [],
): MockStep => ({
  step: {
    id,
    title,
    shortTitle,
    reason,
    description,
    layer,
    hunkIds: files.map(hunk),
    buildsOn,
  },
  stats: { files: files.length, additions, deletions },
});

/**
 * !482's eight steps: titles, layers, reasons and `N files · +add −del` as in Overview.dc.html
 * (the S-02 design numbers, not the mock diff's), short titles as in Review.dc.html's list.
 */
const STEPS: MockStep[] = [
  step(
    's1',
    'Queue contract',
    'Queue contract',
    'core',
    'IUploadQueue and PendingUpload. Everything else builds on this.',
    [`${CORE}QueuedPhoto.cs`, `${CORE}IUploadQueue.cs`],
    [38, 0],
  ),
  step(
    's2',
    'SqliteUploadQueue',
    'SqliteUploadQueue',
    'infrastructure',
    'Implements the contract from step 1.',
    [`${INFRA}Uploads/SqliteUploadQueue.cs`],
    [142, 0],
    undefined,
    ['s1'],
  ),
  step(
    's3',
    'UploadWorker with retries',
    'UploadWorker',
    'infrastructure',
    'Consumes the queue. This is where the race risk lives.',
    [`${INFRA}Uploads/UploadWorker.cs`],
    [96, 0],
    undefined,
    ['s1', 's2'],
  ),
  step(
    's4',
    'ViewModel: queue instead of upload',
    'ViewModel',
    'app',
    'First place where user-facing behavior changes.',
    [`${APP}ViewModels/DeliveryPhotoViewModel.cs`],
    [18, 9],
    'Instead of uploading right away, it stores the photo and wakes the worker from step 3.',
    ['s1', 's3'],
  ),
  step(
    's5',
    'Offline banner in the view',
    'Offline banner',
    'xaml',
    'View and converter that depend on state from step 4.',
    [`${APP}Views/OfflineBanner.xaml`, `${APP}Converters/PendingCountConverter.cs`],
    [24, 2],
    undefined,
    ['s4'],
  ),
  step(
    's6',
    'DI registration and worker start',
    'DI and worker start',
    'app',
    'Wires everything together. Short, but easy to get the lifecycle wrong.',
    [`${INFRA}DependencyInjection.cs`, `${APP}Services/PhotoUploadService.cs`],
    [11, 0],
    undefined,
    ['s2', 's3'],
  ),
  step(
    's7',
    'Android: network state',
    'Android',
    'platforms',
    'One line in AndroidManifest, a new permission.',
    [`${APP}Platforms/Android/AndroidManifest.xml`],
    [1, 0],
  ),
  step(
    's8',
    'Queue tests',
    'Tests',
    'tests',
    'You check them once you know the implementation.',
    ['tests/Mobile.Infrastructure.Tests/SqliteUploadQueueTests.cs'],
    [120, 0],
    undefined,
    ['s2'],
  ),
];

const SKIM_FILES = [
  `${CORE}RetryPolicy.cs`,
  `${APP}Views/DeliveryPhotoPage.xaml`,
  'tests/Mobile.Core.Tests/RetryPolicyTests.cs',
  `${APP}Mobile.App.csproj`,
  `${APP}Resources/Strings/AppResources.resx`,
];

/**
 * Claude's orders; File order as in Overview.dc.html (GitLab path order of the design's files; the
 * fixture's paths are the mock diff's, so the core would sort s5 first: a data difference).
 */
export const MOCK_ORDERS: Record<Strategy, string[]> = {
  contractToUi: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
  testsFirst: ['s8', 's1', 's2', 's3', 's4', 's5', 's6', 's7'],
  fileOrder: ['s6', 's7', 's4', 's5', 's1', 's2', 's3', 's8'],
};

/** !482's plan with the Overview mock's intent, skim row, risks, claims, threads and coverage. */
export function mockPlan(): Plan {
  return {
    intent:
      'Delivery photos no longer get lost without network. Instead of uploading right away, the app stores them in a local SQLite queue, and UploadWorker sends them with retries once the network is back. A banner shows how many photos are waiting.',
    steps: STEPS.map((s) => s.step),
    orders: { contractToUi: MOCK_ORDERS.contractToUi, testsFirst: MOCK_ORDERS.testsFirst },
    skim: [
      {
        hunkIds: SKIM_FILES.map(hunk),
        reason:
          'Formatting (3), csproj with a new package, 3 keys in Strings.resx. Checked: no logic changes.',
      },
    ],
    risks: [
      {
        text: 'Photos stored as BLOBs in SQLite: database size during a long offline period.',
        severity: 'fix',
        steps: ['s2', 's4'],
        app: false,
      },
      {
        text: 'The worker and the command write to the same queue, with no lock when an item is removed.',
        severity: 'fix',
        steps: ['s3'],
        app: false,
      },
      {
        text: 'Worker starts in App: what happens when the app resumes from background?',
        severity: 'q',
        steps: ['s6'],
        app: false,
      },
    ],
    descriptionCheck: [
      { claim: 'Retries with backoff', status: 'found', step: 's3' },
      { claim: 'Banner with the pending count', status: 'found', step: 's5' },
      { claim: 'the new AndroidManifest permission', status: 'notInDescription', step: 's7' },
    ],
    alreadyDiscussed:
      '2 open threads from Paweł S. in step 2. Claude won’t repeat them and shows them in that step as context.',
    coverage: { files: 16, filesTotal: 16, hunks: 31, hunksTotal: 31 },
  };
}

/** Row stats in plan order (`PlanView.stepStats`). */
export const MOCK_STEP_STATS: ChangeStats[] = STEPS.map((s) => s.stats);
/** The skim row: 5 files (`PlanView.skimStats`). */
export const MOCK_SKIM_STATS: ChangeStats[] = [{ files: 5, additions: 113, deletions: 11 }];
