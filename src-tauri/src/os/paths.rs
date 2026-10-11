//! The app data folder (ADR-020): `%APPDATA%\GuidedReview\`, resolved by the core instead of
//! Tauri's `app_data_dir` (which would use the identifier). Window-state keeps its own file in
//! `%APPDATA%\com.inpost.guidedreview\`.

use std::path::{Path, PathBuf};

/// Folder name under the roaming application data folder.
pub const APP_DIR_NAME: &str = "GuidedReview";
/// SQLite database file inside the app data folder (docs/04 › Files and folders).
pub const DB_FILE_NAME: &str = "guided-review.db";

#[derive(Debug, thiserror::Error)]
pub enum PathsError {
    #[error("the user's application data folder could not be found")]
    NoAppData,
}

/// `%APPDATA%\GuidedReview` on Windows (Known Folder API, not the environment variable).
pub fn app_data_dir() -> Result<PathBuf, PathsError> {
    dirs::config_dir()
        .map(|dir| dir.join(APP_DIR_NAME))
        .ok_or(PathsError::NoAppData)
}

/// The database file inside an app data folder.
pub fn db_path(app_data: &Path) -> PathBuf {
    app_data.join(DB_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_dir_is_guided_review_under_roaming_app_data() {
        let dir = app_data_dir().unwrap();
        assert_eq!(dir.file_name().unwrap(), APP_DIR_NAME);
        if cfg!(windows) {
            let appdata = PathBuf::from(std::env::var_os("APPDATA").unwrap());
            assert_eq!(dir, appdata.join(APP_DIR_NAME));
        }
    }

    #[test]
    fn db_file_is_inside_the_app_data_folder() {
        let base = Path::new("C:\\Users\\Zażółć gęślą\\AppData\\Roaming\\GuidedReview");
        assert_eq!(db_path(base), base.join("guided-review.db"));
    }
}
