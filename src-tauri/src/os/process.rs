//! Child processes (docs/04 › Processes on Windows). Every program the app runs goes through
//! here: argument arrays only (never a shell), `CREATE_NO_WINDOW`, each run in its own Job
//! Object with kill-on-close (`job.rs`), so cancelling, a timeout or quitting kills the whole
//! tree; stdin for large inputs (prompts), UTF-8 output.
//!
//! Logs name the program, the number of arguments, the exit code and the duration. Stdin,
//! stdout and stderr are never logged (NFR-08): they carry prompts, Claude output and diffs.
#![expect(
    clippy::disallowed_methods,
    reason = "the one place that starts child processes: CREATE_NO_WINDOW, Job Object, timeouts"
)]

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

use crate::error::{AppError, ErrorCode};

pub use super::cancel::Cancel;

/// What to run. Built with the chainable methods; nothing goes through a shell.
#[derive(Debug, Clone, Default)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: Option<PathBuf>,
    pub env_remove: Vec<OsString>,
    pub env_set: Vec<(OsString, OsString)>,
    pub stdin: Option<Vec<u8>>,
    pub timeout: Option<Duration>,
}

impl ProcessSpec {
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            ..Self::default()
        }
    }

    pub fn arg(mut self, arg: impl Into<OsString>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    pub fn cwd(mut self, dir: impl Into<PathBuf>) -> Self {
        self.cwd = Some(dir.into());
        self
    }

    pub fn env_remove(mut self, name: impl Into<OsString>) -> Self {
        self.env_remove.push(name.into());
        self
    }

    pub fn env(mut self, name: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.env_set.push((name.into(), value.into()));
        self
    }

    /// Bytes written to the child's stdin, which is then closed. Without it stdin is empty.
    pub fn stdin(mut self, bytes: impl Into<Vec<u8>>) -> Self {
        self.stdin = Some(bytes.into());
        self
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// File name of the program, for logs and messages.
    pub fn program_name(&self) -> String {
        self.program
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.program.to_string_lossy().into_owned())
    }
}

/// A finished run. Output is decoded as UTF-8; invalid bytes become U+FFFD and set `lossy`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    /// Exit code; `None` when the process ended without one.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub lossy: bool,
    pub duration: Duration,
}

impl ProcessOutput {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("{program} was not found")]
    NotFound { program: String },
    #[error("{program} could not be started: {source}")]
    Spawn {
        program: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{program} could not be put into a job object: {source}")]
    Job {
        program: String,
        #[source]
        source: std::io::Error,
    },
    #[error("reading from or writing to {program} failed: {source}")]
    Io {
        program: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{program} did not finish within {} s", timeout.as_secs())]
    TimedOut { program: String, timeout: Duration },
    #[error("{program} was cancelled")]
    Cancelled { program: String },
}

/// Callers map process errors to their own codes (git → `GIT_*`, claude → `CLAUDE_*`); this is
/// the fallback.
impl From<ProcessError> for AppError {
    fn from(error: ProcessError) -> Self {
        match error {
            ProcessError::Cancelled { .. } => AppError::new(ErrorCode::Cancelled, "Cancelled."),
            other => AppError::internal("A helper program failed.").with_detail(other.to_string()),
        }
    }
}

/// `CREATE_NO_WINDOW` (Windows process creation flag).
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Creation flags of every child: no console window; on Windows also suspended until it is in
/// its job, so grandchildren can't be started outside it.
pub fn creation_flags() -> u32 {
    #[cfg(windows)]
    {
        super::job::CREATE_NO_WINDOW | super::job::CREATE_SUSPENDED
    }
    #[cfg(not(windows))]
    {
        CREATE_NO_WINDOW
    }
}

/// The process tree of one run: a Job Object on Windows. Elsewhere only the child itself is
/// killed (`kill_on_drop`) until process groups are added (NFR-07).
struct ProcessTree {
    #[cfg(windows)]
    job: super::job::Job,
}

impl ProcessTree {
    fn new() -> std::io::Result<Self> {
        Ok(Self {
            #[cfg(windows)]
            job: super::job::Job::new()?,
        })
    }

    fn adopt(&self, child: &Child) -> std::io::Result<()> {
        #[cfg(windows)]
        {
            let handle = child
                .raw_handle()
                .ok_or_else(|| std::io::Error::other("the child has no process handle"))?;
            let pid = child
                .id()
                .ok_or_else(|| std::io::Error::other("the child has no process id"))?;
            self.job.adopt_suspended(handle, pid)
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(())
        }
    }

    fn terminate(&self) {
        #[cfg(windows)]
        self.job.terminate();
    }
}

/// Runs the program to completion and returns its output. Cancelling, the timeout or dropping
/// the returned future kill the whole process tree; when the program exits, anything it left
/// running is killed too.
pub async fn run(spec: &ProcessSpec, cancel: &Cancel) -> Result<ProcessOutput, ProcessError> {
    run_inner(spec, cancel, None).await
}

/// Called with each stdout line (without its line end) as it arrives.
pub type OnLine<'a> = &'a mut (dyn FnMut(&str) + Send);

/// [`run`], also handing each stdout line to `on_line` as it arrives (streaming Claude tasks).
/// The returned output still holds all of stdout.
pub async fn run_streaming(
    spec: &ProcessSpec,
    cancel: &Cancel,
    on_line: OnLine<'_>,
) -> Result<ProcessOutput, ProcessError> {
    run_inner(spec, cancel, Some(on_line)).await
}

async fn run_inner(
    spec: &ProcessSpec,
    cancel: &Cancel,
    on_line: Option<OnLine<'_>>,
) -> Result<ProcessOutput, ProcessError> {
    let program = spec.program_name();
    if cancel.is_cancelled() {
        return Err(ProcessError::Cancelled { program });
    }
    let started = Instant::now();
    let tree = ProcessTree::new().map_err(|source| ProcessError::Job {
        program: program.clone(),
        source,
    })?;
    let mut child = command(spec)
        .spawn()
        .map_err(|source| match source.kind() {
            std::io::ErrorKind::NotFound => ProcessError::NotFound {
                program: program.clone(),
            },
            _ => ProcessError::Spawn {
                program: program.clone(),
                source,
            },
        })?;
    if let Err(source) = tree.adopt(&child) {
        let _ = child.start_kill();
        return Err(ProcessError::Job { program, source });
    }
    tracing::debug!(program, args = spec.args.len(), "process started");

    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let work = async {
        let exited = async {
            let status = child.wait().await;
            tree.terminate();
            status
        };
        tokio::join!(
            write_stdin(stdin, spec.stdin.as_deref()),
            read_stdout(stdout, on_line),
            read_all(stderr),
            exited
        )
    };
    let deadline = async {
        match spec.timeout {
            Some(timeout) => tokio::time::sleep(timeout).await,
            None => std::future::pending().await,
        }
    };
    let io_error = |source| ProcessError::Io {
        program: program.clone(),
        source,
    };
    tokio::select! {
        (written, stdout, stderr, status) = work => {
            written.map_err(io_error)?;
            let status = status.map_err(io_error)?;
            let (stdout, stdout_lossy) = decode(stdout.map_err(io_error)?);
            let (stderr, stderr_lossy) = decode(stderr.map_err(io_error)?);
            let output = ProcessOutput {
                code: status.code(),
                stdout,
                stderr,
                lossy: stdout_lossy || stderr_lossy,
                duration: started.elapsed(),
            };
            tracing::debug!(
                program,
                code = ?output.code,
                ms = output.duration.as_millis(),
                "process finished"
            );
            Ok(output)
        }
        () = cancel.cancelled() => {
            tree.terminate();
            tracing::info!(program, ms = started.elapsed().as_millis(), "process cancelled");
            Err(ProcessError::Cancelled { program })
        }
        () = deadline => {
            tree.terminate();
            let timeout = spec.timeout.unwrap_or_default();
            tracing::info!(program, s = timeout.as_secs(), "process timed out");
            Err(ProcessError::TimedOut { program, timeout })
        }
    }
}

fn command(spec: &ProcessSpec) -> Command {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .stdin(if spec.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    for name in &spec.env_remove {
        command.env_remove(name);
    }
    for (name, value) in &spec.env_set {
        command.env(name, value);
    }
    #[cfg(windows)]
    command.creation_flags(creation_flags());
    command
}

/// Writes the input and closes stdin. A child that exits without reading all of it is not an
/// error here: its exit code tells the caller what happened.
async fn write_stdin(pipe: Option<ChildStdin>, input: Option<&[u8]>) -> std::io::Result<()> {
    let (Some(mut pipe), Some(input)) = (pipe, input) else {
        return Ok(());
    };
    match pipe.write_all(input).await {
        Err(error) if error.kind() != std::io::ErrorKind::BrokenPipe => Err(error),
        _ => Ok(()),
    }
}

async fn read_all(pipe: Option<impl AsyncRead + Unpin>) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    if let Some(mut pipe) = pipe {
        pipe.read_to_end(&mut bytes).await?;
    }
    Ok(bytes)
}

/// All of stdout; with `on_line`, read line by line and handed over as each line completes.
async fn read_stdout(
    pipe: Option<impl AsyncRead + Unpin>,
    on_line: Option<OnLine<'_>>,
) -> std::io::Result<Vec<u8>> {
    let (pipe, on_line) = match (pipe, on_line) {
        (Some(pipe), Some(on_line)) => (pipe, on_line),
        (pipe, _) => return read_all(pipe).await,
    };
    let mut reader = BufReader::new(pipe);
    let mut bytes = Vec::new();
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line).await? == 0 {
            return Ok(bytes);
        }
        on_line(String::from_utf8_lossy(&line).trim_end_matches(['\r', '\n']));
        bytes.extend_from_slice(&line);
    }
}

/// UTF-8 text and whether invalid bytes had to be replaced.
fn decode(bytes: Vec<u8>) -> (String, bool) {
    match String::from_utf8(bytes) {
        Ok(text) => (text, false),
        Err(error) => (String::from_utf8_lossy(error.as_bytes()).into_owned(), true),
    }
}

/// Starts a program the user keeps (Rider, a browser) without waiting for it, outside any job
/// of ours and without pipes, so it outlives the call and the app. Returns its process id.
pub fn spawn_detached(
    program: &Path,
    args: &[OsString],
    cwd: Option<&Path>,
) -> Result<u32, ProcessError> {
    let name = ProcessSpec::new(program).program_name();
    let mut command = std::process::Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command.spawn().map_err(|source| match source.kind() {
        std::io::ErrorKind::NotFound => ProcessError::NotFound {
            program: name.clone(),
        },
        _ => ProcessError::Spawn {
            program: name.clone(),
            source,
        },
    })?;
    tracing::info!(
        program = name,
        args = args.len(),
        "detached process started"
    );
    Ok(child.id())
}

/// `CREATE_NEW_CONSOLE` (Windows process creation flag).
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

/// Starts an interactive console program in its own console window, detached (Sign in to
/// Claude Code: `claude auth login`, docs/05 › Startup checks). Stdio is inherited: the
/// release app has no console handles, so the child uses its new console; a dev build started
/// from a terminal shares that terminal instead.
pub fn spawn_console(spec: &ProcessSpec) -> Result<u32, ProcessError> {
    let name = spec.program_name();
    let mut command = std::process::Command::new(&spec.program);
    command.args(&spec.args);
    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    for name in &spec.env_remove {
        command.env_remove(name);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NEW_CONSOLE);
    }
    #[cfg(not(windows))]
    let _ = CREATE_NEW_CONSOLE;
    let child = command.spawn().map_err(|source| match source.kind() {
        std::io::ErrorKind::NotFound => ProcessError::NotFound {
            program: name.clone(),
        },
        _ => ProcessError::Spawn {
            program: name.clone(),
            source,
        },
    })?;
    tracing::info!(
        program = name,
        args = spec.args.len(),
        "console process started"
    );
    Ok(child.id())
}
