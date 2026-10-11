//! A Windows Job Object per child process tree (docs/04 › Processes on Windows).
//!
//! The child is created suspended, put into a fresh job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
//! and only then resumed, so nothing it starts can run outside the job. Terminating the job
//! kills the tree; dropping the last handle (also when the app exits or crashes) does too.
//!
//! This is the only module with `unsafe` code: thin Win32 calls through the `windows` crate,
//! each with its invariants stated.
#![allow(
    unsafe_code,
    reason = "Win32 FFI for Job Objects (approved for os/job.rs only)"
)]

use std::ffi::c_void;
use std::io;
use std::os::windows::io::RawHandle;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject,
};
use windows::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};
use windows::core::PCWSTR;

pub const CREATE_NO_WINDOW: u32 = windows::Win32::System::Threading::CREATE_NO_WINDOW.0;
pub const CREATE_SUSPENDED: u32 = windows::Win32::System::Threading::CREATE_SUSPENDED.0;

/// An owned job handle, kept as an integer because `HANDLE` (a raw pointer) is not `Send`.
#[derive(Debug)]
pub struct Job {
    handle: isize,
}

impl Job {
    /// A new anonymous job that kills its processes when its last handle closes.
    pub fn new() -> io::Result<Self> {
        // SAFETY: no security attributes and no name; the returned handle is owned by `Job`
        // from here on and closed in `Drop`.
        let handle = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.map_err(io::Error::other)?;
        let job = Self {
            handle: handle.0 as isize,
        };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
            .map_err(io::Error::other)?;
        // SAFETY: `limits` is a fully initialized JOBOBJECT_EXTENDED_LIMIT_INFORMATION that
        // outlives the call, and `size` is its size.
        unsafe {
            SetInformationJobObject(
                job.raw(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast::<c_void>(),
                size,
            )
        }
        .map_err(io::Error::other)?;
        Ok(job)
    }

    /// Puts a process created with `CREATE_SUSPENDED` into the job, then resumes its threads.
    pub fn adopt_suspended(&self, process: RawHandle, pid: u32) -> io::Result<()> {
        // SAFETY: `process` is an open process handle owned by the caller's `Child`, which
        // outlives this call.
        unsafe { AssignProcessToJobObject(self.raw(), HANDLE(process)) }
            .map_err(io::Error::other)?;
        resume_threads(pid)
    }

    /// Kills every process in the job (a no-op when they all exited).
    pub fn terminate(&self) {
        // SAFETY: the handle is owned by `self` and open until `Drop`.
        if let Err(error) = unsafe { TerminateJobObject(self.raw(), 1) } {
            tracing::warn!(%error, "terminating a job object failed");
        }
    }

    fn raw(&self) -> HANDLE {
        HANDLE(self.handle as *mut c_void)
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        // SAFETY: the handle is owned by `self` and closed exactly once, here. Kill-on-close
        // then ends whatever is still running in the job.
        let _ = unsafe { CloseHandle(self.raw()) };
    }
}

/// Resumes the threads of a suspended process (std's `Command` doesn't return the main
/// thread handle, so they are found through a thread snapshot).
fn resume_threads(pid: u32) -> io::Result<()> {
    // SAFETY: a snapshot of all threads in the system; the handle is closed below.
    let snapshot =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }.map_err(io::Error::other)?;
    let mut entry = THREADENTRY32 {
        dwSize: u32::try_from(size_of::<THREADENTRY32>()).map_err(io::Error::other)?,
        ..THREADENTRY32::default()
    };
    let mut resumed = 0_usize;
    // SAFETY: `entry` is a valid THREADENTRY32 with `dwSize` set, alive across the loop.
    let mut found = unsafe { Thread32First(snapshot, &raw mut entry) };
    while found.is_ok() {
        if entry.th32OwnerProcessID == pid {
            // SAFETY: opens a thread of our own child for resuming only; closed right after.
            if let Ok(thread) =
                unsafe { OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID) }
            {
                // SAFETY: `thread` is the open handle from above.
                if unsafe { ResumeThread(thread) } != u32::MAX {
                    resumed += 1;
                }
                // SAFETY: closes the handle opened above, once.
                let _ = unsafe { CloseHandle(thread) };
            }
        }
        // SAFETY: same snapshot and entry as above.
        found = unsafe { Thread32Next(snapshot, &raw mut entry) };
    }
    // SAFETY: closes the snapshot handle created above, once.
    let _ = unsafe { CloseHandle(snapshot) };
    if resumed == 0 {
        return Err(io::Error::other(
            "no thread of the child process could be resumed",
        ));
    }
    Ok(())
}
