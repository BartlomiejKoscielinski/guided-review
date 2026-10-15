#![allow(clippy::unwrap_used, reason = "tests")]
use super::*;
use crate::review::layer::Layer;
use crate::review::plan_model::{Coverage, Orders, Step};
use crate::store::Store;

fn step(id: &str, layer: Layer, hunk: &str) -> Step {
    Step {
        id: id.into(),
        title: id.into(),
        short_title: id.into(),
        reason: String::new(),
        description: String::new(),
        layer,
        hunk_ids: vec![hunk.into()],
        builds_on: Vec::new(),
    }
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|&s| s.into()).collect()
}

/// s1 XAML, s2 Core, s3 Tests; Claude's orders differ from File order.
fn plan() -> Plan {
    Plan {
        intent: String::new(),
        steps: vec![
            step("s1", Layer::Xaml, "h1"),
            step("s2", Layer::Core, "h2"),
            step("s3", Layer::Tests, "h3"),
        ],
        orders: Orders {
            contract_to_ui: ids(&["s2", "s1", "s3"]),
            tests_first: ids(&["s3", "s2", "s1"]),
        },
        skim: Vec::new(),
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    }
}

const HUNKS: [HunkRef; 3] = [
    HunkRef {
        id: "h1",
        file: "src/App/Views/QueuePage.xaml",
    },
    HunkRef {
        id: "h2",
        file: "src/Mobile.Core/Upload/IUploadQueue.cs",
    },
    HunkRef {
        id: "h3",
        file: "tests/Mobile.Core.Tests/UploadQueueTests.cs",
    },
];

fn with<T>(f: impl FnOnce(&Connection) -> T) -> T {
    let store = Store::open_in_memory().unwrap();
    let mut out = None;
    store
        .with_conn(|c| {
            store::sessions::insert_for_test(c, "r1", "planning", "focus", "2026-10-13T10:00:00Z");
            out = Some(f(c));
            Ok(())
        })
        .unwrap();
    out.unwrap()
}

#[test]
fn f06_4_default_is_contract_to_ui() {
    with(|c| {
        let order = load(c, "r1", &plan(), &HUNKS).unwrap();
        assert_eq!(
            order,
            StepOrder {
                strategy: Strategy::ContractToUi,
                custom: false,
                order: ids(&["s2", "s1", "s3"]),
            }
        );
    });
}

#[test]
fn f06_4_set_strategy_reorders_and_is_stored() {
    with(|c| {
        let tests = set_strategy(c, "r1", Strategy::TestsFirst, &plan(), &HUNKS).unwrap();
        assert_eq!(tests.order, ids(&["s3", "s2", "s1"]));
        assert_eq!(
            store::sessions::strategy(c, "r1").unwrap(),
            Strategy::TestsFirst
        );
        let files = set_strategy(c, "r1", Strategy::FileOrder, &plan(), &HUNKS).unwrap();
        // GitLab path order: src/App, src/Mobile.Core, tests.
        assert_eq!(files.order, ids(&["s1", "s2", "s3"]));
        assert_eq!(load(c, "r1", &plan(), &HUNKS).unwrap(), files);
        let missing = set_strategy(c, "nope", Strategy::FileOrder, &plan(), &HUNKS).unwrap_err();
        assert!(matches!(missing, StepOrderError::UnknownSession));
    });
}

#[test]
fn f06_5_dragged_order_overrides_until_a_strategy_is_picked() {
    with(|c| {
        let dragged = ids(&["s1", "s3", "s2"]);
        let custom = reorder(c, "r1", &dragged, &plan(), &HUNKS).unwrap();
        assert!(custom.custom);
        assert_eq!(custom.order, dragged);
        assert_eq!(load(c, "r1", &plan(), &HUNKS).unwrap(), custom);

        // Picking a strategy (even the current one) clears the custom order.
        let reset = set_strategy(c, "r1", Strategy::ContractToUi, &plan(), &HUNKS).unwrap();
        assert!(!reset.custom);
        assert_eq!(reset.order, ids(&["s2", "s1", "s3"]));
        assert_eq!(store::plans::custom_order(c, "r1").unwrap(), None);
    });
}

#[test]
fn f06_5_order_must_name_every_step_once() {
    with(|c| {
        for bad in [
            ids(&["s1", "s2"]),
            ids(&["s1", "s2", "s2"]),
            ids(&["s1", "s2", "s3", "s3"]),
            ids(&["s1", "s2", "s9"]),
        ] {
            let error = reorder(c, "r1", &bad, &plan(), &HUNKS).unwrap_err();
            assert!(matches!(error, StepOrderError::Mismatch), "{bad:?}");
        }
        assert_eq!(store::plans::custom_order(c, "r1").unwrap(), None);
        let error = reorder(c, "nope", &ids(&["s1", "s2", "s3"]), &plan(), &HUNKS).unwrap_err();
        assert_eq!(AppError::from(error).code, ErrorCode::InvalidInput);
    });
}

#[test]
fn f06_5_custom_order_of_an_older_plan_keeps_known_steps() {
    with(|c| {
        store::plans::set_custom_order(c, "r1", Some(&ids(&["s3", "gone", "s1"]))).unwrap();
        let order = load(c, "r1", &plan(), &HUNKS).unwrap();
        assert!(order.custom);
        assert_eq!(order.order, ids(&["s3", "s1", "s2"]));
    });
}

/// A session holding the app's fallback plan (02 › S-02 Claude failed).
fn fallback_context() -> crate::review::step_context::StepContext {
    use crate::claude::tasks::plan_inputs::PlanSource;
    use crate::review::step_context::{SessionInputs, StepContext};
    let inputs = SessionInputs {
        session_id: "r1".into(),
        repo_id: 1,
        source: PlanSource::Commits {
            from: None,
            to: "head".into(),
        },
        project: String::new(),
        mr: None,
        base_sha: "base".into(),
        head_sha: "head".into(),
        cwd: std::path::PathBuf::new(),
        files: Vec::new(),
        threads: Vec::new(),
        rules: None,
        description: None,
    };
    StepContext::fallback(inputs, plan())
}

#[test]
fn f06_5_fallback_plan_refuses_a_dragged_order_and_keeps_file_order() {
    with(|c| {
        let cx = fallback_context();
        let error = cx.reorder(c, &ids(&["s3", "s2", "s1"])).unwrap_err();
        assert!(matches!(error, StepOrderError::Fallback));
        let error = AppError::from(error);
        assert_eq!(error.code, ErrorCode::InvalidInput);
        assert_eq!(
            error.message,
            "Claude isn't available. You can review in file order."
        );
        assert_eq!(store::plans::custom_order(c, "r1").unwrap(), None);
        let order = cx.step_order(c).unwrap();
        assert!(!order.custom);
        assert_eq!(order.strategy, Strategy::FileOrder);
        assert_eq!(order.order, ids(&["s1", "s2", "s3"]));
    });
}
