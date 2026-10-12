//! Stable hunk IDs (F-05.3, F-05.7; docs/04 › Hunk ID): the first 16 hex characters of
//! SHA-256 over the content, never over line numbers, so the same change keeps its ID across
//! sessions and unrelated rebases. A collision inside one diff gets `-2`, `-3` in file order.
//! A collision needs the same paths, so computing the IDs of one file at a time gives the same
//! result as computing them over the whole diff.

use std::collections::HashMap;

use sha2::{Digest, Sha256};

use super::model::{LineKind, display_text};
use super::patch::{PatchFile, PatchHunk};

/// ID of a text hunk: `new_path \0 old_path \0 removed lines \0 added lines`.
pub fn hunk_id(new_path: &str, old_path: &str, hunk: &PatchHunk) -> String {
    let join = |kind: LineKind| {
        hunk.lines
            .iter()
            .filter(|l| l.kind == kind)
            .map(|l| display_text(&l.text))
            .collect::<Vec<_>>()
            .join("\n")
    };
    digest(&[
        new_path,
        old_path,
        &join(LineKind::Del),
        &join(LineKind::Add),
    ])
}

/// ID of the file-level hunk of a change without text hunks:
/// `file \0 old_path \0 new_path \0 status \0 old_blob \0 new_blob`.
pub fn file_level_id(file: &PatchFile) -> String {
    digest(&[
        file.path(),
        file.old_path.as_deref().unwrap_or_default(),
        file.new_path.as_deref().unwrap_or_default(),
        file.status.as_str(),
        file.old_blob.as_deref().unwrap_or_default(),
        file.new_blob.as_deref().unwrap_or_default(),
    ])
}

fn digest(fields: &[&str]) -> String {
    let mut sha = Sha256::new();
    for (index, field) in fields.iter().enumerate() {
        if index > 0 {
            sha.update([0u8]);
        }
        sha.update(field.as_bytes());
    }
    let hash = sha.finalize();
    hash.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// Whether a file has no text hunks and therefore gets one file-level hunk (rename-only,
/// mode-only, binary, empty file added or deleted).
pub fn needs_file_level_hunk(file: &PatchFile) -> bool {
    file.binary || file.hunks.is_empty()
}

/// IDs for every file of one diff, in file order: one per text hunk, or one file-level ID.
pub fn assign(files: &[PatchFile]) -> Vec<Vec<String>> {
    let mut seen: HashMap<String, u32> = HashMap::new();
    let mut unique = |id: String| {
        let count = seen.entry(id.clone()).or_insert(0);
        *count += 1;
        if *count == 1 {
            id
        } else {
            format!("{id}-{count}")
        }
    };
    files
        .iter()
        .map(|file| {
            if needs_file_level_hunk(file) {
                vec![unique(file_level_id(file))]
            } else {
                let new = file.new_path.as_deref().unwrap_or_default();
                let old = file.old_path.as_deref().unwrap_or_default();
                file.hunks
                    .iter()
                    .map(|h| unique(hunk_id(new, old, h)))
                    .collect()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::patch::parse;

    const DIFF: &str = "diff --git a/src/A.cs b/src/A.cs\n\
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644\n\
--- a/src/A.cs\n+++ b/src/A.cs\n@@ -10,3 +10,3 @@ class A\n a\n-b\n+c\n d\n";

    #[test]
    fn f05_3_same_content_same_id_across_runs() {
        let first = assign(&parse(DIFF).unwrap());
        let second = assign(&parse(DIFF).unwrap());
        assert_eq!(first, second);
        assert_eq!(first[0][0].len(), 16);
        assert!(first[0][0].chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn f05_3_id_ignores_line_numbers_and_context() {
        let moved = DIFF
            .replace("@@ -10,3 +10,3 @@ class A", "@@ -40,3 +52,3 @@ class B")
            .replace(" a\n", " x\n");
        assert_eq!(
            assign(&parse(DIFF).unwrap()),
            assign(&parse(&moved).unwrap())
        );
        let edited = DIFF.replace("+c", "+C");
        assert_ne!(
            assign(&parse(DIFF).unwrap()),
            assign(&parse(&edited).unwrap())
        );
    }

    #[test]
    fn f05_3_id_ignores_carriage_returns() {
        let crlf = DIFF.replace("-b\n+c\n", "-b\r\n+c\r\n");
        assert_eq!(
            assign(&parse(DIFF).unwrap()),
            assign(&parse(&crlf).unwrap())
        );
    }

    #[test]
    fn f05_3_collisions_get_a_suffix_in_file_order() {
        let twice = format!("{DIFF}@@ -30,3 +30,3 @@\n a\n-b\n+c\n d\n");
        let ids = assign(&parse(&twice).unwrap());
        assert_eq!(ids[0].len(), 2);
        assert_eq!(ids[0][1], format!("{}-2", ids[0][0]));
    }

    #[test]
    fn f05_7_textless_changes_get_one_file_hunk() {
        let diff = "diff --git a/old.cs b/new.cs\nsimilarity index 100%\nrename from old.cs\nrename to new.cs\n\
diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n\
diff --git a/logo.png b/logo.png\nindex 3333333333333333333333333333333333333333..4444444444444444444444444444444444444444 100644\nBinary files a/logo.png and b/logo.png differ\n\
diff --git a/empty.txt b/empty.txt\nnew file mode 100644\nindex 0000000000000000000000000000000000000000..e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\n";
        let files = parse(diff).unwrap();
        assert_eq!(files.len(), 4);
        let ids = assign(&files);
        for (file, ids) in files.iter().zip(&ids) {
            assert!(needs_file_level_hunk(file), "{}", file.path());
            assert_eq!(ids.len(), 1);
        }
        // Stable and distinct.
        assert_eq!(ids, assign(&parse(diff).unwrap()));
        let mut unique = ids.concat();
        unique.dedup();
        assert_eq!(unique.len(), 4);
    }
}
