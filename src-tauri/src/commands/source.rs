//! `source_detect`: what the S-01 input names (F-01.1, F-01.2) or the inline error (F-01.5).

use std::path::Path;

use tauri::State;

use super::with_store;
use crate::error::AppResult;
use crate::os::process::Cancel;
use crate::source::detect::{self, DetectEnv, DetectedSource};
use crate::store::{self, Store};

/// `None` for blank input. Reads only; nothing is switched or added until the source opens.
#[tauri::command]
pub async fn source_detect(
    store: State<'_, Store>,
    input: String,
) -> AppResult<Option<DetectedSource>> {
    let (repos, active, settings) = with_store(&store, |conn| {
        Ok((
            store::repos::list(conn)?,
            store::repos::active(conn)?,
            store::settings::load(conn)?,
        ))
    })
    .await?;
    let active = active.filter(|r| Path::new(&r.path).is_dir());
    let env = DetectEnv {
        server: settings.gitlab.server.as_deref(),
        repos: &repos,
        active: active.as_ref(),
        git_program: settings.git.path.as_deref().map(Path::new),
    };
    Ok(detect::detect(&input, &env, &Cancel::new()).await?)
}
