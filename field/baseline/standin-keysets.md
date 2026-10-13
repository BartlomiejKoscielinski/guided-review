# Field report

gr-probe 0.1.0. Sanitized: versions, yes/no results, status codes, header names, JSON key sets and types, timings. No hosts, users, code or values (ADR-019).

## gitlab_read

Ran at 2026-10-13T08:09:49Z.

| Check | Outcome | Detail | ms |
| - | - | - | - |
| user.keys | Info | `avatar_url`: string, `bio`: string, `bot`: bool, `can_create_group`: bool, `can_create_project`: bool, `color_scheme_id`: number, `commit_email`: string, `confirmed_at`: string, `created_at`: string, `current_sign_in_at`: string, `discord`: string, `email`: string, `external`: bool, `extra_shared_runners_minutes_limit`: null, `id`: number, `identities`: array, `job_title`: string, `last_activity_on`: string, `last_sign_in_at`: string, `linkedin`: string, `local_time`: null, `location`: string, `locked`: bool, `name`: string, `organization`: string, `private_profile`: bool, `projects_limit`: number, `pronouns`: null, `public_email`: null, `scim_identities`: array, `shared_runners_minutes_limit`: null, `skype`: string, `state`: string, `theme_id`: number, `twitter`: string, `two_factor_enabled`: bool, `username`: string, `web_url`: string, `website_url`: string, `work_information`: null |  |
| version | Pass | 200 |  |
| version.keys | Info | `enterprise`: bool, `kas`: object, `revision`: string, `version`: string |  |
| version.gitlab | Info | `17.11.7-ee` |  |
| version.enterprise_edition | Info | true |  |
| token_self | Pass | 200 |  |
| token_self.keys | Info | `active`: bool, `created_at`: string, `description`: string, `expires_at`: string, `id`: number, `last_used_at`: string, `name`: string, `revoked`: bool, `scopes`: array, `user_id`: number |  |
| token_self.scopes | Info | `api` |  |
| token_self.has_expiry | Info | true |  |
| project | Pass | 200 |  |
| mr_filter.reviewer_username | Pass | 200 |  |
| mr_filter.reviewer_username.narrows_list | Info | true |  |
| mr_filter.author_username | Pass | 200 |  |
| mr_filter.author_username.narrows_list | Info | true |  |
| mr_filter.scope_reviews_for_me | Fail | `status:400` |  |
| mr_filter.approved_by_usernames_me | Pass | 200 |  |
| mr_filter.approved_by_usernames_me.narrows_list | Info | true |  |
| mr_filter.approved_by_usernames_none | Pass | 200 |  |
| mr_filter.approved_by_usernames_none.narrows_list | Info | true |  |
| mr_filter.not_approved_by_usernames_me | Pass | 200 |  |
| mr_filter.not_approved_by_usernames_me.narrows_list | Info | false |  |
| mr_filter.approver_ids_me | Pass | 200 |  |
| mr_filter.approver_ids_me.narrows_list | Info | true |  |
| mr_filter.draft_no | Pass | 200 |  |
| mr_filter.draft_no.narrows_list | Info | false |  |
| pagination.headers | Info | `link`, `x-content-type-options`, `x-frame-options`, `x-gitlab-meta`, `x-next-page`, `x-page`, `x-per-page`, `x-prev-page`, `x-request-id`, `x-runtime`, `x-total`, `x-total-pages` |  |
| pagination.next_page_parsed | Info | true |  |
| mr_detail | Pass | 200 |  |
| mr_detail.keys | Info | `approvals_before_merge`: null, `assignee`: null, `assignees`: array, `author`: object, `author.avatar_url`: string, `author.id`: number, `author.locked`: bool, `author.name`: string, `author.state`: string, `author.username`: string, `author.web_url`: string, `blocking_discussions_resolved`: bool, `changes_count`: string, `closed_at`: null, `closed_by`: null, `created_at`: string, `description`: null, `detailed_merge_status`: string, `diff_refs`: object, `diff_refs.base_sha`: string, `diff_refs.head_sha`: string, `diff_refs.start_sha`: string, `discussion_locked`: null, `downvotes`: number, `draft`: bool, `first_contribution`: bool, `first_deployed_to_production_at`: null, `force_remove_source_branch`: null, `has_conflicts`: bool, `head_pipeline`: null, `id`: number, `iid`: number, `imported`: bool, `imported_from`: string, `labels`: array, `latest_build_finished_at`: null, `latest_build_started_at`: null, `merge_after`: null, `merge_commit_sha`: null, `merge_error`: null, `merge_status`: string, `merge_user`: null, `merge_when_pipeline_succeeds`: bool, `merged_at`: null, `merged_by`: null, `milestone`: null, `pipeline`: null, `prepared_at`: string, `project_id`: number, `reference`: string, `references`: object, `references.full`: string, `references.relative`: string, `references.short`: string, `reviewers`: array, `sha`: string, `should_remove_source_branch`: null, `source_branch`: string, `source_project_id`: number, `squash`: bool, `squash_commit_sha`: null, `squash_on_merge`: bool, `state`: string, `subscribed`: bool, `target_branch`: string, `target_project_id`: number, `task_completion_status`: object, `task_completion_status.completed_count`: number, `task_completion_status.count`: number, `time_stats`: object, `time_stats.human_time_estimate`: null, `time_stats.human_total_time_spent`: null, `time_stats.time_estimate`: number, `time_stats.total_time_spent`: number, `title`: string, `updated_at`: string, `upvotes`: number, `user`: object, `user.can_merge`: bool, `user_notes_count`: number, `web_url`: string, `work_in_progress`: bool |  |
| mr_approvals | Pass | 200 |  |
| mr_approvals.keys | Info | `approval_rules_left`: array, `approvals_left`: number, `approvals_required`: number, `approved`: bool, `approved_by`: array, `approver_groups`: array, `approvers`: array, `created_at`: string, `description`: null, `has_approval_rules`: bool, `id`: number, `iid`: number, `invalid_approvers_rules`: array, `merge_request_approvers_available`: bool, `merge_status`: string, `multiple_approval_rules_available`: bool, `project_id`: number, `require_password_to_approve`: bool, `state`: string, `suggested_approvers`: array, `title`: string, `updated_at`: string, `user_can_approve`: bool, `user_has_approved`: bool |  |
| mr_approval_state | Pass | 200 |  |
| mr_approval_state.keys | Info | `approval_rules_overwritten`: bool, `rules`: array |  |
| mr_versions | Pass | 200 |  |
| mr_versions.keys | Info | `[]`: object, `[].base_commit_sha`: string, `[].created_at`: string, `[].head_commit_sha`: string, `[].id`: number, `[].merge_request_id`: number, `[].patch_id_sha`: string, `[].real_size`: string, `[].start_commit_sha`: string, `[].state`: string |  |
| mr_discussions | Pass | 200 |  |
| mr_discussions.keys | Info |  |  |
| mr_draft_notes | Pass | 200 |  |
| mr_draft_notes.keys | Info |  |  |
| mr_pipelines | Pass | 200 |  |
| mr_pipelines.keys | Info |  |  |
| graphql.schema | Pass | 41 |  |
| graphql.mr_list.waiting | Pass | 200 |  |
| graphql.mr_list.waiting.has_rows | Info | true |  |
| graphql.mr_list.mine | Pass | 200 |  |
| graphql.mr_list.mine.has_rows | Info | true |  |
| graphql.mr_list.all | Pass | 200 |  |
| graphql.mr_list.all.has_rows | Info | true |  |
| graphql.mr_list.all.keys | Info | `project`: object, `project.all`: object, `project.all.count`: number, `project.list`: object, `project.list.nodes`: array, `project.list.nodes[]`: object, `project.list.nodes[].approvedBy`: object, `project.list.nodes[].approvedBy.nodes`: array, `project.list.nodes[].approvedBy.nodes[]`: object, `project.list.nodes[].approvedBy.nodes[].username`: string, `project.list.nodes[].author`: object, `project.list.nodes[].author.name`: string, `project.list.nodes[].author.username`: string, `project.list.nodes[].createdAt`: string, `project.list.nodes[].diffStatsSummary`: object, `project.list.nodes[].diffStatsSummary.additions`: number, `project.list.nodes[].diffStatsSummary.deletions`: number, `project.list.nodes[].diffStatsSummary.fileCount`: number, `project.list.nodes[].draft`: bool, `project.list.nodes[].headPipeline`: object, `project.list.nodes[].headPipeline.status`: string, `project.list.nodes[].iid`: string, `project.list.nodes[].resolvableDiscussionsCount`: number, `project.list.nodes[].resolvedDiscussionsCount`: number, `project.list.nodes[].reviewers`: object, `project.list.nodes[].reviewers.nodes`: array, `project.list.nodes[].reviewers.nodes[]`: object, `project.list.nodes[].reviewers.nodes[].mergeRequestInteraction`: object, `project.list.nodes[].reviewers.nodes[].mergeRequestInteraction.approved`: bool, `project.list.nodes[].reviewers.nodes[].username`: string, `project.list.nodes[].title`: string, `project.list.nodes[].updatedAt`: string, `project.list.nodes[].webUrl`: string, `project.list.pageInfo`: object, `project.list.pageInfo.endCursor`: string, `project.list.pageInfo.hasNextPage`: bool, `project.mine`: object, `project.mine.count`: number, `project.waiting`: object, `project.waiting.count`: number |  |

## gitlab_write

Ran at 2026-10-12T06:30:12Z.

| Check | Outcome | Detail | ms |
| - | - | - | - |
| user.keys | Info | `avatar_url`: string, `bio`: string, `bot`: bool, `can_create_group`: bool, `can_create_project`: bool, `color_scheme_id`: number, `commit_email`: string, `confirmed_at`: string, `created_at`: string, `current_sign_in_at`: string, `discord`: string, `email`: string, `external`: bool, `extra_shared_runners_minutes_limit`: null, `id`: number, `identities`: array, `job_title`: string, `last_activity_on`: string, `last_sign_in_at`: string, `linkedin`: string, `local_time`: null, `location`: string, `locked`: bool, `name`: string, `organization`: string, `private_profile`: bool, `projects_limit`: number, `pronouns`: null, `public_email`: null, `scim_identities`: array, `shared_runners_minutes_limit`: null, `skype`: string, `state`: string, `theme_id`: number, `twitter`: string, `two_factor_enabled`: bool, `username`: string, `web_url`: string, `website_url`: string, `work_information`: null |  |
| w01_branch_base | Pass | 201 |  |
| w02_commit_base | Pass | 201 |  |
| w03_branch_head | Pass | 201 |  |
| w04_commit_head | Pass | 201 |  |
| w05_create_mr_draft_param | Pass | 201 |  |
| w05.draft_param_honoured | Info | false |  |
| w05b_draft_prefix | Pass | 200 |  |
| w05b.draft_prefix_honoured | Info | true |  |
| w06_mr_detail.keys | Info | `approvals_before_merge`: null, `assignee`: null, `assignees`: array, `author`: object, `author.avatar_url`: string, `author.id`: number, `author.locked`: bool, `author.name`: string, `author.state`: string, `author.username`: string, `author.web_url`: string, `blocking_discussions_resolved`: bool, `changes_count`: string, `closed_at`: null, `closed_by`: null, `created_at`: string, `description`: string, `detailed_merge_status`: string, `diff_refs`: object, `diff_refs.base_sha`: string, `diff_refs.head_sha`: string, `diff_refs.start_sha`: string, `discussion_locked`: null, `downvotes`: number, `draft`: bool, `first_contribution`: bool, `first_deployed_to_production_at`: null, `force_remove_source_branch`: bool, `has_conflicts`: bool, `head_pipeline`: object, `head_pipeline.before_sha`: string, `head_pipeline.committed_at`: null, `head_pipeline.coverage`: null, `head_pipeline.created_at`: string, `head_pipeline.detailed_status`: object, `head_pipeline.duration`: null, `head_pipeline.finished_at`: null, `head_pipeline.id`: number, `head_pipeline.iid`: number, `head_pipeline.project_id`: number, `head_pipeline.queued_duration`: null, `head_pipeline.ref`: string, `head_pipeline.sha`: string, `head_pipeline.source`: string, `head_pipeline.started_at`: null, `head_pipeline.status`: string, `head_pipeline.tag`: bool, `head_pipeline.updated_at`: string, `head_pipeline.user`: object, `head_pipeline.web_url`: string, `head_pipeline.yaml_errors`: null, `id`: number, `iid`: number, `imported`: bool, `imported_from`: string, `labels`: array, `latest_build_finished_at`: null, `latest_build_started_at`: null, `merge_after`: null, `merge_commit_sha`: null, `merge_error`: null, `merge_status`: string, `merge_user`: null, `merge_when_pipeline_succeeds`: bool, `merged_at`: null, `merged_by`: null, `milestone`: null, `pipeline`: null, `prepared_at`: string, `project_id`: number, `reference`: string, `references`: object, `references.full`: string, `references.relative`: string, `references.short`: string, `reviewers`: array, `reviewers[]`: object, `sha`: string, `should_remove_source_branch`: null, `source_branch`: string, `source_project_id`: number, `squash`: bool, `squash_commit_sha`: null, `squash_on_merge`: bool, `state`: string, `subscribed`: bool, `target_branch`: string, `target_project_id`: number, `task_completion_status`: object, `task_completion_status.completed_count`: number, `task_completion_status.count`: number, `time_stats`: object, `time_stats.human_time_estimate`: null, `time_stats.human_total_time_spent`: null, `time_stats.time_estimate`: number, `time_stats.total_time_spent`: number, `title`: string, `updated_at`: string, `upvotes`: number, `user`: object, `user.can_merge`: bool, `user_notes_count`: number, `web_url`: string, `work_in_progress`: bool |  |
| w07_draft_added_line | Pass | 201 |  |
| w07_draft_note.keys | Info | `author_id`: number, `commit_id`: null, `discussion_id`: null, `id`: number, `line_code`: string, `merge_request_id`: number, `note`: string, `position`: object, `position.base_sha`: string, `position.head_sha`: string, `position.line_range`: null, `position.new_line`: number, `position.new_path`: string, `position.old_line`: null, `position.old_path`: string, `position.position_type`: string, `position.start_sha`: string, `resolve_discussion`: bool |  |
| w07_draft_deleted_line | Pass | 201 |  |
| w07_draft_context_line | Pass | 201 |  |
| w07_draft_no_position | Pass | 201 |  |
| w08_bulk_publish | Pass | 204 |  |
| w08.added_line_kept | Info | true |  |
| w08.deleted_line_kept | Info | true |  |
| w08.context_line_kept | Info | true |  |
| w08.no_position_draft_is_general_comment | Info | true |  |
| w08_published_note.keys | Info | `author`: object, `author.avatar_url`: string, `author.id`: number, `author.locked`: bool, `author.name`: string, `author.state`: string, `author.username`: string, `author.web_url`: string, `body`: string, `commands_changes`: object, `commit_id`: null, `confidential`: bool, `created_at`: string, `id`: number, `imported`: bool, `imported_from`: string, `internal`: bool, `noteable_id`: number, `noteable_iid`: number, `noteable_type`: string, `position`: object, `position.base_sha`: string, `position.head_sha`: string, `position.line_range`: null, `position.new_line`: number, `position.new_path`: string, `position.old_line`: null, `position.old_path`: string, `position.position_type`: string, `position.start_sha`: string, `project_id`: number, `resolvable`: bool, `resolved`: bool, `resolved_at`: null, `resolved_by`: null, `system`: bool, `type`: string, `updated_at`: string |  |
| w08b_draft_for_summary_publish | Pass | 201 |  |
| w08b_bulk_publish_with_note | Pass | 204 |  |
| w08b.summary_note_published | Info | false |  |
| w09_approvals_before.keys | Info | `approval_rules_left`: array, `approvals_left`: number, `approvals_required`: number, `approved`: bool, `approved_by`: array, `approver_groups`: array, `approvers`: array, `created_at`: string, `description`: string, `has_approval_rules`: bool, `id`: number, `iid`: number, `invalid_approvers_rules`: array, `merge_request_approvers_available`: bool, `merge_status`: string, `multiple_approval_rules_available`: bool, `project_id`: number, `require_password_to_approve`: bool, `state`: string, `suggested_approvers`: array, `title`: string, `updated_at`: string, `user_can_approve`: bool, `user_has_approved`: bool |  |
| w09_approve_stale_sha | Fail | `status:409` |  |
| w09_approve_head_sha | Pass | 201 |  |
| w09.approved_by_listed | Info | true |  |
| w10.listed_by_reviewer_username | Info | true |  |
| w10.listed_by_author_username | Info | true |  |
| w10.listed_by_approved_by_usernames_me | Info | true |  |
| w10.listed_by_not_approved_by_usernames_me | Info | true |  |
| w09_unapprove | Pass | 201 |  |
| w12_run_mr_pipeline | Pass | 200 |  |
| w12_jobs.keys | Info | `[]`: object, `[].allow_failure`: bool, `[].archived`: bool, `[].artifacts`: array, `[].artifacts_expire_at`: null, `[].commit`: object, `[].commit.author_email`: string, `[].commit.author_name`: string, `[].commit.authored_date`: string, `[].commit.committed_date`: string, `[].commit.committer_email`: string, `[].commit.committer_name`: string, `[].commit.created_at`: string, `[].commit.extended_trailers`: object, `[].commit.id`: string, `[].commit.message`: string, `[].commit.parent_ids`: array, `[].commit.short_id`: string, `[].commit.title`: string, `[].commit.trailers`: object, `[].commit.web_url`: string, `[].coverage`: null, `[].created_at`: string, `[].duration`: null, `[].erased_at`: null, `[].finished_at`: null, `[].id`: number, `[].name`: string, `[].pipeline`: object, `[].pipeline.created_at`: string, `[].pipeline.id`: number, `[].pipeline.iid`: number, `[].pipeline.project_id`: number, `[].pipeline.ref`: string, `[].pipeline.sha`: string, `[].pipeline.source`: string, `[].pipeline.status`: string, `[].pipeline.updated_at`: string, `[].pipeline.web_url`: string, `[].project`: object, `[].project.ci_job_token_scope_enabled`: bool, `[].queued_duration`: null, `[].ref`: string, `[].runner`: null, `[].runner_manager`: null, `[].stage`: string, `[].started_at`: null, `[].status`: string, `[].tag`: bool, `[].tag_list`: array, `[].user`: object, `[].user.avatar_url`: string, `[].user.bio`: string, `[].user.bot`: bool, `[].user.created_at`: string, `[].user.discord`: string, `[].user.followers`: number, `[].user.following`: number, `[].user.id`: number, `[].user.job_title`: string, `[].user.linkedin`: string, `[].user.local_time`: null, `[].user.location`: string, `[].user.locked`: bool, `[].user.name`: string, `[].user.organization`: string, `[].user.pronouns`: null, `[].user.public_email`: null, `[].user.skype`: string, `[].user.state`: string, `[].user.twitter`: string, `[].user.username`: string, `[].user.web_url`: string, `[].user.website_url`: string, `[].user.work_information`: null, `[].web_url`: string |  |
| w12.manual_job_status | Info | `created` |  |
| w13_play_manual_job | Pass | 200 |  |
| w13_cancel_job | Pass | 201 |  |
| w11_close_mr | Pass | 200 |  |

## tls

Ran at 2026-10-12T06:26:37Z.

| Check | Outcome | Detail | ms |
| - | - | - | - |
| token_stored | Info | true |  |
| system_proxy_env | Info | false |  |
| platform.handshake | Pass | 200 | 406 |
| platform.version_keys | Info | `enterprise`: bool, `kas`: object, `kas.enabled`: bool, `kas.externalK8sProxyUrl`: null, `kas.externalUrl`: null, `kas.version`: null, `revision`: string, `version`: string |  |
| platform.gitlab_version | Info | `17.11.7-ee` |  |
| schannel.handshake | Pass | 200 | 336 |
| schannel.version_keys | Info | `enterprise`: bool, `kas`: object, `kas.enabled`: bool, `kas.externalK8sProxyUrl`: null, `kas.externalUrl`: null, `kas.version`: null, `revision`: string, `version`: string |  |
| schannel.gitlab_version | Info | `17.11.7-ee` |  |
