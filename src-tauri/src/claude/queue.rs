//! The Claude queue (docs/04 › Background work, F-18.6, F-18.7): at most N `claude` processes
//! at once (Settings, 1–4), higher priorities first, and on a usage limit background tasks
//! wait until the user retries; interactive tasks (ask, fix, commit message) still run, so the
//! user can retry by hand.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use super::error::ClaudeError;
use crate::os::process::Cancel;

/// Lower runs first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    /// Ask, fix, commit message: the user waits for it.
    Interactive = 0,
    CurrentStep = 1,
    Plan = 2,
    Prefetch = 3,
    Other = 4,
}

impl Priority {
    pub const fn is_background(self) -> bool {
        !matches!(self, Self::Interactive)
    }
}

#[derive(Debug)]
struct State {
    max: usize,
    running: usize,
    paused: bool,
    next_seq: u64,
    waiting: BTreeSet<(Priority, u64)>,
}

#[derive(Debug, Clone)]
pub struct Queue {
    state: Arc<Mutex<State>>,
    notify: Arc<Notify>,
}

/// A running slot; dropping it frees the slot.
#[derive(Debug)]
pub struct Permit {
    queue: Queue,
}

impl Drop for Permit {
    fn drop(&mut self) {
        if let Ok(mut s) = self.queue.state.lock() {
            s.running = s.running.saturating_sub(1);
        }
        self.queue.notify.notify_waiters();
    }
}

impl Queue {
    pub fn new(max: u8) -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                max: usize::from(max.clamp(1, 4)),
                running: 0,
                paused: false,
                next_seq: 0,
                waiting: BTreeSet::new(),
            })),
            notify: Arc::new(Notify::new()),
        }
    }

    /// "Run at most N Claude tasks at once" changed (F-18.6).
    pub fn set_max(&self, max: u8) {
        if let Ok(mut s) = self.state.lock() {
            s.max = usize::from(max.clamp(1, 4));
        }
        self.notify.notify_waiters();
    }

    /// Background work stops after a usage limit (F-18.7) until `resume`.
    pub fn pause(&self) {
        if let Ok(mut s) = self.state.lock() {
            s.paused = true;
        }
    }

    pub fn resume(&self) {
        if let Ok(mut s) = self.state.lock() {
            s.paused = false;
        }
        self.notify.notify_waiters();
    }

    pub fn is_paused(&self) -> bool {
        self.state.lock().map(|s| s.paused).unwrap_or(false)
    }

    /// Waits for a slot. Cancelling while waiting returns `Cancelled`.
    pub async fn acquire(
        &self,
        priority: Priority,
        cancel: &Cancel,
    ) -> Result<Permit, ClaudeError> {
        let key = {
            let mut s = self
                .state
                .lock()
                .map_err(|_| ClaudeError::failed("queue poisoned"))?;
            let key = (priority, s.next_seq);
            s.next_seq += 1;
            s.waiting.insert(key);
            key
        };
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut s = self
                    .state
                    .lock()
                    .map_err(|_| ClaudeError::failed("queue poisoned"))?;
                let eligible = |k: &(Priority, u64)| !(s.paused && k.0.is_background());
                let first = s.waiting.iter().find(|k| eligible(k)).copied();
                if s.running < s.max && first == Some(key) {
                    s.waiting.remove(&key);
                    s.running += 1;
                    return Ok(Permit {
                        queue: self.clone(),
                    });
                }
            }
            tokio::select! {
                () = &mut notified => {}
                () = cancel.cancelled() => {
                    if let Ok(mut s) = self.state.lock() {
                        s.waiting.remove(&key);
                    }
                    self.notify.notify_waiters();
                    return Err(ClaudeError::Cancelled);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn f18_8_counts_running_and_waiting_and_return_to_zero() {
        let queue = Queue::new(1);
        assert_eq!(queue.activity(), (0, 0));
        let first = queue
            .acquire(Priority::Other, &Cancel::new())
            .await
            .unwrap();
        assert_eq!(queue.activity(), (1, 0));
        let waiter = {
            let queue = queue.clone();
            tokio::spawn(async move { queue.acquire(Priority::Other, &Cancel::new()).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(queue.activity(), (1, 1));
        drop(first);
        let second = waiter.await.unwrap().unwrap();
        assert_eq!(queue.activity(), (1, 0));
        drop(second);
        assert_eq!(queue.activity(), (0, 0));
    }

    #[tokio::test]
    async fn f18_8_a_cancelled_waiting_task_is_no_longer_counted() {
        let queue = Queue::new(1);
        let _busy = queue
            .acquire(Priority::Other, &Cancel::new())
            .await
            .unwrap();
        let cancel = Cancel::new();
        let waiter = {
            let (queue, cancel) = (queue.clone(), cancel.clone());
            tokio::spawn(async move { queue.acquire(Priority::Other, &cancel).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(queue.activity(), (1, 1));
        cancel.cancel();
        assert!(waiter.await.unwrap().is_err());
        assert_eq!(queue.activity(), (1, 0));
    }

    #[tokio::test]
    async fn f18_6_queue_runs_at_most_n_tasks() {
        let queue = Queue::new(2);
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..6 {
            let (queue, running, peak) = (queue.clone(), running.clone(), peak.clone());
            handles.push(tokio::spawn(async move {
                let _permit = queue
                    .acquire(Priority::Other, &Cancel::new())
                    .await
                    .unwrap();
                let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
                running.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn interactive_tasks_go_first() {
        let queue = Queue::new(1);
        let busy = queue
            .acquire(Priority::Other, &Cancel::new())
            .await
            .unwrap();
        let order = Arc::new(Mutex::new(Vec::new()));
        let spawn = |p: Priority, name: &'static str| {
            let (queue, order) = (queue.clone(), order.clone());
            tokio::spawn(async move {
                let _permit = queue.acquire(p, &Cancel::new()).await.unwrap();
                order.lock().unwrap().push(name);
            })
        };
        let a = spawn(Priority::Prefetch, "prefetch");
        tokio::time::sleep(Duration::from_millis(10)).await;
        let b = spawn(Priority::Interactive, "commit message");
        tokio::time::sleep(Duration::from_millis(10)).await;
        drop(busy);
        a.await.unwrap();
        b.await.unwrap();
        assert_eq!(*order.lock().unwrap(), ["commit message", "prefetch"]);
    }

    #[tokio::test]
    async fn f09_6_current_step_before_plan_before_prefetch() {
        let queue = Queue::new(1);
        let busy = queue
            .acquire(Priority::Other, &Cancel::new())
            .await
            .unwrap();
        let order = Arc::new(Mutex::new(Vec::new()));
        let mut handles = Vec::new();
        // Queued in the opposite order of their priority.
        for (p, name) in [
            (Priority::Other, "other step"),
            (Priority::Prefetch, "prefetch"),
            (Priority::Plan, "plan"),
            (Priority::CurrentStep, "current step"),
        ] {
            let (queue, order) = (queue.clone(), order.clone());
            handles.push(tokio::spawn(async move {
                let _permit = queue.acquire(p, &Cancel::new()).await.unwrap();
                order.lock().unwrap().push(name);
            }));
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        drop(busy);
        for h in handles {
            h.await.unwrap();
        }
        assert_eq!(
            *order.lock().unwrap(),
            ["current step", "plan", "prefetch", "other step"]
        );
    }

    #[tokio::test]
    async fn f18_7_limit_pauses_background_tasks_until_retry() {
        let queue = Queue::new(2);
        queue.pause();
        let background = {
            let queue = queue.clone();
            tokio::spawn(async move { queue.acquire(Priority::Plan, &Cancel::new()).await })
        };
        // Interactive work still runs (the user retries by hand).
        let permit = queue
            .acquire(Priority::Interactive, &Cancel::new())
            .await
            .unwrap();
        drop(permit);
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!background.is_finished());
        queue.resume();
        assert!(background.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn cancelling_a_waiting_task_frees_its_place() {
        let queue = Queue::new(1);
        let _busy = queue
            .acquire(Priority::Other, &Cancel::new())
            .await
            .unwrap();
        let cancel = Cancel::new();
        let waiting = {
            let (queue, cancel) = (queue.clone(), cancel.clone());
            tokio::spawn(async move { queue.acquire(Priority::Other, &cancel).await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        cancel.cancel();
        assert_eq!(waiting.await.unwrap().unwrap_err(), ClaudeError::Cancelled);
    }
}
