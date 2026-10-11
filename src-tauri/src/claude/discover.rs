//! Which Claude Code the app runs (ADR-021): the Settings value, then the native installer's
//! `%USERPROFILE%\.local\bin\claude.exe`, then `claude.exe` on PATH, then an npm install run as
//! `node …\@anthropic-ai\claude-code\cli.js`. `claude.cmd` is never spawned (it would need
//! `cmd.exe`); a `.cmd` shim only tells where the npm install is.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// A runnable Claude Code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaudeExecutable {
    /// `claude.exe` (native installer).
    Native(PathBuf),
    /// An npm install: `node.exe` runs the package's `cli.js`.
    NodeScript { node: PathBuf, script: PathBuf },
}

impl ClaudeExecutable {
    /// The file shown in Settings › Claude (F-18.6).
    pub fn display_path(&self) -> &Path {
        match self {
            Self::Native(path) => path,
            Self::NodeScript { script, .. } => script,
        }
    }
}

/// What discovery looks at; [`DiscoveryInput::from_env`] reads it from the process.
#[derive(Debug, Clone, Default)]
pub struct DiscoveryInput {
    /// `claude.path` from Settings.
    pub configured: Option<PathBuf>,
    /// `%USERPROFILE%`.
    pub user_profile: Option<PathBuf>,
    /// `%APPDATA%` (npm's default global prefix is `%APPDATA%\npm`).
    pub app_data: Option<PathBuf>,
    /// `PATH`.
    pub path: Option<OsString>,
}

impl DiscoveryInput {
    pub fn from_env(configured: Option<PathBuf>) -> Self {
        Self {
            configured,
            user_profile: dirs::home_dir(),
            app_data: dirs::config_dir(),
            path: std::env::var_os("PATH"),
        }
    }
}

const NATIVE_NAME: &str = "claude.exe";
const NPM_SHIM_NAME: &str = "claude.cmd";
const NODE_NAME: &str = "node.exe";
const NPM_CLI_JS: [&str; 4] = ["node_modules", "@anthropic-ai", "claude-code", "cli.js"];

/// Finds Claude Code, or `None` (`CLAUDE_NOT_FOUND`).
pub fn discover(input: &DiscoveryInput) -> Option<ClaudeExecutable> {
    let path_dirs: Vec<PathBuf> = input
        .path
        .as_deref()
        .map(|path| std::env::split_paths(path).collect())
        .unwrap_or_default();
    if let Some(configured) = input.configured.as_deref().filter(|p| p.is_file()) {
        if is_named(configured, NPM_SHIM_NAME) {
            if let Some(found) = configured
                .parent()
                .and_then(|prefix| npm_install(prefix, &path_dirs))
            {
                return Some(found);
            }
        } else {
            return Some(ClaudeExecutable::Native(configured.to_path_buf()));
        }
    }
    let native = input
        .user_profile
        .as_ref()
        .map(|home| home.join(".local").join("bin").join(NATIVE_NAME))
        .into_iter()
        .chain(path_dirs.iter().map(|dir| dir.join(NATIVE_NAME)))
        .find(|candidate| candidate.is_file());
    if let Some(native) = native {
        return Some(ClaudeExecutable::Native(native));
    }
    // npm: the directory holding the claude.cmd shim on PATH is the npm prefix; the default
    // prefix is %APPDATA%\npm.
    path_dirs
        .iter()
        .filter(|dir| dir.join(NPM_SHIM_NAME).is_file())
        .cloned()
        .chain(input.app_data.as_ref().map(|data| data.join("npm")))
        .find_map(|prefix| npm_install(&prefix, &path_dirs))
}

fn npm_install(prefix: &Path, path_dirs: &[PathBuf]) -> Option<ClaudeExecutable> {
    let script = NPM_CLI_JS
        .iter()
        .fold(prefix.to_path_buf(), |path, part| path.join(part));
    if !script.is_file() {
        return None;
    }
    let node = path_dirs
        .iter()
        .map(|dir| dir.join(NODE_NAME))
        .find(|candidate| candidate.is_file())?;
    Some(ClaudeExecutable::NodeScript { node, script })
}

fn is_named(path: &Path, name: &str) -> bool {
    path.file_name()
        .is_some_and(|file| file.to_string_lossy().eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Fixture {
        _dir: tempfile::TempDir,
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().join("Zażółć gęślą");
            fs::create_dir_all(&root).unwrap();
            Self { _dir: dir, root }
        }

        fn file(&self, relative: &str) -> PathBuf {
            let path = self.root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"").unwrap();
            path
        }

        fn dir(&self, relative: &str) -> PathBuf {
            let path = self.root.join(relative);
            fs::create_dir_all(&path).unwrap();
            path
        }

        fn path_var(&self, dirs: &[&str]) -> OsString {
            std::env::join_paths(dirs.iter().map(|d| self.root.join(d))).unwrap()
        }
    }

    const CLI_JS: &str = r"node_modules\@anthropic-ai\claude-code\cli.js";

    #[test]
    fn adr021_settings_value_wins() {
        let f = Fixture::new();
        let configured = f.file(r"custom\claude.exe");
        f.file(r"home\.local\bin\claude.exe");
        let input = DiscoveryInput {
            configured: Some(configured.clone()),
            user_profile: Some(f.root.join("home")),
            ..DiscoveryInput::default()
        };
        assert_eq!(discover(&input), Some(ClaudeExecutable::Native(configured)));
    }

    #[test]
    fn adr021_native_installer_before_path() {
        let f = Fixture::new();
        let native = f.file(r"home\.local\bin\claude.exe");
        f.file(r"bin\claude.exe");
        let input = DiscoveryInput {
            user_profile: Some(f.root.join("home")),
            path: Some(f.path_var(&["bin"])),
            ..DiscoveryInput::default()
        };
        assert_eq!(discover(&input), Some(ClaudeExecutable::Native(native)));
    }

    #[test]
    fn adr021_claude_exe_on_path() {
        let f = Fixture::new();
        f.dir("empty");
        let on_path = f.file(r"tools\claude.exe");
        let input = DiscoveryInput {
            user_profile: Some(f.root.join("home")),
            path: Some(f.path_var(&["empty", "tools"])),
            ..DiscoveryInput::default()
        };
        assert_eq!(discover(&input), Some(ClaudeExecutable::Native(on_path)));
    }

    #[test]
    fn adr021_npm_install_runs_cli_js_with_node_never_cmd() {
        let f = Fixture::new();
        f.file(r"npm-prefix\claude.cmd");
        let script = f.file(&format!(r"npm-prefix\{CLI_JS}"));
        let node = f.file(r"nodejs\node.exe");
        let input = DiscoveryInput {
            path: Some(f.path_var(&["npm-prefix", "nodejs"])),
            ..DiscoveryInput::default()
        };
        assert_eq!(
            discover(&input),
            Some(ClaudeExecutable::NodeScript { node, script })
        );
    }

    #[test]
    fn adr021_default_npm_prefix_in_app_data() {
        let f = Fixture::new();
        let script = f.file(&format!(r"appdata\npm\{CLI_JS}"));
        let node = f.file(r"nodejs\node.exe");
        let input = DiscoveryInput {
            app_data: Some(f.root.join("appdata")),
            path: Some(f.path_var(&["nodejs"])),
            ..DiscoveryInput::default()
        };
        assert_eq!(
            discover(&input),
            Some(ClaudeExecutable::NodeScript { node, script })
        );
    }

    #[test]
    fn adr021_a_configured_cmd_shim_resolves_to_cli_js() {
        let f = Fixture::new();
        let shim = f.file(r"npm-prefix\claude.cmd");
        let script = f.file(&format!(r"npm-prefix\{CLI_JS}"));
        let node = f.file(r"nodejs\node.exe");
        let input = DiscoveryInput {
            configured: Some(shim),
            path: Some(f.path_var(&["nodejs"])),
            ..DiscoveryInput::default()
        };
        assert_eq!(
            discover(&input),
            Some(ClaudeExecutable::NodeScript { node, script })
        );
    }

    #[test]
    fn adr021_cmd_shim_without_node_or_cli_js_is_not_found() {
        let f = Fixture::new();
        f.file(r"npm-prefix\claude.cmd");
        let input = DiscoveryInput {
            path: Some(f.path_var(&["npm-prefix"])),
            ..DiscoveryInput::default()
        };
        assert_eq!(discover(&input), None);
    }

    #[test]
    fn adr021_a_missing_configured_path_falls_through_to_discovery() {
        let f = Fixture::new();
        let native = f.file(r"home\.local\bin\claude.exe");
        let input = DiscoveryInput {
            configured: Some(f.root.join(r"gone\claude.exe")),
            user_profile: Some(f.root.join("home")),
            ..DiscoveryInput::default()
        };
        assert_eq!(discover(&input), Some(ClaudeExecutable::Native(native)));
    }

    #[test]
    fn adr021_nothing_installed() {
        assert_eq!(discover(&DiscoveryInput::default()), None);
    }
}
