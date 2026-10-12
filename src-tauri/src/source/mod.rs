//! Sources of a review (docs/04 › Core data model): what the S-01 input names (F-01.1, F-01.5),
//! the repository a folder belongs to (F-19.6) and the sessions opened for commits and local
//! changes (F-01.3, M2 decision 3). Independent of Tauri.

pub mod detect;
pub mod error;
pub mod folder;
pub mod model;
pub mod open;

pub use error::SourceError;
pub use model::{CommitRange, LocalScope, Source};
