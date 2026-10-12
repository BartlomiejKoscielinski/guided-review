/**
 * Example data of S-06 from `docs/design/mocks/Changes.dc.html`: the mobile-app repository on
 * `chore/compiled-bindings` with 100 changed files, and commit a3f9c12 by Marta K. The hunks
 * follow the mock's `hunksFor()`; where the mock abbreviates ("61 more lines") the lines are
 * generated, so the counts match the tree.
 */
import type { FileStatus } from '../../types/FileStatus';

/** A row of a mock hunk: context (old, new, text), added (new, text), deleted (old, text). */
export type MockRow = ['c', number, number, string] | ['a', number, string] | ['d', number, string];

export interface MockHunk {
  id: string;
  header: string;
  rows: MockRow[];
}

export interface MockFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  hunks: MockHunk[];
}

export const REPO = { name: 'mobile-app', path: 'C:\\src\\mobile-app' };
export const BRANCH = 'chore/compiled-bindings';

const LOCAL_GROUPS: [string, string[]][] = [
  ['docs', ['compiled-bindings.md']],
  ['src/App', ['App.csproj', 'App.xaml', 'AppShell.xaml', 'MauiProgram.cs']],
  [
    'src/App/Converters',
    [
      'BoolToVisibilityConverter.cs',
      'DateToRelativeConverter.cs',
      'DistanceConverter.cs',
      'InverseBoolConverter.cs',
      'StatusToColorConverter.cs',
      'StatusToIconConverter.cs',
      'StringNotEmptyConverter.cs',
      'WeightConverter.cs',
    ],
  ],
  ['src/App/Resources/Styles', ['Colors.xaml', 'Styles.xaml']],
  [
    'src/App/ViewModels',
    [
      'AboutViewModel.cs',
      'BarcodeOverlayViewModel.cs',
      'BaseViewModel.cs',
      'DeliveryDetailsViewModel.cs',
      'DeliveryFilterViewModel.cs',
      'DeliveryHistoryViewModel.cs',
      'DeliveryIssueViewModel.cs',
      'DeliveryListViewModel.cs',
      'DeliveryMapViewModel.cs',
      'DeliveryNotesViewModel.cs',
      'DeliveryPhotoViewModel.cs',
      'DeliveryReturnViewModel.cs',
      'DeliverySignatureViewModel.cs',
      'DeliverySummaryViewModel.cs',
      'DeliveryTimelineViewModel.cs',
      'LanguageViewModel.cs',
      'LoginViewModel.cs',
      'ManualEntryViewModel.cs',
      'MultiScanViewModel.cs',
      'PrivacyViewModel.cs',
      'ProfileViewModel.cs',
      'ScanHistoryViewModel.cs',
      'ScanResultViewModel.cs',
      'ScanSettingsViewModel.cs',
      'ScannerViewModel.cs',
      'SettingsViewModel.cs',
      'ShiftViewModel.cs',
      'StatusChipViewModel.cs',
      'ToastViewModel.cs',
      'ViewModelLocator.cs',
    ],
  ],
  [
    'src/App/Views/Account',
    [
      'AboutPage.xaml',
      'LanguagePage.xaml',
      'LoginPage.xaml',
      'PrivacyPage.xaml',
      'ProfilePage.xaml',
      'SettingsPage.xaml',
      'ShiftPage.xaml',
    ],
  ],
  [
    'src/App/Views/Deliveries',
    [
      'DeliveryDetailsPage.xaml',
      'DeliveryFilterPopup.xaml',
      'DeliveryHistoryPage.xaml',
      'DeliveryIssuePage.xaml',
      'DeliveryListPage.xaml',
      'DeliveryMapPage.xaml',
      'DeliveryNotesPage.xaml',
      'DeliveryPhotoPage.xaml',
      'DeliveryReturnPage.xaml',
      'DeliverySignaturePage.xaml',
      'DeliverySummaryPage.xaml',
      'DeliveryTimelineView.xaml',
    ],
  ],
  [
    'src/App/Views/Scanner',
    [
      'BarcodeOverlayView.xaml',
      'ManualEntryPage.xaml',
      'MultiScanPage.xaml',
      'ScanHistoryPage.xaml',
      'ScanResultPage.xaml',
      'ScanSettingsPage.xaml',
      'ScannerPage.xaml',
      'TorchToggleView.xaml',
    ],
  ],
  [
    'src/App/Views/Shared',
    [
      'AvatarView.xaml',
      'EmptyStateView.xaml',
      'ErrorView.xaml',
      'LoadingView.xaml',
      'OfflineBanner.xaml',
      'PrimaryButton.xaml',
      'SectionHeader.xaml',
      'StatusChip.xaml',
      'ToastView.xaml',
    ],
  ],
  [
    'tests/App.Tests/ViewModels',
    [
      'AboutViewModelTests.cs',
      'DeliveryDetailsViewModelTests.cs',
      'DeliveryFilterViewModelTests.cs',
      'DeliveryHistoryViewModelTests.cs',
      'DeliveryIssueViewModelTests.cs',
      'DeliveryListViewModelTests.cs',
      'DeliveryMapViewModelTests.cs',
      'DeliveryNotesViewModelTests.cs',
      'DeliveryPhotoViewModelTests.cs',
      'DeliveryReturnViewModelTests.cs',
      'DeliverySignatureViewModelTests.cs',
      'LoginViewModelTests.cs',
      'ManualEntryViewModelTests.cs',
      'MultiScanViewModelTests.cs',
      'ProfileViewModelTests.cs',
      'ScanHistoryViewModelTests.cs',
      'ScanResultViewModelTests.cs',
      'ScannerViewModelTests.cs',
      'SettingsViewModelTests.cs',
    ],
  ],
];

const base = (name: string) => name.replace(/\.[^.]+$/, '');

/** Lines `from`…`from+count-1` as added rows with generated text. */
function filler(from: number, count: number, text: (n: number) => string): MockRow[] {
  return Array.from({ length: count }, (_, i): MockRow => ['a', from + i, text(from + i)]);
}

function localHunks(path: string): MockHunk[] {
  const name = path.split('/').pop() ?? path;
  const b = base(name);
  const h = (header: string, rows: MockRow[], id = 'h1'): MockHunk => ({
    id: `${path}#${id}`,
    header,
    rows,
  });
  if (path === 'docs/compiled-bindings.md') {
    return [
      h('', [
        ['a', 1, '# Compiled bindings'],
        ['a', 2, ''],
        ['a', 3, 'Every page and view declares x:DataType, so bindings are checked at build time.'],
        ...filler(4, 61, (n) => (n % 6 === 0 ? '' : `- Page ${String(n)}: x:DataType set.`)),
      ]),
    ];
  }
  if (path === 'src/App/ViewModels/ViewModelLocator.cs') {
    const rows: MockRow[] = [
      ['d', 1, 'namespace Mobile.App.ViewModels;'],
      ['d', 2, ''],
      ['d', 3, 'public static class ViewModelLocator'],
      ['d', 4, '{'],
      ['d', 5, '    public static DeliveryListViewModel DeliveryList =>'],
    ];
    for (let n = 6; n <= 48; n += 1) {
      rows.push(['d', n, n === 48 ? '}' : `        ServiceProvider.Get<ViewModel${String(n)}>();`]);
    }
    return [h('', rows)];
  }
  if (path === 'src/App/App.csproj') {
    return [
      h('', [
        ['c', 8, 8, '<PropertyGroup>'],
        [
          'a',
          9,
          '  <MauiEnableXamlCBindingWithSourceCompilation>true</MauiEnableXamlCBindingWithSourceCompilation>',
        ],
        ['c', 9, 10, '  <Nullable>enable</Nullable>'],
      ]),
    ];
  }
  if (path === 'src/App/MauiProgram.cs') {
    return [
      h('', [
        ['c', 24, 24, 'builder.Services.AddTransient<DeliveryPhotoViewModel>();'],
        ['d', 25, 'builder.Services.AddSingleton<ViewModelLocator>();'],
        ['c', 26, 25, 'builder.Services.AddTransient<DeliveryListViewModel>();'],
      ]),
    ];
  }
  if (path === 'src/App/Views/Deliveries/DeliveryPhotoPage.xaml') {
    return [
      h('', [
        ['c', 1, 1, '<?xml version="1.0" encoding="utf-8" ?>'],
        ['c', 2, 2, '<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"'],
        ['c', 3, 3, '             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"'],
        ['a', 4, '             xmlns:vm="clr-namespace:Mobile.App.ViewModels"'],
        ['a', 5, '             x:DataType="vm:DeliveryPhotoViewModel"'],
        ['c', 4, 6, '             x:Class="Mobile.App.Views.DeliveryPhotoPage">'],
      ]),
      h(
        '',
        [
          ['c', 20, 22, '    <Grid RowDefinitions="Auto,*,Auto">'],
          [
            'd',
            21,
            '        <Label Text="{Binding StatusText}" IsVisible="{Binding HasStatus}" />',
          ],
          ['a', 23, '        <Label Text="{Binding StatusText}"'],
          [
            'a',
            24,
            '               IsVisible="{Binding StatusText, Converter={StaticResource StringNotEmptyConverter}}" />',
          ],
          ['c', 22, 25, '        <Image Source="{Binding Preview}" Grid.Row="1" />'],
        ],
        'h2',
      ),
    ];
  }
  if (path.startsWith('src/App/Resources') || name === 'App.xaml' || name === 'AppShell.xaml') {
    return [
      h('', [
        ['d', 12, '    <Setter Property="FontSize" Value="14"/>'],
        ['a', 12, '    <Setter Property="FontSize" Value="14" />'],
        ['c', 13, 13, '</Style>'],
      ]),
    ];
  }
  if (path.endsWith('.xaml')) {
    const root = /(View|Banner|Button|Header|Chip)$/.test(b) ? 'ContentView' : 'ContentPage';
    const vm = b.replace(/(Page|View|Popup)$/, '') + 'ViewModel';
    return [
      h('', [
        ['c', 1, 1, '<?xml version="1.0" encoding="utf-8" ?>'],
        ['c', 2, 2, `<${root} xmlns="http://schemas.microsoft.com/dotnet/2021/maui"`],
        ['c', 3, 3, '             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"'],
        ['a', 4, '             xmlns:vm="clr-namespace:Mobile.App.ViewModels"'],
        ['a', 5, `             x:DataType="vm:${vm}"`],
        ['c', 4, 6, `             x:Class="Mobile.App.Views.${b}">`],
      ]),
    ];
  }
  if (path.includes('/Converters/')) {
    return [
      h('', [
        ['c', 8, 8, `public class ${b} : IValueConverter`],
        ['c', 9, 9, '{'],
        [
          'd',
          10,
          '    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)',
        ],
        [
          'a',
          10,
          '    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)',
        ],
        ['c', 11, 11, '    {'],
      ]),
    ];
  }
  if (path.startsWith('tests/')) {
    const target = b.replace(/Tests$/, '');
    return [
      h('', [
        ['c', 14, 14, '[Fact]'],
        ['d', 15, 'public void Binds_title()'],
        ['a', 15, 'public void Title_is_never_null()'],
        ['c', 16, 16, '{'],
        ['a', 17, `    Assert.NotNull(new ${target}().Title);`],
      ]),
    ];
  }
  return [
    h('', [
      ['c', 9, 9, `public partial class ${b} : ObservableObject`],
      ['c', 10, 10, '{'],
      ['d', 11, '    [ObservableProperty] private string _title;'],
      ['a', 11, '    [ObservableProperty] private string _title = string.Empty;'],
      ['c', 12, 12, ''],
    ]),
  ];
}

function localStatus(path: string): { status: FileStatus; oldPath?: string } {
  if (path === 'docs/compiled-bindings.md') return { status: 'added' };
  if (path === 'src/App/ViewModels/ViewModelLocator.cs') return { status: 'deleted' };
  if (path === 'src/App/Views/Deliveries/DeliveryFilterPopup.xaml') {
    return { status: 'renamed', oldPath: 'src/App/Views/Deliveries/DeliveryFilterPage.xaml' };
  }
  return { status: 'modified' };
}

/** The 100 local changes. */
export function localFiles(): MockFile[] {
  return LOCAL_GROUPS.flatMap(([dir, files]) =>
    files.map((name) => {
      const path = `${dir}/${name}`;
      return { path, ...localStatus(path), hunks: localHunks(path) };
    }),
  );
}

/**
 * A large local change for the F-15.2 performance check: `count` modified files spread over
 * folders of 20.
 */
export function manyFiles(count: number): MockFile[] {
  return Array.from({ length: count }, (_, i) => {
    const path = `src/Generated/Folder${String(Math.floor(i / 20)).padStart(3, '0')}/File${String(i).padStart(4, '0')}.cs`;
    return { path, status: 'modified' as const, hunks: localHunks(path) };
  });
}

/** Files at the start that are already in the index: all but docs/ and tests/ ("80 of 100"). */
export function stagedAtStart(path: string): boolean {
  return !(path.startsWith('docs/') || path.startsWith('tests/'));
}

export const COMMIT = {
  sha: 'a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c',
  shortSha: 'a3f9c12',
  parents: ['9be0d47c2a1f3e5b6d7c8e9f0a1b2c3d4e5f6a7b'],
  author: 'Marta K.',
  subject: 'UploadWorker: jittered backoff',
  body: 'The delay between retries grows exponentially. Random jitter spreads retries from many devices over time.',
};

/** The commit's three files. */
export function commitFiles(): MockFile[] {
  return [
    {
      path: 'src/Core/QueueItemStatus.cs',
      status: 'added',
      hunks: [
        {
          id: 'c#q1',
          header: '',
          rows: [
            ['a', 1, 'namespace Mobile.Core;'],
            ['a', 2, ''],
            ['a', 3, 'public enum QueueItemStatus'],
            ['a', 4, '{'],
            ['a', 5, '    Pending,'],
            ['a', 6, '    Failed'],
            ['a', 7, '}'],
          ],
        },
      ],
    },
    {
      path: 'src/Infrastructure/Workers/UploadWorker.cs',
      status: 'modified',
      hunks: [
        {
          id: 'c#u1',
          header: '',
          rows: [
            ['c', 12, 12, 'private readonly IUploadQueue _queue;'],
            ['c', 13, 13, 'private readonly IPhotoApi _api;'],
            ['a', 14, 'private const int MaxAttempts = 5;'],
            ['a', 15, 'private static readonly TimeSpan BaseDelay = TimeSpan.FromSeconds(2);'],
            ['c', 14, 16, ''],
          ],
        },
        {
          id: 'c#u2',
          header: 'ProcessAsync',
          rows: [
            ['c', 54, 56, '        }'],
            ['d', 55, '        catch (HttpRequestException ex)'],
            ['a', 57, '        catch (HttpRequestException ex) when (item.Attempts < MaxAttempts)'],
            ['c', 56, 58, '        {'],
            ['a', 59, '            await _queue.MarkAttemptAsync(item.Id, ct);'],
            ['a', 60, '            await Task.Delay(Backoff(item.Attempts), ct);'],
            ['c', 57, 61, '        }'],
          ],
        },
        {
          id: 'c#u3',
          header: '',
          rows: [
            ['c', 70, 79, '}'],
            ['a', 80, ''],
            ['a', 81, 'private static TimeSpan Backoff(int attempt) =>'],
            [
              'a',
              82,
              '    BaseDelay * Math.Pow(2, attempt) + TimeSpan.FromMilliseconds(Random.Shared.Next(0, 500));',
            ],
            ['c', 71, 83, '}'],
          ],
        },
      ],
    },
    {
      path: 'tests/Infrastructure.Tests/UploadWorkerTests.cs',
      status: 'modified',
      hunks: [
        {
          id: 'c#t1',
          header: '',
          rows: [
            ['c', 40, 40, '}'],
            ['a', 41, ''],
            ['a', 42, '[Fact]'],
            ['a', 43, 'public async Task Marks_item_failed_after_max_attempts()'],
            ['a', 44, '{'],
            ['a', 45, '    var api = new FailingPhotoApi(new HttpRequestException("500"));'],
          ],
        },
      ],
    },
  ];
}

/** "Created 7c1e2a9" after a commit (S06-changes-committed.png). */
export const NEW_COMMIT = {
  sha: '7c1e2a9d0b3f4e5a6c7d8e9f0a1b2c3d4e5f6a70',
  shortSha: '7c1e2a9',
};
