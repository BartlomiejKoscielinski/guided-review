import type { FileStatus } from '../../types/FileStatus';
import type { MockFile, MockHunk, MockRow } from './changes';

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

const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

/**
 * The ViewModel of step 4 as Review.dc.html shows it: fields and constructor (Claude's fold),
 * SendPhotoAsync and the removed dialogs (+34 −22 together).
 */
const VM_HUNKS: MockHunk[] = [
  {
    id: `${VM}#h1`,
    header: 'DeliveryPhotoViewModel',
    rows: [
      ['c', 12, 12, 'public partial class DeliveryPhotoViewModel : ObservableObject'],
      ['c', 13, 13, '{'],
      ['d', 14, '    private readonly IApiClient _api;'],
      ['a', 14, '    private readonly IUploadQueue _queue;'],
      ['a', 15, '    private readonly UploadWorker _worker;'],
      ['a', 16, '    private readonly IConnectivity _connectivity;'],
      ['c', 15, 17, '    private readonly ICameraService _camera;'],
      ['c', 16, 18, '    private readonly ILogger<DeliveryPhotoViewModel> _logger;'],
      ['c', 17, 19, ''],
      ['d', 18, '    public DeliveryPhotoViewModel(IApiClient api, ICameraService camera,'],
      ['a', 20, '    [ObservableProperty]'],
      ['a', 21, '    private int _pendingCount;'],
      ['a', 22, '    [ObservableProperty]'],
      ['a', 23, '    private string _statusText = "";'],
      ['a', 24, '    public DeliveryPhotoViewModel(IUploadQueue queue, UploadWorker worker,'],
      ['a', 25, '        IConnectivity connectivity, ICameraService camera,'],
      ['c', 19, 26, '        ILogger<DeliveryPhotoViewModel> logger)'],
      ['c', 20, 27, '    {'],
      ['d', 21, '        _api = api;'],
      ['a', 28, '        _queue = queue;'],
      ['a', 29, '        _worker = worker;'],
      ['a', 30, '        _connectivity = connectivity;'],
      ['c', 22, 31, '        _camera = camera;'],
    ],
  },
  {
    id: `${VM}#h2`,
    header: 'SendPhotoAsync',
    rows: [
      ['c', 30, 39, '[RelayCommand]'],
      ['c', 31, 40, 'private async Task SendPhotoAsync()'],
      ['c', 32, 41, '{'],
      ['c', 33, 42, '    IsBusy = true;'],
      ['c', 34, 43, '    try'],
      ['c', 35, 44, '    {'],
      ['c', 36, 45, '        var bytes = await _camera.CaptureAsync();'],
      ['d', 37, '        await _api.UploadPhotoAsync(DeliveryId, bytes);'],
      [
        'd',
        38,
        '        await Shell.Current.DisplayAlert("Wysłano", "Zdjęcie zostało wysłane.", "OK");',
      ],
      [
        'a',
        46,
        '        var upload = new PendingUpload(DeliveryId, bytes, DateTimeOffset.UtcNow);',
      ],
      ['a', 47, '        await _queue.EnqueueAsync(upload);'],
      ['a', 48, '        _worker.Kick();'],
      ['a', 49, '        PendingCount = await _queue.CountAsync();'],
      ['a', 50, '        StatusText = _connectivity.NetworkAccess == NetworkAccess.Internet'],
      ['a', 51, '            ? "Wysyłanie…"'],
      ['a', 52, '            : "Zapisano offline – wyślemy po odzyskaniu sieci";'],
      ['c', 39, 53, '    }'],
      ['d', 40, '    catch (HttpRequestException ex)'],
      ['a', 54, '    catch (Exception ex)'],
      ['c', 41, 55, '    {'],
      ['d', 42, '        _logger.LogError(ex, "Upload failed");'],
      [
        'd',
        43,
        '        await Shell.Current.DisplayAlert("Błąd", "Nie udało się wysłać zdjęcia.", "OK");',
      ],
      ['a', 56, '        _logger.LogError(ex, "Enqueue failed");'],
      ['a', 57, '        StatusText = "Nie udało się zapisać zdjęcia";'],
      ['c', 44, 58, '    }'],
      ['c', 45, 59, '    IsBusy = false;'],
      ['c', 46, 60, '}'],
    ],
  },
  {
    id: `${VM}#h3`,
    header: 'RetryAsync',
    rows: [
      ['c', 47, 61, ''],
      ['d', 48, '[RelayCommand]'],
      ['d', 49, 'private async Task RetryAsync()'],
      ['d', 50, '{'],
      ['d', 51, '    await SendPhotoAsync();'],
      ['d', 52, '}'],
      ['d', 53, ''],
      ['d', 54, 'private async Task ShowErrorAsync(string message)'],
      ['d', 55, '{'],
      ['d', 56, '    await Shell.Current.DisplayAlert("Błąd", message, "OK");'],
      ['d', 57, '}'],
      ['d', 58, ''],
      ['d', 59, 'private Task ShowSentAsync() =>'],
      ['d', 60, '    Shell.Current.DisplayAlert("Wysłano", "Zdjęcie zostało wysłane.", "OK");'],
      ['d', 61, ''],
      ['a', 62, '[RelayCommand]'],
      ['a', 63, 'private async Task RefreshPendingAsync()'],
      ['a', 64, '{'],
      ['a', 65, '    PendingCount = await _queue.CountAsync();'],
      ['a', 66, '}'],
      ['a', 67, ''],
      ['a', 68, 'public async Task OnAppearingAsync()'],
      ['a', 69, '{'],
      ['a', 70, '    await RefreshPendingAsync();'],
      ['a', 71, '    _worker.Kick();'],
      ['a', 72, '}'],
      ['a', 73, ''],
      ['c', 62, 74, '}'],
    ],
  },
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
    hunks:
      path === VM
        ? VM_HUNKS
        : [{ id: `${path}#h1`, header: '', rows: hunkRows(path, status, add, del) }],
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
