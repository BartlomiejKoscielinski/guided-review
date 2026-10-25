//! `job_trace` and `job_trace_stop` (F-20.5): the log of the job S-08 shows, streamed over a
//! channel. It re-reads the trace every 3 s while the job runs and sends only the new lines
//! (`review/job_log.rs`); it ends when the job finished, the channel drops, or the UI stops it by
//! its task ID (it picked another job or left the screen). HTTP only; read only.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::State;
use tauri::ipc::Channel;

use super::gitlab::{GitlabApp, connected_client, forget_status_on_auth_error};
use crate::error::AppResult;
use crate::os::cancel::Cancel;
use crate::review::job_log::{self, JobLogEvent};
use crate::store::Store;

/// The running log streams by the UI's task ID.
#[derive(Default)]
pub struct JobTraces(Mutex<HashMap<String, Cancel>>);

impl JobTraces {
    /// The cancel of `task`: a stop that arrived before the start leaves it cancelled already.
    fn start(&self, task: &str) -> Cancel {
        match self.0.lock() {
            Ok(mut tasks) => tasks.entry(task.to_owned()).or_default().clone(),
            Err(_) => Cancel::new(),
        }
    }

    fn stop(&self, task: &str) {
        if let Ok(mut tasks) = self.0.lock() {
            tasks.entry(task.to_owned()).or_default().cancel();
        }
    }

    fn remove(&self, task: &str) {
        if let Ok(mut tasks) = self.0.lock() {
            tasks.remove(task);
        }
    }
}

/// Streams the log of job `job` of the MR's pipeline on `ch` (`iid` names the MR; GitLab needs
/// only the job id). Resolves when the stream ends.
#[tauri::command]
#[allow(clippy::too_many_arguments, reason = "Tauri command arguments")]
pub async fn job_trace(
    gitlab: State<'_, GitlabApp>,
    store: State<'_, Store>,
    traces: State<'_, JobTraces>,
    project: String,
    iid: u64,
    job: u64,
    task: String,
    ch: Channel<JobLogEvent>,
) -> AppResult<()> {
    let _ = iid;
    let cancel = traces.start(&task);
    let result = async {
        let (client, _) = connected_client(&gitlab, &store).await?;
        let follow =
            job_log::follow(
                &client,
                &project,
                job,
                job_log::FOLLOW_INTERVAL,
                |event| match ch.send(event) {
                    Ok(()) => true,
                    Err(error) => {
                        tracing::debug!(%error, "job log event not delivered");
                        false
                    }
                },
            );
        let result = tokio::select! {
            result = follow => result,
            () = cancel.cancelled() => Ok(()),
        };
        forget_status_on_auth_error(&gitlab, result.as_ref().err()).await;
        AppResult::Ok(result?)
    }
    .await;
    traces.remove(&task);
    result
}

/// Stops the log stream `task` (another job picked, the screen left); nothing when it ended.
#[tauri::command]
pub fn job_trace_stop(traces: State<'_, JobTraces>, task: String) {
    traces.stop(&task);
}
