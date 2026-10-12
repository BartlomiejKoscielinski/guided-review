//! `%APPDATA%\GuidedReview\tmp\<task-id>\`: the inputs of one Claude task (diffs, rendered
//! system prompt). It holds source code, so it is deleted when the task ends, and `tmp\` is
//! swept on start (docs/04 › Files and folders).

use std::io;
use std::path::{Path, PathBuf};

/// A task folder, removed on drop.
#[derive(Debug)]
pub struct TaskDir {
    id: String,
    path: PathBuf,
}

impl TaskDir {
    pub fn create(tmp_root: &Path) -> io::Result<Self> {
        let id = uuid::Uuid::new_v4().to_string();
        let path = tmp_root.join(&id);
        std::fs::create_dir_all(&path)?;
        Ok(Self { id, path })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Writes an input file and returns its absolute path.
    pub fn write(&self, name: &str, content: &str) -> io::Result<PathBuf> {
        let file = self.path.join(name);
        std::fs::write(&file, content)?;
        Ok(file)
    }
}

impl Drop for TaskDir {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.path) {
            tracing::warn!(%error, task = %self.id, "task folder not removed");
        }
    }
}

/// `%APPDATA%\GuidedReview\tmp`.
pub fn tmp_root(app_data: &Path) -> PathBuf {
    app_data.join("tmp")
}

/// Removes everything left in `tmp\` (a crash may leave task folders behind).
pub fn sweep(tmp_root: &Path) {
    let Ok(entries) = std::fs::read_dir(tmp_root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let removed = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(error) = removed {
            tracing::warn!(%error, "leftover task file not removed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_folders_are_removed_on_drop_and_swept() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Zażółć").join("tmp");
        let dir = TaskDir::create(&root).unwrap();
        let file = dir.write("staged.diff", "diff").unwrap();
        assert!(file.is_file());
        let path = dir.path().to_path_buf();
        drop(dir);
        assert!(!path.exists());
        std::fs::create_dir_all(root.join("left-over")).unwrap();
        std::fs::write(root.join("left-over").join("a.diff"), "x").unwrap();
        sweep(&root);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    }
}
