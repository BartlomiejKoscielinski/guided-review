//! Synthetic git repositories for tests and the demo (docs/09 › Fixture repositories, ADR-019).
//! Each one lives in `%TEMP%\gr fixture zażółć <label> <stamp>\repo ąę` (spaces and Polish
//! characters on purpose) and is removed on drop unless kept. Only synthetic content.
//!
//! This is test code: it runs git directly (`std::process::Command`), never the app's runner.
#![allow(
    dead_code,
    reason = "each test binary uses a different part of the helper"
)]
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test helper")]

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static COUNTER: AtomicU32 = AtomicU32::new(0);

pub struct FixtureRepo {
    /// The temp folder holding the repository (and a bare remote, if any).
    pub root: PathBuf,
    /// The working tree.
    pub path: PathBuf,
    keep: bool,
}

impl FixtureRepo {
    /// A new repository on branch `main` with a local identity, no hooks, no signing and
    /// `core.autocrlf=false` (Git for Windows sets `true` system-wide; tests that need it set it).
    pub fn new(label: &str) -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "gr fixture zażółć {label} {stamp}-{}-{n}",
            std::process::id()
        ));
        let path = root.join("repo ąę");
        std::fs::create_dir_all(&path).unwrap();
        let repo = Self {
            root,
            path,
            keep: false,
        };
        repo.git(&["init", "-q", "-b", "main"]);
        for (key, value) in [
            ("user.name", "Test Łukasz"),
            ("user.email", "test@example.invalid"),
            ("core.autocrlf", "false"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", ".no-hooks"),
        ] {
            repo.git(&["config", key, value]);
        }
        repo
    }

    /// Keeps the folder after drop (demo fixtures).
    pub fn keep(mut self) -> Self {
        self.keep = true;
        self
    }

    pub fn file(&self, rel: &str) -> PathBuf {
        self.path.join(rel)
    }

    /// Writes a file (creating folders); `content` is written as is.
    pub fn write(&self, rel: &str, content: &str) {
        self.write_bytes(rel, content.as_bytes());
    }

    pub fn write_bytes(&self, rel: &str, content: &[u8]) {
        let file = self.file(rel);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }

    pub fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.file(rel)).unwrap()
    }

    pub fn remove(&self, rel: &str) {
        std::fs::remove_file(self.file(rel)).unwrap();
    }

    /// Runs git in the working tree and returns stdout; panics on failure.
    pub fn git(&self, args: &[&str]) -> String {
        self.git_stdin(args, None)
    }

    pub fn git_stdin(&self, args: &[&str], stdin: Option<&[u8]>) -> String {
        let mut cmd = Command::new("git");
        cmd.args(args)
            .current_dir(&self.path)
            .env("LC_ALL", "C")
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        if let Some(bytes) = stdin {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(bytes).unwrap();
        }
        let out = child.wait_with_output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    }

    /// `git add -A` + commit; returns the full SHA.
    pub fn commit_all(&self, message: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "--allow-empty", "-m", message]);
        self.head()
    }

    pub fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"]).trim().to_owned()
    }

    /// The staged diff (`git diff --cached`), for assertions.
    pub fn staged(&self) -> String {
        self.git(&["diff", "--cached", "--no-color"])
    }

    /// The unstaged diff (`git diff`), for assertions.
    pub fn unstaged(&self) -> String {
        self.git(&["diff", "--no-color"])
    }

    /// Content of a file in the index.
    pub fn index_content(&self, rel: &str) -> String {
        self.git(&["show", &format!(":{rel}")])
    }

    /// A bare repository next to the working tree, added as `origin`.
    pub fn add_bare_origin(&self) -> PathBuf {
        let bare = self.root.join("origin ćma.git");
        let status = Command::new("git")
            .args(["init", "-q", "--bare", "-b", "main"])
            .arg(&bare)
            .stdout(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        self.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        bare
    }
}

impl Drop for FixtureRepo {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
}

/// The repository from the S-06 mock (mobile-app, `chore/compiled-bindings`): one commit with
/// 100 XAML/C# files, then a local change touching all of them (demo: "100-file local change").
pub fn mobile_app_with_local_change(repo: &FixtureRepo) {
    let files = mobile_app_files();
    for path in &files {
        repo.write(path, &original_content(path));
    }
    repo.commit_all("Initial mobile app");
    repo.git(&["checkout", "-q", "-b", "chore/compiled-bindings"]);
    for path in &files {
        repo.write(path, &changed_content(path));
    }
}

/// 100 paths in the folders of the S-06 mock.
pub fn mobile_app_files() -> Vec<String> {
    let groups: [(&str, &[&str]); 10] = [
        ("docs", &["compiled-bindings.md"]),
        (
            "src/App",
            &["App.csproj", "App.xaml", "AppShell.xaml", "MauiProgram.cs"],
        ),
        (
            "src/App/Converters",
            &[
                "BoolToVisibilityConverter.cs",
                "DateToRelativeConverter.cs",
                "DistanceConverter.cs",
                "InverseBoolConverter.cs",
                "StatusToColorConverter.cs",
                "StatusToIconConverter.cs",
                "StringNotEmptyConverter.cs",
                "WeightConverter.cs",
            ],
        ),
        ("src/App/Resources/Styles", &["Colors.xaml", "Styles.xaml"]),
        ("src/App/ViewModels", VIEW_MODELS),
        (
            "src/App/Views/Account",
            &[
                "AboutPage.xaml",
                "LanguagePage.xaml",
                "LoginPage.xaml",
                "PrivacyPage.xaml",
                "ProfilePage.xaml",
                "SettingsPage.xaml",
                "ShiftPage.xaml",
            ],
        ),
        (
            "src/App/Views/Deliveries",
            &[
                "DeliveryDetailsPage.xaml",
                "DeliveryFilterPopup.xaml",
                "DeliveryHistoryPage.xaml",
                "DeliveryIssuePage.xaml",
                "DeliveryListPage.xaml",
                "DeliveryMapPage.xaml",
                "DeliveryNotesPage.xaml",
                "DeliveryPhotoPage.xaml",
                "DeliveryReturnPage.xaml",
                "DeliverySignaturePage.xaml",
                "DeliverySummaryPage.xaml",
                "DeliveryTimelineView.xaml",
            ],
        ),
        (
            "src/App/Views/Scanner",
            &[
                "BarcodeOverlayView.xaml",
                "ManualEntryPage.xaml",
                "MultiScanPage.xaml",
                "ScanHistoryPage.xaml",
                "ScanResultPage.xaml",
                "ScanSettingsPage.xaml",
                "ScannerPage.xaml",
                "TorchToggleView.xaml",
            ],
        ),
        (
            "src/App/Views/Shared",
            &[
                "AvatarView.xaml",
                "EmptyStateView.xaml",
                "ErrorView.xaml",
                "LoadingView.xaml",
                "OfflineBanner.xaml",
                "PrimaryButton.xaml",
                "SectionHeader.xaml",
                "StatusChip.xaml",
                "ToastView.xaml",
            ],
        ),
        ("tests/App.Tests/ViewModels", VIEW_MODEL_TESTS),
    ];
    groups
        .iter()
        .flat_map(|(dir, files)| files.iter().map(move |f| format!("{dir}/{f}")))
        .collect()
}

const VIEW_MODELS: &[&str] = &[
    "AboutViewModel.cs",
    "BarcodeOverlayViewModel.cs",
    "BaseViewModel.cs",
    "DeliveryDetailsViewModel.cs",
    "DeliveryFilterViewModel.cs",
    "DeliveryHistoryViewModel.cs",
    "DeliveryIssueViewModel.cs",
    "DeliveryListViewModel.cs",
    "DeliveryMapViewModel.cs",
    "DeliveryNotesViewModel.cs",
    "DeliveryPhotoViewModel.cs",
    "DeliveryReturnViewModel.cs",
    "DeliverySignatureViewModel.cs",
    "DeliverySummaryViewModel.cs",
    "DeliveryTimelineViewModel.cs",
    "LanguageViewModel.cs",
    "LoginViewModel.cs",
    "ManualEntryViewModel.cs",
    "MultiScanViewModel.cs",
    "PrivacyViewModel.cs",
    "ProfileViewModel.cs",
    "ScanHistoryViewModel.cs",
    "ScanResultViewModel.cs",
    "ScanSettingsViewModel.cs",
    "ScannerViewModel.cs",
    "SettingsViewModel.cs",
    "ShiftViewModel.cs",
    "StatusChipViewModel.cs",
    "ToastViewModel.cs",
    "ViewModelLocator.cs",
];

const VIEW_MODEL_TESTS: &[&str] = &[
    "AboutViewModelTests.cs",
    "DeliveryDetailsViewModelTests.cs",
    "DeliveryFilterViewModelTests.cs",
    "DeliveryHistoryViewModelTests.cs",
    "DeliveryIssueViewModelTests.cs",
    "DeliveryListViewModelTests.cs",
    "DeliveryMapViewModelTests.cs",
    "DeliveryNotesViewModelTests.cs",
    "DeliveryPhotoViewModelTests.cs",
    "DeliveryReturnViewModelTests.cs",
    "DeliverySignatureViewModelTests.cs",
    "LoginViewModelTests.cs",
    "ManualEntryViewModelTests.cs",
    "MultiScanViewModelTests.cs",
    "ProfileViewModelTests.cs",
    "ScanHistoryViewModelTests.cs",
    "ScanResultViewModelTests.cs",
    "ScannerViewModelTests.cs",
    "SettingsViewModelTests.cs",
];

fn base_name(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.split('.').next().unwrap_or(name)
}

fn original_content(path: &str) -> String {
    let name = base_name(path);
    if path.ends_with(".xaml") {
        format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n<ContentPage xmlns=\"http://schemas.microsoft.com/dotnet/2021/maui\"\n             xmlns:x=\"http://schemas.microsoft.com/winfx/2009/xaml\"\n             x:Class=\"Mobile.App.Views.{name}\">\n    <Grid RowDefinitions=\"Auto,*,Auto\">\n        <Label Text=\"{{Binding StatusText}}\" IsVisible=\"{{Binding HasStatus}}\" />\n        <Image Source=\"{{Binding Preview}}\" Grid.Row=\"1\" />\n    </Grid>\n</ContentPage>\n"
        )
    } else if path.ends_with(".md") {
        "# Notes\n\nNothing yet.\n".to_owned()
    } else if path.ends_with(".csproj") {
        "<Project Sdk=\"Microsoft.NET.Sdk\">\n<PropertyGroup>\n  <Nullable>enable</Nullable>\n</PropertyGroup>\n</Project>\n".to_owned()
    } else {
        format!(
            "namespace Mobile.App;\n\npublic partial class {name} : ObservableObject\n{{\n    [ObservableProperty] private string _title;\n\n    public string Zażółć => \"gęślą jaźń\";\n}}\n"
        )
    }
}

fn changed_content(path: &str) -> String {
    let name = base_name(path);
    if path.ends_with(".xaml") {
        let vm = name
            .trim_end_matches("Page")
            .trim_end_matches("View")
            .trim_end_matches("Popup");
        format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\" ?>\n<ContentPage xmlns=\"http://schemas.microsoft.com/dotnet/2021/maui\"\n             xmlns:x=\"http://schemas.microsoft.com/winfx/2009/xaml\"\n             xmlns:vm=\"clr-namespace:Mobile.App.ViewModels\"\n             x:DataType=\"vm:{vm}ViewModel\"\n             x:Class=\"Mobile.App.Views.{name}\">\n    <Grid RowDefinitions=\"Auto,*,Auto\">\n        <Label Text=\"{{Binding StatusText}}\"\n               IsVisible=\"{{Binding StatusText, Converter={{StaticResource StringNotEmptyConverter}}}}\" />\n        <Image Source=\"{{Binding Preview}}\" Grid.Row=\"1\" />\n    </Grid>\n</ContentPage>\n"
        )
    } else if path.ends_with(".md") {
        "# Compiled bindings\n\nEvery page and view declares x:DataType, so bindings are checked at build time.\n".to_owned()
    } else if path.ends_with(".csproj") {
        "<Project Sdk=\"Microsoft.NET.Sdk\">\n<PropertyGroup>\n  <MauiEnableXamlCBindingWithSourceCompilation>true</MauiEnableXamlCBindingWithSourceCompilation>\n  <Nullable>enable</Nullable>\n</PropertyGroup>\n</Project>\n".to_owned()
    } else {
        format!(
            "namespace Mobile.App;\n\npublic partial class {name} : ObservableObject\n{{\n    [ObservableProperty] private string _title = string.Empty;\n\n    public string Zażółć => \"gęślą jaźń\";\n}}\n"
        )
    }
}
