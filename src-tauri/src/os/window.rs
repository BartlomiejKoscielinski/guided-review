//! Main window placement on start (F-30.4), independent of Tauri so it can be unit-tested.
//!
//! The window-state plugin restores the last size and position; it keeps a position whenever
//! any corner of the window touches a monitor and never shrinks the size. `fit_window` then makes
//! sure the window fits the monitor's work area (first start: 1600×1000 fitted to it) and that
//! the title bar can be grabbed; otherwise the window is pulled back onto the primary monitor.
//! All values are physical pixels; logical sizes are scaled per monitor.

/// A rectangle in physical pixels (virtual-screen coordinates).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }
}

/// A monitor's work area (without the taskbar) and its scale factor (1.0 = 96 dpi).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorArea {
    pub work: Rect,
    pub scale: f64,
}

/// Minimum window size in logical pixels (docs/03 › Spacing and layout).
pub const MIN_SIZE: (f64, f64) = (1280.0, 800.0);
/// Title bar height in logical pixels (F-30.1).
pub const TITLE_BAR_HEIGHT: f64 = 44.0;
/// How much of the title bar, in logical pixels, must be on a work area to keep the position.
pub const MIN_VISIBLE_TITLE_BAR: f64 = 120.0;

/// Where the window goes and the minimum size to set (both physical pixels).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub rect: Rect,
    /// `MIN_SIZE` scaled, lowered to the work area on screens smaller than that.
    pub min_size: (u32, u32),
    /// Scale factor of the monitor the window is placed on.
    pub scale: f64,
}

impl Placement {
    /// The minimum size in logical pixels, which stays right when the window moves to a
    /// monitor with another scale factor.
    pub fn min_size_logical(&self) -> (f64, f64) {
        (
            f64::from(self.min_size.0) / self.scale,
            f64::from(self.min_size.1) / self.scale,
        )
    }
}

/// Logical to physical pixels; `as` saturates, which is fine for window sizes.
fn scaled(logical: f64, scale: f64) -> u32 {
    (logical * scale).round().max(0.0) as u32
}

/// Width of the window's title bar strip that lies on `area`, or 0 when its full height doesn't.
fn visible_title_bar(window: Rect, area: MonitorArea) -> i64 {
    let bar = i64::from(scaled(TITLE_BAR_HEIGHT, area.scale));
    let work = area.work;
    let top = i64::from(window.y);
    if top < i64::from(work.y) || top + bar > work.bottom() {
        return 0;
    }
    let left = i64::from(window.x).max(i64::from(work.x));
    let right = window.right().min(work.right());
    (right - left).max(0)
}

fn centered(width: u32, height: u32, work: Rect) -> Rect {
    let x = i64::from(work.x) + (i64::from(work.width) - i64::from(width)) / 2;
    let y = i64::from(work.y) + (i64::from(work.height) - i64::from(height)) / 2;
    Rect::new(clamp_i32(x), clamp_i32(y), width, height)
}

fn clamp_i32(value: i64) -> i32 {
    i32::try_from(value).unwrap_or(if value < 0 { i32::MIN } else { i32::MAX })
}

/// Places the window (its current outer rect after the plugin's restore) on a monitor.
/// Returns `None` when no monitor is known; the window is then left where it is.
pub fn fit_window(window: Rect, monitors: &[MonitorArea], primary: usize) -> Option<Placement> {
    let primary_area = monitors.get(primary).or_else(|| monitors.first())?;
    let holder = monitors
        .iter()
        .map(|m| (visible_title_bar(window, *m), m))
        .filter(|(visible, m)| *visible >= i64::from(scaled(MIN_VISIBLE_TITLE_BAR, m.scale)))
        .max_by_key(|(visible, _)| *visible)
        .map(|(_, m)| *m);
    let area = holder.unwrap_or(*primary_area);
    let work = area.work;

    let min_size = (
        scaled(MIN_SIZE.0, area.scale).min(work.width),
        scaled(MIN_SIZE.1, area.scale).min(work.height),
    );
    let width = window.width.clamp(min_size.0, work.width.max(min_size.0));
    let height = window.height.clamp(min_size.1, work.height.max(min_size.1));

    let rect = if holder.is_none() || width != window.width || height != window.height {
        // Pulled back, or too big for its monitor: fit it and center it in the work area.
        centered(width, height, work)
    } else {
        window
    };
    Some(Placement {
        rect,
        min_size,
        scale: area.scale,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1920×1080 at 100% with a 48px taskbar at the bottom.
    const FHD: MonitorArea = MonitorArea {
        work: Rect::new(0, 0, 1920, 1032),
        scale: 1.0,
    };
    /// A second 2560×1440 monitor at 150% to the right of FHD.
    const QHD_RIGHT: MonitorArea = MonitorArea {
        work: Rect::new(1920, 0, 2560, 1392),
        scale: 1.5,
    };

    #[test]
    fn f30_4_first_start_fits_default_size_into_work_area() {
        // Config: 1600×1000, centered on the primary monitor by Tauri.
        let start = Rect::new(160, 16, 1600, 1000);
        let p = fit_window(start, &[FHD], 0).unwrap();
        assert_eq!(p.rect, start);
        assert_eq!(p.min_size, (1280, 800));

        // 1366×768 laptop: the work area is smaller than 1600×1000 and even than 1280×800.
        let small = MonitorArea {
            work: Rect::new(0, 0, 1366, 728),
            scale: 1.0,
        };
        let p = fit_window(Rect::new(-117, -136, 1600, 1000), &[small], 0).unwrap();
        assert_eq!(p.rect, Rect::new(0, 0, 1366, 728));
        assert_eq!(p.min_size, (1280, 728));
    }

    #[test]
    fn f30_4_minimum_size_follows_the_scale_and_drops_to_small_work_areas() {
        // 1920×1080 at 150%: the work area is 1280×688 logical, below the 1280×800 minimum.
        let laptop = MonitorArea {
            work: Rect::new(0, 0, 1920, 1032),
            scale: 1.5,
        };
        let p = fit_window(Rect::new(-480, -234, 2400, 1500), &[laptop], 0).unwrap();
        assert_eq!(p.min_size, (1920, 1032));
        assert_eq!(p.rect, Rect::new(0, 0, 1920, 1032));
        let p = fit_window(Rect::new(0, 0, 1920, 1032), &[QHD_RIGHT], 0).unwrap();
        assert_eq!(p.min_size, (1920, 1200));
        assert_eq!(p.min_size_logical(), (1280.0, 800.0));
    }

    #[test]
    fn f30_4_larger_than_work_area_is_shrunk_and_centered() {
        let p = fit_window(Rect::new(100, 50, 2400, 1300), &[FHD], 0).unwrap();
        assert_eq!(p.rect, Rect::new(0, 0, 1920, 1032));
        let p = fit_window(Rect::new(100, 50, 1700, 1100), &[FHD], 0).unwrap();
        assert_eq!(p.rect, Rect::new(110, 0, 1700, 1032));
    }

    #[test]
    fn f30_4_off_screen_window_is_pulled_back_to_primary() {
        // Saved on a monitor that is no longer connected.
        let p = fit_window(Rect::new(5000, 300, 1600, 1000), &[FHD], 0).unwrap();
        assert_eq!(p.rect, Rect::new(160, 16, 1600, 1000));
    }

    #[test]
    fn f30_4_title_bar_above_monitor_is_pulled_back() {
        // A corner is on the monitor (the plugin keeps it) but the title bar is above the top.
        let p = fit_window(Rect::new(200, -300, 1600, 1000), &[FHD], 0).unwrap();
        assert_eq!(p.rect, Rect::new(160, 16, 1600, 1000));
        // Title bar under the taskbar.
        let p = fit_window(Rect::new(200, 1000, 1600, 1000), &[FHD], 0).unwrap();
        assert_eq!(p.rect, Rect::new(160, 16, 1600, 1000));
        // Only 50px of the title bar left on screen.
        let p = fit_window(Rect::new(1870, 100, 1600, 1000), &[FHD], 0).unwrap();
        assert_eq!(p.rect, Rect::new(160, 16, 1600, 1000));
    }

    #[test]
    fn f30_4_partly_visible_window_keeps_position() {
        // Dragged half off the left edge; the title bar can still be grabbed.
        let w = Rect::new(-800, 20, 1600, 1000);
        assert_eq!(fit_window(w, &[FHD], 0).unwrap().rect, w);
    }

    #[test]
    fn f30_4_second_monitor_position_is_kept() {
        let w = Rect::new(2200, 100, 2400, 1300);
        let p = fit_window(w, &[FHD, QHD_RIGHT], 0).unwrap();
        assert_eq!(p.rect, w);
        assert_eq!(p.min_size, (1920, 1200));
        // Spanning both monitors: it belongs to the one with more of its title bar.
        let w = Rect::new(1500, 100, 2000, 1250);
        assert_eq!(fit_window(w, &[FHD, QHD_RIGHT], 0).unwrap().rect, w);
    }

    #[test]
    fn f30_4_scale_factor_is_respected() {
        // 200%: the title bar is 88px; a window whose top 88px don't fit is pulled back.
        let hi = MonitorArea {
            work: Rect::new(0, 0, 3840, 2088),
            scale: 2.0,
        };
        let w = Rect::new(400, 2040, 3200, 2000);
        let p = fit_window(w, &[hi], 0).unwrap();
        assert_eq!(p.rect, Rect::new(320, 44, 3200, 2000));
        assert_eq!(p.min_size, (2560, 1600));
    }

    #[test]
    fn no_monitors_leaves_the_window_alone() {
        assert_eq!(fit_window(Rect::new(0, 0, 1600, 1000), &[], 0), None);
    }
}
