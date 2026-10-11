//! A log file that rotates by size (NFR-08: 10 MB, 5 files). `tracing-appender` rotates by time
//! only, so this is our own: `guided-review.log` is the active file, `guided-review.1.log` the
//! newest rotated one, up to `guided-review.<keep-1>.log`.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Size at which the active file is rotated.
pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// Number of files kept in total (the active one and the rotated ones).
pub const KEEP_FILES: usize = 5;

/// An append-only log file in `dir` that rotates before a record would push it past `max_bytes`.
#[derive(Debug)]
pub struct RotatingFile {
    state: Mutex<State>,
}

#[derive(Debug)]
struct State {
    dir: PathBuf,
    stem: String,
    max_bytes: u64,
    keep: usize,
    file: Option<File>,
    size: u64,
}

impl RotatingFile {
    /// Opens (or creates) `<dir>/<stem>.log` for appending; `dir` is created if missing.
    pub fn open(dir: &Path, stem: &str, max_bytes: u64, keep: usize) -> std::io::Result<Self> {
        fs::create_dir_all(dir)?;
        let mut state = State {
            dir: dir.to_path_buf(),
            stem: stem.to_owned(),
            max_bytes,
            keep: keep.max(1),
            file: None,
            size: 0,
        };
        state.open_active()?;
        Ok(Self {
            state: Mutex::new(state),
        })
    }

    /// Path of the active file, or of the rotated file `index` (1 = newest) when `index > 0`.
    pub fn path(&self, index: usize) -> PathBuf {
        match self.state.lock() {
            Ok(state) => state.path(index),
            Err(poisoned) => poisoned.into_inner().path(index),
        }
    }

    /// Appends one complete record, rotating first when needed. Errors are swallowed: logging
    /// must never fail the app.
    pub fn write_record(&self, record: &[u8]) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(poisoned) => poisoned.into_inner(),
        };
        state.write(record);
    }
}

impl State {
    fn path(&self, index: usize) -> PathBuf {
        let name = if index == 0 {
            format!("{}.log", self.stem)
        } else {
            format!("{}.{index}.log", self.stem)
        };
        self.dir.join(name)
    }

    fn open_active(&mut self) -> std::io::Result<()> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.path(0))?;
        self.size = file.metadata()?.len();
        self.file = Some(file);
        Ok(())
    }

    fn write(&mut self, record: &[u8]) {
        let len = record.len() as u64;
        if self.size > 0 && self.size + len > self.max_bytes && self.rotate().is_err() {
            // The files may be locked (an editor, a virus scanner). Keep appending and retry on
            // the next record, but never let the file grow past twice the limit.
            if self.size + len > self.max_bytes.saturating_mul(2) {
                return;
            }
        }
        if self.file.is_none() && self.open_active().is_err() {
            return;
        }
        if let Some(file) = self.file.as_mut()
            && file.write_all(record).is_ok()
        {
            self.size += len;
        }
    }

    /// `<stem>.log` → `<stem>.1.log` → … → `<stem>.<keep-1>.log` (the oldest is deleted).
    fn rotate(&mut self) -> std::io::Result<()> {
        self.file = None;
        let oldest = self.path(self.keep - 1);
        if self.keep > 1 && oldest.exists() {
            fs::remove_file(&oldest)?;
        }
        for index in (1..self.keep.saturating_sub(1)).rev() {
            let from = self.path(index);
            if from.exists() {
                fs::rename(&from, self.path(index + 1))?;
            }
        }
        if self.keep > 1 {
            fs::rename(self.path(0), self.path(1))?;
        } else {
            fs::remove_file(self.path(0))?;
        }
        self.open_active()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap_or_default()
    }

    #[test]
    fn nfr08_rotation_limits_are_10_mb_and_5_files() {
        assert_eq!(MAX_FILE_BYTES, 10 * 1024 * 1024);
        assert_eq!(KEEP_FILES, 5);
    }

    #[test]
    fn nfr08_rotates_at_the_size_limit_and_keeps_five_files() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("Zażółć gęślą").join("logs");
        let file = RotatingFile::open(&logs, "guided-review", 100, 5).unwrap();
        // 40-byte records: two fit into 100 bytes, the third rotates.
        for i in 0..20 {
            file.write_record(format!("record {i:02} {}\n", "x".repeat(29)).as_bytes());
        }
        let mut names: Vec<String> = fs::read_dir(&logs)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "guided-review.1.log",
                "guided-review.2.log",
                "guided-review.3.log",
                "guided-review.4.log",
                "guided-review.log",
            ]
        );
        assert!(read(&file.path(0)).starts_with("record 18"));
        assert!(read(&file.path(1)).starts_with("record 16"));
        assert!(read(&file.path(4)).starts_with("record 10"));
        for index in 0..5 {
            assert!(fs::metadata(file.path(index)).unwrap().len() <= 100);
        }
    }

    #[test]
    fn nfr08_appends_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        {
            let file = RotatingFile::open(dir.path(), "guided-review", 1000, 5).unwrap();
            file.write_record(b"first run\n");
        }
        let file = RotatingFile::open(dir.path(), "guided-review", 1000, 5).unwrap();
        file.write_record(b"second run\n");
        assert_eq!(read(&file.path(0)), "first run\nsecond run\n");
    }

    #[test]
    fn nfr08_size_after_restart_counts_towards_rotation() {
        let dir = tempfile::tempdir().unwrap();
        {
            let file = RotatingFile::open(dir.path(), "guided-review", 30, 5).unwrap();
            file.write_record(b"0123456789012345678\n");
        }
        let file = RotatingFile::open(dir.path(), "guided-review", 30, 5).unwrap();
        file.write_record(b"next record\n");
        assert_eq!(read(&file.path(0)), "next record\n");
        assert_eq!(read(&file.path(1)), "0123456789012345678\n");
    }

    #[test]
    fn a_record_larger_than_the_limit_is_still_written() {
        let dir = tempfile::tempdir().unwrap();
        let file = RotatingFile::open(dir.path(), "guided-review", 10, 5).unwrap();
        file.write_record(b"short\n");
        file.write_record(b"a record longer than ten bytes\n");
        assert_eq!(read(&file.path(0)), "a record longer than ten bytes\n");
        assert_eq!(read(&file.path(1)), "short\n");
    }
}
