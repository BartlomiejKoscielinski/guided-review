//! GraphQL checks of `gitlab read` (field visit 2, ADR-024): the schema has every type, field,
//! argument and enum value the S-01 list query uses, and the app's own query (`mrs::QUERY`)
//! answers on each tab. The report holds names, statuses and key sets; values never.

use std::collections::BTreeSet;

use guided_review_lib::gitlab::mrs::{self, MrTab};
use serde_json::{Value, json};

use crate::gitlab_read::{Session, keys_check};
use crate::report::{Check, Detail, Outcome};
use crate::tls::error_code;

/// What `queries/mr_list.graphql` reads: `Type.field`, `Type.field[argument]`, an input
/// object's `Type.field` and an enum's `Type.VALUE` (report names allow only `A-Za-z0-9_.-[]`).
pub const EXPECTED: &[&str] = &[
    "Project.mergeRequests",
    "Project.mergeRequests[state]",
    "Project.mergeRequests[reviewerUsername]",
    "Project.mergeRequests[authorUsername]",
    "Project.mergeRequests[not]",
    "Project.mergeRequests[sort]",
    "Project.mergeRequests[first]",
    "Project.mergeRequests[after]",
    "MergeRequestsResolverNegatedParams.approvedBy",
    "MergeRequestState.opened",
    "MergeRequestSort.UPDATED_DESC",
    "MergeRequestConnection.count",
    "MergeRequestConnection.pageInfo",
    "MergeRequestConnection.nodes",
    "PageInfo.hasNextPage",
    "PageInfo.endCursor",
    "MergeRequest.iid",
    "MergeRequest.title",
    "MergeRequest.draft",
    "MergeRequest.webUrl",
    "MergeRequest.createdAt",
    "MergeRequest.updatedAt",
    "MergeRequest.author",
    "MergeRequest.diffStatsSummary",
    "MergeRequest.headPipeline",
    "MergeRequest.resolvableDiscussionsCount",
    "MergeRequest.resolvedDiscussionsCount",
    "MergeRequest.reviewers",
    "MergeRequest.approvedBy",
    "MergeRequestAuthor.username",
    "MergeRequestAuthor.name",
    "DiffStatsSummary.additions",
    "DiffStatsSummary.deletions",
    "DiffStatsSummary.fileCount",
    "Pipeline.status",
    "MergeRequestReviewerConnection.nodes",
    "MergeRequestReviewer.username",
    "MergeRequestReviewer.mergeRequestInteraction",
    "UserMergeRequestInteraction.approved",
    "UserCoreConnection.nodes",
    "UserCore.username",
];

/// Rows fetched per tab: the key set is the union over these rows (`key_types` reads 20).
const ROWS: u32 = 20;

/// The type names in [`EXPECTED`], in order, without repeats.
fn expected_types() -> Vec<&'static str> {
    let mut types: Vec<&str> = Vec::new();
    for entry in EXPECTED {
        let name = entry.split('.').next().unwrap_or(entry);
        if !types.contains(&name) {
            types.push(name);
        }
    }
    types
}

/// One aliased `__type` lookup per expected type.
pub fn introspection_query() -> String {
    let lookups: String = expected_types()
        .iter()
        .enumerate()
        .map(|(i, name)| {
            format!(
                "t{i}: __type(name: \"{name}\") {{ name fields {{ name args {{ name }} }} \
                 inputFields {{ name }} enumValues {{ name }} }} "
            )
        })
        .collect();
    format!("query {{ {lookups}}}")
}

/// Everything the introspection answer names, in the [`EXPECTED`] notation.
fn present(data: &Value) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let types = data.as_object().into_iter().flat_map(|map| map.values());
    for ty in types {
        let Some(type_name) = ty.get("name").and_then(Value::as_str) else {
            continue;
        };
        let list = |key: &str| ty.get(key).and_then(Value::as_array).cloned();
        for field in list("fields").into_iter().flatten() {
            let Some(field_name) = field.get("name").and_then(Value::as_str) else {
                continue;
            };
            found.insert(format!("{type_name}.{field_name}"));
            for arg in field
                .get("args")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(arg) = arg.get("name").and_then(Value::as_str) {
                    found.insert(format!("{type_name}.{field_name}[{arg}]"));
                }
            }
        }
        for input in list("inputFields").into_iter().flatten() {
            if let Some(name) = input.get("name").and_then(Value::as_str) {
                found.insert(format!("{type_name}.{name}"));
            }
        }
        for value in list("enumValues").into_iter().flatten() {
            if let Some(name) = value.get("name").and_then(Value::as_str) {
                found.insert(format!("{type_name}.{name}"));
            }
        }
    }
    found
}

/// The schema check: Pass when nothing is missing, Fail with the missing names otherwise.
pub fn schema_check(data: &Value) -> Check {
    let found = present(data);
    let missing: Vec<String> = EXPECTED
        .iter()
        .filter(|entry| !found.contains(**entry))
        .map(|entry| (*entry).to_owned())
        .collect();
    if missing.is_empty() {
        Check::new("graphql.schema", Outcome::Pass).detail(Detail::Number(EXPECTED.len() as i64))
    } else {
        Check::new("graphql.schema.missing", Outcome::Fail).detail(Detail::Names(missing))
    }
}

/// Whether the list connection of a query answer has rows.
fn has_rows(data: &Value) -> bool {
    data["project"]["list"]["nodes"]
        .as_array()
        .is_some_and(|nodes| !nodes.is_empty())
}

fn tab_name(tab: MrTab) -> &'static str {
    match tab {
        MrTab::Waiting => "waiting",
        MrTab::Mine => "mine",
        MrTab::All => "all",
    }
}

/// Checks of one tab's answer; the key set only for the `all` tab (the shape is the same).
pub fn tab_checks(tab: MrTab, result: &Result<Value, String>) -> Vec<Check> {
    let id = format!("graphql.mr_list.{}", tab_name(tab));
    match result {
        Err(code) => vec![Check::new(&id, Outcome::Fail).detail(Detail::Code(code.clone()))],
        Ok(data) if data.get("project").is_none_or(Value::is_null) => {
            vec![Check::new(&id, Outcome::Fail).detail(Detail::Code("no_project".into()))]
        }
        Ok(data) => {
            let mut checks = vec![
                Check::new(&id, Outcome::Pass).detail(Detail::Status(200)),
                Check::new(&format!("{id}.has_rows"), Outcome::Info)
                    .detail(Detail::Bool(has_rows(data))),
            ];
            if tab == MrTab::All {
                checks.push(keys_check(&id, data, 12));
            }
            checks
        }
    }
}

pub async fn checks(session: &Session) -> Vec<Check> {
    let gitlab = &session.client;
    let mut checks = Vec::new();
    match gitlab.graphql(&introspection_query(), &json!({})).await {
        Ok(data) => checks.push(schema_check(&data)),
        Err(error) => checks.push(
            Check::new("graphql.schema", Outcome::Fail).detail(Detail::Code(error_code(&error))),
        ),
    }
    let Some((_, path)) = &session.project else {
        checks.push(
            Check::new("graphql.mr_list", Outcome::Skip).detail(Detail::Code("no_project".into())),
        );
        return checks;
    };
    for tab in [MrTab::Waiting, MrTab::Mine, MrTab::All] {
        let variables = mrs::variables(path, &session.me_username, tab, ROWS, None);
        let result = gitlab
            .graphql(mrs::QUERY, &variables)
            .await
            .map_err(|error| error_code(&error));
        checks.extend(tab_checks(tab, &result));
    }
    checks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f02_1_expected_names_are_the_ones_the_app_query_uses() {
        for entry in EXPECTED {
            let name = entry
                .rsplit(['.', '['])
                .next()
                .unwrap_or(entry)
                .trim_end_matches(']');
            assert!(mrs::QUERY.contains(name), "{entry} not in mr_list.graphql");
        }
        let query = introspection_query();
        assert!(query.contains("t0: __type(name: \"Project\")"));
        assert!(query.contains("\"UserCore\""));
        assert_eq!(query.matches("\"MergeRequest\"").count(), 1);
    }

    fn type_answer(name: &str, fields: &[(&str, &[&str])]) -> Value {
        json!({
            "name": name,
            "fields": fields.iter().map(|(field, args)| json!({
                "name": field,
                "args": args.iter().map(|a| json!({ "name": a })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "inputFields": null,
            "enumValues": null,
        })
    }

    #[test]
    fn f02_1_schema_check_names_what_is_missing() {
        let data = json!({
            "t0": type_answer("Project", &[("mergeRequests", &["state", "first"])]),
            "t1": { "name": "MergeRequestSort", "fields": null, "inputFields": null,
                    "enumValues": [{ "name": "UPDATED_DESC" }] },
            "t2": null,
        });
        let check = schema_check(&data);
        assert_eq!(check.outcome, Outcome::Fail);
        let Some(Detail::Names(missing)) = &check.detail else {
            panic!("missing names expected");
        };
        assert!(missing.contains(&"Project.mergeRequests[not]".to_owned()));
        assert!(missing.contains(&"MergeRequest.diffStatsSummary".to_owned()));
        assert!(!missing.contains(&"Project.mergeRequests[state]".to_owned()));
        assert!(!missing.contains(&"MergeRequestSort.UPDATED_DESC".to_owned()));
    }

    #[test]
    fn f02_1_schema_check_passes_when_everything_is_there() {
        let mut types = serde_json::Map::new();
        for (i, name) in expected_types().iter().enumerate() {
            // Enum values and input fields read as `Type.name` like fields, so fields cover all.
            let prefix = format!("{name}.");
            let fields: Vec<Value> = EXPECTED
                .iter()
                .filter_map(|entry| entry.strip_prefix(&prefix))
                .map(|rest| match rest.split_once('[') {
                    Some((field, arg)) => {
                        json!({ "name": field, "args": [{ "name": arg.trim_end_matches(']') }] })
                    }
                    None => json!({ "name": rest, "args": [] }),
                })
                .collect();
            types.insert(
                format!("t{i}"),
                json!({ "name": name, "fields": fields, "inputFields": null, "enumValues": null }),
            );
        }
        let check = schema_check(&Value::Object(types));
        assert_eq!(check.outcome, Outcome::Pass, "{check:?}");
    }

    #[test]
    fn f02_2_tab_checks_report_key_sets_never_values() {
        let data = json!({ "project": {
            "waiting": { "count": 3 }, "mine": { "count": 1 }, "all": { "count": 9 },
            "list": {
                "pageInfo": { "hasNextPage": true, "endCursor": "eyJpZCI6IjQyIn0" },
                "nodes": [{
                    "iid": "42", "title": "Secret change", "draft": false,
                    "webUrl": "https://gitlab.corp.example/mobile/app/-/merge_requests/42",
                    "author": { "username": "jan.kowalski", "name": "Jan Kowalski" },
                    "diffStatsSummary": { "additions": 5, "deletions": 2, "fileCount": 1 },
                    "headPipeline": null,
                    "reviewers": { "nodes": [{ "username": "anna",
                        "mergeRequestInteraction": { "approved": false } }] },
                    "approvedBy": { "nodes": [] },
                }],
            },
        }});
        let checks = tab_checks(MrTab::All, &Ok(data));
        assert_eq!(checks[0].outcome, Outcome::Pass);
        let text = format!("{checks:?}");
        for value in ["Secret", "jan", "Kowalski", "anna", "corp", "eyJ", "42"] {
            assert!(!text.contains(value), "{value} leaked");
        }
        let Some(Detail::Keys(keys)) = &checks[2].detail else {
            panic!("key set expected");
        };
        assert_eq!(
            keys["project.list.nodes[].reviewers.nodes[].mergeRequestInteraction.approved"],
            "bool"
        );
        assert_eq!(keys["project.list.nodes[].headPipeline"], "null");
        assert_eq!(keys["project.waiting.count"], "number");
        assert!(matches!(checks[1].detail, Some(Detail::Bool(true))));
        assert_eq!(
            tab_checks(
                MrTab::Waiting,
                &Ok(json!({ "project": { "list": { "nodes": [] } } }))
            )
            .len(),
            2
        );
    }

    #[test]
    fn f02_1_tab_checks_fail_with_a_code() {
        let failed = tab_checks(MrTab::Mine, &Err("graphql".into()));
        assert_eq!(failed[0].outcome, Outcome::Fail);
        assert!(matches!(&failed[0].detail, Some(Detail::Code(code)) if code == "graphql"));
        let hidden = tab_checks(MrTab::Waiting, &Ok(json!({ "project": null })));
        assert!(matches!(&hidden[0].detail, Some(Detail::Code(code)) if code == "no_project"));
    }
}
