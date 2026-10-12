//! Builds the demo repositories from docs/09 › Fixture repositories and prints their paths:
//! the S-06 mock's mobile-app with a 100-file local change (M1 demo), plus a bare `origin`.
//! The folders stay in `%TEMP%` until you delete them. Synthetic content only (ADR-019).
//!
//! `cargo run --manifest-path src-tauri/Cargo.toml --bin make-fixtures`

#[path = "../support/fixture_repo.rs"]
mod fixture_repo;

fn main() {
    let repo = fixture_repo::FixtureRepo::new("demo").keep();
    fixture_repo::mobile_app_with_local_change(&repo);
    let origin = repo.add_bare_origin();
    println!("repository: {}", repo.path.display());
    println!("origin:     {}", origin.display());
}
