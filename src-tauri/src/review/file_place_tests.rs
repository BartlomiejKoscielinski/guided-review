//! F-08.7 Analysis context (M4 decision 8): each file Claude read for a step gets its place.
//! "step N" = the current step when its hunks touch the file, otherwise the first step in the
//! reader's current order that touches it (N is that step's number in the order); "skim" = only
//! skim hunks touch it; "outside" = the file isn't in the diff ("outside MR", self-review:
//! "outside the change").

use super::coverage::HunkRef;
use super::file_place::{FilePlace, place};
use super::layer::Layer;
use super::plan_model::{Coverage, Orders, Plan, SkimGroup, Step};

const QUEUE: &str = "src/Mobile.Core/Uploads/IUploadQueue.cs";
const WORKER: &str = "src/Mobile.Infrastructure/Uploads/UploadWorker.cs";
const VM: &str = "src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs";
const STRINGS: &str = "src/Mobile.App/Resources/Strings/AppResources.resx";
const PAGE: &str = "src/Mobile.App/Views/Ąę Strona zdjęcia.xaml";
const CAMERA: &str = "src/Mobile.App/Services/CameraService.cs";

/// The change's hunks in diff order: the queue (h1, h2), the worker (h3, h4), the view model
/// (h5), the strings (h6, skim only) and a page with a Polish name and spaces (h7 in a step, h8
/// in skim).
const HUNKS: [HunkRef; 8] = [
    HunkRef {
        id: "h1",
        file: QUEUE,
    },
    HunkRef {
        id: "h2",
        file: QUEUE,
    },
    HunkRef {
        id: "h3",
        file: WORKER,
    },
    HunkRef {
        id: "h4",
        file: WORKER,
    },
    HunkRef { id: "h5", file: VM },
    HunkRef {
        id: "h6",
        file: STRINGS,
    },
    HunkRef {
        id: "h7",
        file: PAGE,
    },
    HunkRef {
        id: "h8",
        file: PAGE,
    },
];

fn step(id: &str, hunk_ids: &[&str]) -> Step {
    Step {
        id: id.into(),
        title: id.into(),
        short_title: id.into(),
        reason: String::new(),
        description: String::new(),
        layer: Layer::App,
        hunk_ids: hunk_ids.iter().map(|&h| h.into()).collect(),
        builds_on: Vec::new(),
    }
}

/// s1 the queue's first hunk, s2 the worker's first hunk and the queue's second, s3 the worker's
/// second hunk, s4 the view model and the page's first hunk; skim: the strings and the page's
/// second hunk.
fn plan() -> Plan {
    Plan {
        intent: String::new(),
        steps: vec![
            step("s1", &["h1"]),
            step("s2", &["h3", "h2"]),
            step("s3", &["h4"]),
            step("s4", &["h5", "h7"]),
        ],
        orders: Orders::default(),
        skim: vec![SkimGroup {
            hunk_ids: vec!["h6".into(), "h8".into()],
            reason: "Resources and formatting only.".into(),
        }],
        risks: Vec::new(),
        description_check: Vec::new(),
        already_discussed: String::new(),
        coverage: Coverage::default(),
    }
}

fn order(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|&id| id.to_owned()).collect()
}

#[test]
fn f08_7_a_file_the_current_step_touches_is_the_current_step() {
    let plan = plan();
    let order = order(&["s1", "s2", "s3", "s4"]);
    // s1 and s2 both touch the queue: on s2 the file is in front of the reader.
    assert_eq!(
        place(&plan, &HUNKS, &order, "s2", QUEUE),
        FilePlace::Step(2)
    );
    // s2 and s3 both touch the worker: on s3 it is step 3, not the earlier s2.
    assert_eq!(
        place(&plan, &HUNKS, &order, "s3", WORKER),
        FilePlace::Step(3)
    );
    assert_eq!(place(&plan, &HUNKS, &order, "s4", VM), FilePlace::Step(4));
}

#[test]
fn f08_7_otherwise_the_first_step_in_the_current_order_that_touches_it() {
    let plan = plan();
    let contract = order(&["s1", "s2", "s3", "s4"]);
    assert_eq!(
        place(&plan, &HUNKS, &contract, "s4", QUEUE),
        FilePlace::Step(1)
    );
    assert_eq!(
        place(&plan, &HUNKS, &contract, "s4", WORKER),
        FilePlace::Step(2)
    );
    assert_eq!(
        place(&plan, &HUNKS, &contract, "s1", VM),
        FilePlace::Step(4)
    );

    // The reader's order, not the plan's: s3 comes first, so the worker is step 1 there, and the
    // queue's first step in this order is s2 at number 3.
    let reordered = order(&["s3", "s4", "s2", "s1"]);
    assert_eq!(
        place(&plan, &HUNKS, &reordered, "s4", WORKER),
        FilePlace::Step(1)
    );
    assert_eq!(
        place(&plan, &HUNKS, &reordered, "s4", QUEUE),
        FilePlace::Step(3)
    );
    assert_eq!(
        place(&plan, &HUNKS, &reordered, "s3", VM),
        FilePlace::Step(2)
    );
}

#[test]
fn f08_7_a_file_only_skim_hunks_touch_is_skim() {
    let plan = plan();
    let order = order(&["s1", "s2", "s3", "s4"]);
    assert_eq!(place(&plan, &HUNKS, &order, "s4", STRINGS), FilePlace::Skim);
    assert_eq!(place(&plan, &HUNKS, &order, "s1", STRINGS), FilePlace::Skim);
}

#[test]
fn f08_7_a_step_comes_before_skim_when_both_touch_the_file() {
    let plan = plan();
    let order = order(&["s1", "s2", "s3", "s4"]);
    // The page has one hunk in s4 and one in skim; a Polish name with spaces matches as given.
    assert_eq!(place(&plan, &HUNKS, &order, "s1", PAGE), FilePlace::Step(4));
    assert_eq!(place(&plan, &HUNKS, &order, "s4", PAGE), FilePlace::Step(4));
}

#[test]
fn f08_7_a_file_the_diff_does_not_hold_is_outside() {
    let plan = plan();
    let order = order(&["s1", "s2", "s3", "s4"]);
    assert_eq!(
        place(&plan, &HUNKS, &order, "s4", CAMERA),
        FilePlace::Outside
    );
    // Only the whole path counts: a longer or shorter name next to a diff file is not that file.
    assert_eq!(
        place(
            &plan,
            &HUNKS,
            &order,
            "s4",
            "src/Mobile.Core/Uploads/IUploadQueue.cs.bak"
        ),
        FilePlace::Outside
    );
    assert_eq!(
        place(&plan, &HUNKS, &order, "s4", "Uploads/IUploadQueue.cs"),
        FilePlace::Outside
    );
}
