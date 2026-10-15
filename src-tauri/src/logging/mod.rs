//! Local logging (NFR-08): `tracing` records go to `%APPDATA%\GuidedReview\logs\` through a
//! size-rotating file (`rotate.rs`), info level by default, and every formatted record is
//! redacted (`redact.rs`) before it is written. Debug builds also log to stderr (redacted too).
//!
//! What may be logged: events, identifiers, counts, durations, error codes. Never tokens,
//! prompts, Claude output, diffs or file contents; redaction is the safety net, not the rule.

pub mod redact;
pub mod rotate;

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::fmt::{self, MakeWriter};
use tracing_subscriber::layer::SubscriberExt;

use rotate::RotatingFile;

/// Folder for log files inside the app data folder.
pub const LOGS_DIR_NAME: &str = "logs";
/// Stem of the log file names (`guided-review.log`, `guided-review.1.log`, …).
pub const LOG_FILE_STEM: &str = "guided-review";
/// Environment variable that overrides the level, in `Targets` syntax (`debug`,
/// `guided_review_lib=debug,info`). Development aid; there is no setting for it.
pub const LOG_ENV: &str = "GUIDED_REVIEW_LOG";

#[derive(Debug, thiserror::Error)]
pub enum LoggingError {
    #[error("the log folder could not be opened: {0}")]
    Open(#[source] io::Error),
    #[error("a global logger is already installed")]
    AlreadyInstalled,
}

/// `<app data>\logs`.
pub fn log_dir(app_data: &Path) -> PathBuf {
    app_data.join(LOGS_DIR_NAME)
}

/// The level filter: info by default, or the value of [`LOG_ENV`] when it parses.
pub fn filter_from(value: Option<&str>) -> Targets {
    let default = Targets::new().with_default(LevelFilter::INFO);
    match value.map(str::trim) {
        Some(value) if !value.is_empty() => value.parse().unwrap_or(default),
        _ => default,
    }
}

/// Where formatted records go: a per-record buffer that is redacted and handed to the sink
/// when the formatter drops it (one record per `make_writer` call).
pub trait RecordSink: Send + Sync + 'static {
    fn write_record(&self, record: &[u8]);
}

impl RecordSink for RotatingFile {
    fn write_record(&self, record: &[u8]) {
        RotatingFile::write_record(self, record);
    }
}

/// Standard error of the process (debug builds only).
#[derive(Debug, Clone, Copy)]
pub struct Stderr;

impl RecordSink for Stderr {
    fn write_record(&self, record: &[u8]) {
        let _ = io::stderr().write_all(record);
    }
}

/// `MakeWriter` that redacts each record before it reaches the sink.
#[derive(Debug)]
pub struct Redacting<S> {
    sink: Arc<S>,
}

impl<S> Redacting<S> {
    pub fn new(sink: Arc<S>) -> Self {
        Self { sink }
    }
}

/// One record being formatted.
pub struct RecordWriter<S: RecordSink> {
    buf: Vec<u8>,
    sink: Arc<S>,
}

impl<S: RecordSink> Write for RecordWriter<S> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<S: RecordSink> Drop for RecordWriter<S> {
    fn drop(&mut self) {
        if self.buf.is_empty() {
            return;
        }
        let text = String::from_utf8_lossy(&self.buf);
        self.sink.write_record(redact::redact(&text).as_bytes());
    }
}

impl<'a, S: RecordSink> MakeWriter<'a> for Redacting<S> {
    type Writer = RecordWriter<S>;

    fn make_writer(&'a self) -> Self::Writer {
        RecordWriter {
            buf: Vec::new(),
            sink: Arc::clone(&self.sink),
        }
    }
}

/// The subscriber the app installs: filter, file output, and stderr in debug builds.
pub fn subscriber(
    file: Option<Arc<RotatingFile>>,
    filter: Targets,
    to_stderr: bool,
) -> impl tracing::Subscriber + Send + Sync {
    let file_layer = file.map(|file| fmt::layer().with_writer(Redacting::new(file)));
    let stderr_layer =
        to_stderr.then(|| fmt::layer().with_writer(Redacting::new(Arc::new(Stderr))));
    tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(stderr_layer)
}

/// Installs the global logger for the app with its files in `<app_data>\logs`. When the folder
/// can't be opened the app still runs (stderr only in debug builds) and the error is returned
/// so the caller can report it once the logger exists.
#[expect(
    clippy::disallowed_methods,
    reason = "app startup installs the global logger once"
)]
pub fn init(app_data: &Path) -> Result<(), LoggingError> {
    let opened = RotatingFile::open(
        &log_dir(app_data),
        LOG_FILE_STEM,
        rotate::MAX_FILE_BYTES,
        rotate::KEEP_FILES,
    );
    let (file, open_error) = match opened {
        Ok(file) => (Some(Arc::new(file)), None),
        Err(error) => (None, Some(error)),
    };
    let filter = filter_from(std::env::var(LOG_ENV).ok().as_deref());
    tracing::subscriber::set_global_default(subscriber(file, filter, cfg!(debug_assertions)))
        .map_err(|_| LoggingError::AlreadyInstalled)?;
    install_panic_hook();
    match open_error {
        Some(error) => Err(LoggingError::Open(error)),
        None => Ok(()),
    }
}

/// Panics are logged (redacted like everything else) before the default hook runs.
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!(panic = %info, "the app panicked");
        default_hook(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn file_logger(dir: &Path) -> Arc<RotatingFile> {
        Arc::new(
            RotatingFile::open(
                dir,
                LOG_FILE_STEM,
                rotate::MAX_FILE_BYTES,
                rotate::KEEP_FILES,
            )
            .unwrap(),
        )
    }

    #[test]
    fn nfr08_logs_live_in_app_data_logs() {
        let app_data = Path::new("C:\\Users\\Zażółć gęślą\\AppData\\Roaming\\GuidedReview");
        assert_eq!(log_dir(app_data), app_data.join("logs"));
    }

    #[test]
    fn nfr08_info_is_the_default_level() {
        let dir = tempfile::tempdir().unwrap();
        let file = file_logger(dir.path());
        let sub = subscriber(Some(Arc::clone(&file)), filter_from(None), false);
        tracing::subscriber::with_default(sub, || {
            tracing::debug!("debug record");
            tracing::info!("info record");
            tracing::warn!("warn record");
        });
        let text = fs::read_to_string(file.path(0)).unwrap();
        assert!(!text.contains("debug record"));
        assert!(text.contains("info record"));
        assert!(text.contains("warn record"));
    }

    #[test]
    fn level_can_be_raised_through_the_environment_value() {
        let dir = tempfile::tempdir().unwrap();
        let file = file_logger(dir.path());
        let sub = subscriber(Some(Arc::clone(&file)), filter_from(Some("debug")), false);
        tracing::subscriber::with_default(sub, || tracing::debug!("debug record"));
        assert!(
            fs::read_to_string(file.path(0))
                .unwrap()
                .contains("debug record")
        );
    }

    #[test]
    fn an_invalid_environment_value_falls_back_to_info() {
        assert_eq!(filter_from(Some("=?not a filter")), filter_from(None));
        assert_eq!(filter_from(Some("  ")), filter_from(None));
    }

    #[test]
    fn nfr08_records_are_redacted_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let file = file_logger(dir.path());
        let sub = subscriber(Some(Arc::clone(&file)), filter_from(None), false);
        tracing::subscriber::with_default(sub, || {
            let header = "PRIVATE-TOKEN: glpat-Ab3x9zQ1.w2E3r4T5y6U7";
            tracing::info!(header, "request with glrt-Ab3x9zQ1.w2E3r4T5y6U7");
            tracing::warn!(error = %"Authorization: Bearer abc.def", "request failed");
        });
        let text = fs::read_to_string(file.path(0)).unwrap();
        assert!(!text.contains("Ab3x9zQ1.w2E3r4T5y6U7"), "{text}");
        assert!(!text.contains("abc.def"), "{text}");
        assert!(text.contains("glrt-[REDACTED]"), "{text}");
        assert!(text.contains("PRIVATE-TOKEN: [REDACTED]"), "{text}");
        assert_eq!(text.lines().count(), 2, "{text}");
    }
}
