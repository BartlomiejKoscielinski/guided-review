//! The S-06 file tree, pre-flattened in the core (docs/04 › Performance notes): files grouped
//! by their directory with counts (F-15.2), directories and files sorted case-insensitively.

use serde::Serialize;
use ts_rs::TS;

use super::model::FileStatus;

/// Whether a local file's changes are in the index (F-16.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum StageState {
    None,
    Partial,
    All,
}

/// One file row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TreeFile {
    /// Repository-relative path with `/`.
    pub path: String,
    /// The file name (last segment).
    pub name: String,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub binary: bool,
    pub additions: u32,
    pub deletions: u32,
    /// Local changes only.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged: Option<StageState>,
    /// Local changes only: not tracked by git yet.
    pub untracked: bool,
}

/// A directory row and its files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct FileGroup {
    /// Directory path; empty for files at the repository root.
    pub dir: String,
    pub files: Vec<TreeFile>,
}

/// Splits `path` into its directory and file name.
pub fn split(path: &str) -> (&str, &str) {
    path.rsplit_once('/').unwrap_or(("", path))
}

/// Groups files by directory; directories and files in case-insensitive order.
pub fn group(files: Vec<TreeFile>) -> Vec<FileGroup> {
    let mut files = files;
    files.sort_by(|a, b| {
        let (da, na) = split(&a.path);
        let (db, nb) = split(&b.path);
        sort_key(da)
            .cmp(&sort_key(db))
            .then_with(|| da.cmp(db))
            .then_with(|| sort_key(na).cmp(&sort_key(nb)))
            .then_with(|| na.cmp(nb))
    });
    let mut groups: Vec<FileGroup> = Vec::new();
    for file in files {
        let dir = split(&file.path).0.to_owned();
        match groups.last_mut() {
            Some(last) if last.dir == dir => last.files.push(file),
            _ => groups.push(FileGroup {
                dir,
                files: vec![file],
            }),
        }
    }
    groups
}

fn sort_key(text: &str) -> String {
    text.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str) -> TreeFile {
        TreeFile {
            path: path.into(),
            name: split(path).1.into(),
            old_path: None,
            status: FileStatus::Modified,
            binary: false,
            additions: 1,
            deletions: 0,
            staged: None,
            untracked: false,
        }
    }

    #[test]
    fn f15_2_tree_groups_by_directory_with_counts() {
        let groups = group(vec![
            file("src/App/Views/Deliveries/DeliveryPhotoPage.xaml"),
            file("src/App/App.xaml"),
            file("docs/compiled-bindings.md"),
            file("src/App/Views/Deliveries/DeliveryDetailsPage.xaml"),
            file("README.md"),
            file("src/App/MauiProgram.cs"),
            file("src/app/lower.cs"),
        ]);
        let dirs: Vec<(&str, usize)> = groups
            .iter()
            .map(|g| (g.dir.as_str(), g.files.len()))
            .collect();
        assert_eq!(
            dirs,
            [
                ("", 1),
                ("docs", 1),
                ("src/App", 2),
                ("src/app", 1),
                ("src/App/Views/Deliveries", 2)
            ]
        );
        let names: Vec<&str> = groups[4].files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            names,
            ["DeliveryDetailsPage.xaml", "DeliveryPhotoPage.xaml"]
        );
    }
}
