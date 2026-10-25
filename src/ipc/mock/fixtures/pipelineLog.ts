import type { LogLine } from '../../types/LogLine';

type Raw = [string, LogLine['kind']];

/** The logs of Pipeline.dc.html (LOGS), by job name or `<job>:<pipeline>`. */
const LOGS: Record<string, Raw[]> = {
  'ui-tests:android:18342': [
    ['$ emulator -avd pixel_7_api_34 -no-window', 'command'],
    ['emulator: boot completed after 88 s', 'plain'],
    ['$ dotnet test tests/App.UITests -f net9.0-android --logger junit', 'command'],
    ['  Passed  LoginPageTests.Login_WithValidUser_ShowsDeliveries [12 s]', 'pass'],
    ['  Passed  DeliveryListTests.PullToRefresh_ReloadsList [8 s]', 'pass'],
    ['  Failed  DeliveryPhotoPageTests.SendPhoto_Offline_ShowsBanner [30 s]', 'error'],
    ['    Timed out after 30 s waiting for element "OfflineBanner"', 'error'],
    ['  Passed  SignatureTests.Clear_ResetsCanvas [6 s]', 'pass'],
    ['Total tests: 18. Passed: 17. Failed: 1.', 'plain'],
    ['ERROR: Job failed: exit code 1 (allowed to fail)', 'error'],
  ],
  'unit-tests:18321': [
    ['$ dotnet test tests/App.Tests -c Release --logger junit', 'command'],
    ['  App.Tests -> tests/App.Tests/bin/Release/net9.0/App.Tests.dll', 'plain'],
    ['  Failed  SqliteUploadQueueTests.Dequeue_ReturnsOldestFirst [41 ms]', 'error'],
    ['    Expected: "photo-1"  But was: "photo-3"', 'error'],
    ['  Failed  SqliteUploadQueueTests.Dequeue_AfterRestart_KeepsOrder [55 ms]', 'error'],
    ['Failed!  Failed: 2, Passed: 210, Skipped: 0, Total: 212', 'error'],
    ['ERROR: Job failed: exit code 1', 'error'],
  ],
  'distribute:qa': [
    ['$ firebase appdistribution:distribute app-release.apk --groups qa', 'command'],
    ['i  uploading binary...', 'plain'],
    ['✔  uploaded new release 1.8.0 (482) successfully', 'pass'],
    ['✔  distributed to testers/groups successfully', 'pass'],
    ['Job succeeded', 'pass'],
  ],
  'ui-tests:ios-device': [
    ['$ device-lab run --device "iPhone 15" --suite App.UITests', 'command'],
    ['  reserved iPhone 15 (iOS 19.1) in the device lab', 'plain'],
    ['Total tests: 18. Passed: 18.', 'pass'],
    ['Job succeeded', 'pass'],
  ],
};

/** Pipeline.dc.html's genericLog: the log of a job without its own. */
function genericLog(stage: string, name: string): Raw[] {
  if (stage === 'build') {
    const target =
      name === 'build:ios'
        ? ' -f net9.0-ios'
        : name === 'build:android'
          ? ' -f net9.0-android'
          : '';
    return [
      [`$ dotnet build src/App -c Release${target}`, 'command'],
      ['  App -> src/App/bin/Release/App.dll', 'plain'],
      ['Build succeeded. 0 Warning(s) 0 Error(s)', 'pass'],
      ['Job succeeded', 'pass'],
    ];
  }
  if (name === 'unit-tests') {
    return [
      ['$ dotnet test tests/App.Tests -c Release --logger junit', 'command'],
      ['Passed!  Failed: 0, Passed: 214, Skipped: 0, Total: 214', 'pass'],
      ['Job succeeded', 'pass'],
    ];
  }
  return [
    [
      `$ ${name === 'sonar' ? 'dotnet sonarscanner end' : 'dotnet format --verify-no-changes'}`,
      'command',
    ],
    ['No issues found.', 'pass'],
    ['Job succeeded', 'pass'],
  ];
}

/** The whole log of job `name` of stage `stage` in pipeline `pipeline`, as it ends. */
export function jobLog(pipeline: number, stage: string, name: string): LogLine[] {
  const raw = LOGS[`${name}:${String(pipeline)}`] ?? LOGS[name] ?? genericLog(stage, name);
  return raw.map(([text, kind]) => ({ kind, text }));
}

/** The GitLab page of job `id` of the mock project on the mock server (`gitlab.ts`). */
export const jobPage = (id: number) =>
  `https://gitlab.local/mobile/mobile-app/-/jobs/${String(id)}`;
