//! Argv snapshots of the Claude invocation profiles (docs/05 › Invocation profiles, ADR-022).

use super::*;

fn task() -> Task {
    Task {
        output: OutputFormat::Json,
        json_schema: Some(r#"{"type":"object"}"#.into()),
        model: Some("claude-sonnet-5-5".into()),
        effort: Some(Effort::Medium),
        system_prompt_file: PathBuf::from(
            r"C:\Users\Zażółć\AppData\Roaming\GuidedReview\tmp\t1\system-common.md",
        ),
        task_dir: PathBuf::from(r"C:\Users\Zażółć\AppData\Roaming\GuidedReview\tmp\t1"),
        persist_session: false,
        resume: None,
    }
}

fn strings(args: &[OsString]) -> Vec<String> {
    args.iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect()
}

const FORBIDDEN: [&str; 6] = [
    "--bare",
    "dangerously-skip-permissions",
    "bypassPermissions",
    "--setting-sources",
    "Bash",
    "WebFetch",
];

#[test]
fn nfr04_read_only_profile_argv_snapshot() {
    assert_eq!(
        strings(&read_only_args(&task())),
        [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            r#"{"type":"object"}"#,
            "--model",
            "claude-sonnet-5-5",
            "--effort",
            "medium",
            "--tools",
            "Read,Grep,Glob",
            "--permission-mode",
            "dontAsk",
            "--restricted",
            "--strict-mcp-config",
            "--disallowedTools",
            "mcp__*",
            "--append-system-prompt-file",
            r"C:\Users\Zażółć\AppData\Roaming\GuidedReview\tmp\t1\system-common.md",
            "--add-dir",
            r"C:\Users\Zażółć\AppData\Roaming\GuidedReview\tmp\t1",
            "--no-session-persistence",
        ]
    );
}

#[test]
fn nfr04_streaming_follow_up_keeps_the_session_and_resumes() {
    let t = Task {
        output: OutputFormat::StreamJson,
        json_schema: None,
        model: None,
        effort: None,
        persist_session: true,
        resume: Some("5b7c…".into()),
        ..task()
    };
    let args = strings(&read_only_args(&t));
    assert_eq!(
        args[..5],
        [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages"
        ]
    );
    assert!(!args.iter().any(|a| a == "--model" || a == "--effort"));
    assert!(!args.iter().any(|a| a == "--json-schema"));
    assert!(!args.iter().any(|a| a == "--no-session-persistence"));
    assert_eq!(args[args.len() - 2..], ["--resume", "5b7c…"]);
}

#[test]
fn nfr04_every_profile_is_restricted_and_never_unsafe() {
    let fix = fix_args(&task(), Path::new("src/A.cs")).unwrap();
    for args in [read_only_args(&task()), fix, probe_args(Some("haiku"))] {
        let args = strings(&args);
        for required in ["-p", "--restricted", "--strict-mcp-config"] {
            assert!(args.iter().any(|a| a == required), "{required} in {args:?}");
        }
        for forbidden in FORBIDDEN {
            assert!(
                !args.iter().any(|a| a.contains(forbidden)),
                "{forbidden} in {args:?}"
            );
        }
    }
}

#[test]
fn nfr04_fix_profile_allows_one_anchored_file() {
    let args = strings(&fix_args(&task(), Path::new(r"src\Zażółć gęślą\C.cs")).unwrap());
    let tools = args.iter().position(|a| a == "--tools").unwrap();
    assert_eq!(args[tools + 1], "Read,Grep,Glob,Edit");
    let allowed = args.iter().position(|a| a == "--allowedTools").unwrap();
    assert_eq!(args[allowed + 1], "Edit(/src/Zażółć gęślą/C.cs)");
    assert_eq!(
        args.iter().filter(|a| a.starts_with("Edit(")).count(),
        1,
        "{args:?}"
    );
    assert!(args.iter().any(|a| a == "dontAsk"));
}

#[test]
fn nfr04_edit_rule_escapes_gitignore_specials_and_polish_paths() {
    let cases = [
        ("src/A.cs", "Edit(/src/A.cs)"),
        (
            r"src\Views\Main Page.xaml",
            "Edit(/src/Views/Main Page.xaml)",
        ),
        ("src/[Gen]/A*?.cs", r"Edit(/src/\[Gen\]/A\*\?.cs)"),
        ("!important.md", r"Edit(/\!important.md)"),
        ("#notes.md", r"Edit(/\#notes.md)"),
        ("./src/A.cs", "Edit(/src/A.cs)"),
    ];
    for (path, rule) in cases {
        assert_eq!(edit_rule(Path::new(path)).unwrap(), rule, "{path}");
    }
}

#[test]
fn nfr04_edit_rule_rejects_paths_outside_the_worktree() {
    for path in [
        r"C:\repo\src\A.cs",
        "/src/A.cs",
        "../A.cs",
        "src/../../A.cs",
        "",
    ] {
        assert!(
            matches!(
                edit_rule(Path::new(path)),
                Err(RunnerError::InvalidFixPath(_))
            ),
            "{path}"
        );
    }
}

#[test]
fn probe_runs_without_tools_or_session() {
    assert_eq!(
        strings(&probe_args(Some("haiku"))),
        [
            "-p",
            "--output-format",
            "json",
            "--model",
            "haiku",
            "--tools",
            "",
            "--no-session-persistence",
            "--restricted",
            "--strict-mcp-config",
        ]
    );
    assert!(!strings(&probe_args(None)).iter().any(|a| a == "--model"));
}

#[test]
fn claude_env_cleanup_only_when_claudecode_set() {
    let outside = [("PATH", "C:\\x"), ("CLAUDE_CODE_ENTRYPOINT", "cli")];
    assert!(env_removals(outside).is_empty());
    let inside = [
        ("PATH", "C:\\x"),
        ("CLAUDECODE", "1"),
        ("CLAUDE_CODE_ENTRYPOINT", "cli"),
        ("claude_code_sse_port", "1234"),
        ("CLAUDE_AGENT_SDK_VERSION", "1"),
        ("CLAUDE_PID", "42"),
        ("CLAUDE_EFFORT", "high"),
        ("ANTHROPIC_BASE_URL", "http://localhost"),
        ("CLAUDE_CONFIG_DIR", "C:\\cfg"),
        ("HTTPS_PROXY", "http://proxy"),
    ];
    let mut removed = strings(&env_removals(inside));
    removed.sort();
    assert_eq!(
        removed,
        [
            "ANTHROPIC_BASE_URL",
            "CLAUDECODE",
            "CLAUDE_AGENT_SDK_VERSION",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_EFFORT",
            "CLAUDE_PID",
            "claude_code_sse_port",
        ]
    );
}

#[test]
fn nfr04_prompt_goes_through_stdin_and_node_runs_cli_js() {
    let native = ClaudeExecutable::Native(PathBuf::from(r"C:\Users\Zażółć\.local\bin\claude.exe"));
    let spec = process_spec(
        &native,
        read_only_args(&task()),
        Path::new(r"C:\repo"),
        Some("the prompt"),
        Duration::from_secs(600),
    );
    assert_eq!(
        spec.program,
        PathBuf::from(r"C:\Users\Zażółć\.local\bin\claude.exe")
    );
    assert_eq!(spec.stdin.as_deref(), Some("the prompt".as_bytes()));
    assert!(!strings(&spec.args).iter().any(|a| a.contains("the prompt")));
    assert_eq!(spec.cwd.as_deref(), Some(Path::new(r"C:\repo")));
    assert_eq!(spec.timeout, Some(Duration::from_secs(600)));

    let npm = ClaudeExecutable::NodeScript {
        node: PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
        script: PathBuf::from(r"C:\npm\node_modules\@anthropic-ai\claude-code\cli.js"),
    };
    let spec = process_spec(
        &npm,
        version_args(),
        Path::new(r"C:\repo"),
        None,
        Duration::from_secs(10),
    );
    assert_eq!(
        spec.program,
        PathBuf::from(r"C:\Program Files\nodejs\node.exe")
    );
    assert_eq!(
        strings(&spec.args),
        [
            r"C:\npm\node_modules\@anthropic-ai\claude-code\cli.js",
            "--version"
        ]
    );
    assert_eq!(spec.stdin, None);
}
