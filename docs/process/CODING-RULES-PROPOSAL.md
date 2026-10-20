# Coding rules: research proposal (2026-10-15)

Status: **accepted by the owner on 2026-10-15; the owner delegated the open decisions, which are recorded below. Implemented on `claude/loving-bouman-a46fda`.**

- **Group A** ends at `90b99a0` (`2c09fa2`, `68c7789`, `90b99a0`). Merge it at once.
- **Group B** ends at `1e313a5` (`8cde4a0`, `1e313a5`). Merge it when E16 is judged, then start E18.

Notes from the implementation:

- **e2e restarts (L2):** they now run the page on Playwright's clock. `openStep1` installs it; `flushSaves` and `restartApp` run it past the mock's latency and the scroll debounce. A scroll waits for its `scroll` event before the clock runs. Green 3 times in a row.
- **Clippy (C1, C2):** every exception is an `#[expect(clippy::disallowed_methods, reason)]`, so a stale one fails the build.
- **Capabilities (S1):** checked in the real app with `/app`:
  - drag, minimize, maximize and restore (the icon follows the resize event), and close work;
  - `menu.new`, `path.resolve_directory` and `window.unminimize` are refused.
- **Overlap with E17:** E17 lets the curator promote playbook lessons into role files. It should not promote the lessons that group B replaces (see "Playbook overlap"); retire them instead.

## Decisions (2026-10-15)

| Item | Decision | Why |
| - | - | - |
| Wave 1 | Accepted. It is implemented in two groups so that E16 stays measurable. | E16 (the test author on Opus) is open and judges fix rounds that come from gaps in the locked tests, which are kinds K2 and K3. |
| Group A, merge at once | L2 (with the 6 call sites migrated), L4, D1 (`flat/recommended` only), C1–C3, R2, R3, S1 with its guard test | None of these targets K2, K3 or K4, so E16's numbers are not affected. |
| Group B, merge when E16 is judged | L1, L3, F1–F3, M1–M2, T1–T3, R1. E18 starts at that merge. Its baseline is E16's result if E16 is kept, otherwise 0.44 and 0.31. | These target the same kinds as E16. |
| D1 | Adopt `@tanstack/eslint-plugin-query` 5.104.3 with `flat/recommended` (0 violations). `prefer-query-options` is deferred: it becomes one dedicated item when `src/ipc/hooks/` is quiet (end of M3). | The recommended set catches query keys that miss a variable, at no migration cost. Rewriting 29 sites in 13 files now would collide with running autopilot items. |
| S1 | Replace `core:default` with `core:event:default`, `core:window:default` and the 4 window actions. A Rust guard test `src-tauri/tests/it/tauri_security.rs` fails on `core:default`, on a permission outside the allowlist, and on `'unsafe-inline'`, `'unsafe-eval'` or a remote host in the release CSP. Check the title bar in the real app with `/app`: drag, minimize, maximize and restore, the maximized state, close. | Least privilege. The UI uses only `invoke`, `Channel`, `listen` and the current window. |
| D2 | Yes, as one autopilot item after E18 starts. It covers `review_reorder_steps`, `review_ask`, `review_decide` and `review_plan` first. | K1 recurs (6 lessons), and a fake needs contract tests. |
| D3 | A separate experiment after E18 is judged. | It changes the autopilot reviewer and gate, and it would confound E18. |
| D4 | Not now. Revisit it if file-length nits continue during E18. | Nits only, no fix rounds. |
| S2 | Part of the M10 tray-window work: `AppManifest::commands` and one capability per window. | Today there is one window. |
| S4 | An ADR decision at M11 (hardening). | It is not driven by our errors. |
| Playbook | The curator retires the entries listed under "Playbook overlap" after group B merges. | Group B is what replaces them. |
| E18 row | Added to `IMPROVEMENTS.md` when group B merges. | The autopilot session is changing that file now. |

## Streszczenie dla właściciela

- **Po co:** w M3 recenzent autopilota znajduje średnio 0,44 poważnej lub zwykłej uwagi na kryterium, a 0,31 kryterium wymaga rundy poprawek. Prawie wszystkie te uwagi należą do trzech rodzajów błędów: testy nie przechodzą przez kod produkcyjny, ekran nie obsługuje jakiegoś stanu (ładowanie, błąd, inne źródło sesji niż MR) i dane liczone z surowego wyniku Claude zamiast ze sprawdzonego planu.
- **Najpierw (fala 1, bez nowych zależności):** siedem reguł lintera (L1–L4 w eslint, C1–C3 w clippy). Nie kosztują kontekstu, a bramka autopilota je egzekwuje. Do tego 9 krótkich linijek reguł tekstowych tam, gdzie lintera nie da się użyć. Dwa nowe pliki (`mock.md`, `tests.md`) ładują się tylko przy pracy na mocku i testach.
- **Decyzje (właściciel przekazał je 2026-10-15):** fala 1 przyjęta. Reguły, które nie dotyczą tego, co mierzy E16 (grupa A), wchodzą od razu. Reguły dla tych samych rodzajów błędów co E16 (grupa B) wchodzą po jego ocenie i wtedy startuje E18. Wtyczka TanStack wchodzi w zestawie `recommended`. Uprawnienia okna Tauri zostają zawężone, a pilnuje ich nowy test. Szczegóły są w tabeli „Decisions” wyżej.

## Method

- **Our errors:** `docs/process/playbook.json` (50 entries, P-001…P-052; P-018 and P-028 are gone), the reviewer verdicts of all 16 M3 criteria plus 2 retries (`.autopilot/items/*/review.json` and `attempt-1/review.json` in the main checkout), `.metrics/items.jsonl`, and the fix commits on `m3-plan-focus` since `e4a972c`.
- **Filter:** a rule is proposed only for an error kind we actually had, and only if it is not already in `CLAUDE.md`, `.claude/rules/*.md`, `eslint.config.js` (`strictTypeChecked`, react-hooks `recommended-latest`) or `[lints]` in `Cargo.toml`. General advice the model already follows is left out.
- **Trial runs (scratch only):** ESLint with the candidate core rules over `src` and `tests`. `@tanstack/eslint-plugin-query` installed with `--ignore-scripts` in the scratch folder and run through a temporary config. The clippy candidates were counted with `grep`, not compiled.

### Versions (resolved from `package-lock.json` and `Cargo.lock`)

| Area | Versions |
| - | - |
| UI | React 19.3.0, TypeScript 6.0.3, Vite 8.3.4, @tanstack/react-query 5.104.1, @tanstack/react-virtual 3.14.15, zustand 5.0.15, react-router 8.4.0, @tauri-apps/api 2.12.3, shiki 4.5.0, @dnd-kit/core 6.3.1 |
| Lint and tests | ESLint 10.12.0, typescript-eslint 8.71.1, eslint-plugin-react-hooks 7.1.1, Prettier 3.9.10, Vitest 5.0.3, jsdom 29.1.1, @testing-library/react 16.3.3, @testing-library/user-event 14.6.7, @playwright/test 1.64.0 |
| Rust | rustc / clippy 1.99.0 (edition 2024, MSRV 1.95), tauri 2.12.3, tauri-build 2.7.2, tauri-plugin-dialog 2.8.2, tokio 1.53.2, thiserror 2.0.21, tracing 0.1.44, tracing-subscriber 0.3.23, ts-rs 12.0.1, rusqlite 0.40.2, reqwest 0.13.5, keyring 4.2.0, serde 1.0.229 |

## Our error kinds

Baseline for the metrics: the 16 criteria in `.metrics/items.jsonl` up to run `ap-20261015-0623`. Severe + normal findings: 7 (0.44 per criterion). Fix rounds: 5 (0.31 per criterion).

| Kind | Playbook | Reviewer findings (severe / normal / nit) | Fix rounds | Examples |
| - | - | - | - | - |
| **K1** The mock drifts from the core | P-001, P-012, P-013, P-034, P-038, P-042 | 0 / 0 / 3 | 0 | The mock answered a fallback drag with "plan isn't ready" where the core returns `INVALID_INPUT` (the only red test of F-06.5). The mock decided self-review two ways (`plan.ts`). A mock test asserted static fixture data and a rule that M3 decision 6 rejected. Mock-alignment commits: 4700e72, 9f84351, 5c8cf1b. |
| **K2** Tests miss the production path, or their assertions cannot fail | P-005, P-020, P-030, P-035, P-037, P-040, P-048, P-049, P-050 | 0 / 3 / 4 | 3 (F-04.1, F-09.4, F-10.1) | Test seeds wrote `plans.plan_json`, which production never writes. The undo test checked only the table row. e2e checks of the landmark and route passed on an empty `StubScreen`. A fallback test returned an empty list instead of an error. `assert!(!cx.fallback)` can never fail. |
| **K3** A variant or async state is not handled (source kind, loading or error, restored, disabled query) | P-039, P-041, P-043, P-044, P-045, P-046, P-047 | 1 / 2 / 2 | 2 (F-17.1, F-17.4) | A non-MR session rendered a stub. `Claims.tsx` always said "MR description vs code". `usePlan(id, false)` never loads after a restart. `data === null` was used to decide self-review while the query was still loading. |
| **K4** A view is derived from raw data, not the validated type | P-004, P-009 | 1 / 0 / 1 | (with F-04.1) | The card step count came from Claude's raw cached `structured_output`, not the plan after `coverage::enforce`. |
| **K5** Logging: Claude text in logs, and a global logger in tests | P-051, P-052 | 1 / 0 / 1 (run ap-20261015-1102) | 1 | `set_global_default` in a 3-test binary failed 6 of 7 runs. `log_failure` wrote Claude's stderr into the log, against NFR-08. |
| **K6** Timing in e2e | P-014, P-036 | 0 / 0 / 1 | 0 | A dnd-kit drag was flaky 1 in 3 (446316f). F-05.6 was flaky under load (888edeb) and waits a fixed 2 s. There are 6 `page.waitForTimeout` calls today. |
| **K7** Repeated hygiene nits | P-031 | 0 / 0 / 4 | 0 | Rust files over ~400 lines (F-04.1, F-09.4, F-17.1). An old `pub` function was left beside its replacement. |

The 7 severe + normal findings in the baseline split as K2 3, K3 3, K4 1. K1, K6 and K7 cost review attention and red tests, but no fix rounds yet.

## Proposed rules

Enforcement legend: **lint** = a rule in ESLint or clippy, checked by verify and the gate, with no context cost. **text** = one line in `.claude/rules/`, loaded only when a file under its `paths:` is read. **dep** = needs a new dependency or tool, which is the owner's decision.

### Wave 1: lint, no new dependency

| # | Rule | Source (version) | Kind | Enforcement | Cost |
| - | - | - | - | - | - |
| L1 | `@typescript-eslint/switch-exhaustiveness-check` with `considerDefaultExhaustiveForUnions: false` and `allowDefaultCaseForExhaustiveSwitch: false`. Every switch over a union lists each member and has no `default`, so a new source kind or `ErrorCode` fails lint at every switch that misses it. Not part of `strictTypeChecked`. | [typescript-eslint › switch-exhaustiveness-check](https://typescript-eslint.io/rules/switch-exhaustiveness-check/) (8.71.1) | K3 (P-041, F-17.1) | lint, `**/*.{ts,tsx}` | 0 lines, 0 deps. Trial run: 0 violations |
| L2 | `no-restricted-properties` `{ object: 'page', property: 'waitForTimeout' }` in `tests/e2e/**`. The message says: wait for a state (a web-first assertion, `expect.poll` on the mock's storage, or `page.clock`). | [Playwright › Best practices](https://playwright.dev/docs/best-practices) and [Clock](https://playwright.dev/docs/clock) (1.64); [Checkly: never use waitForTimeout](https://www.checklyhq.com/blog/never-use-page-waitfortimeout/); [ESLint › no-restricted-properties](https://eslint.org/docs/latest/rules/no-restricted-properties) (10.12) | K6 | lint | 0 lines. 6 call sites to migrate: `restartApp` in `stepHelpers.ts` (polls the saved state, which fixes 4 sites) and F-05.6 (`page.clock`) |
| L3 | `no-restricted-syntax` on `CallExpression[callee.property.name='toHaveURL']` in `tests/e2e/**`. The message says: `createMemoryRouter` keeps the URL at the origin, so assert the screen content. | [React Router › createMemoryRouter](https://reactrouter.com/api/data-routers/createMemoryRouter) (8.4.0: an in-memory history stack); [Playwright › test user-visible behavior](https://playwright.dev/docs/best-practices) | K2 (P-040, P-050; the F-17.1 normal finding) | lint | 0 lines. 0 violations today |
| L4 | `npm run lint` = `eslint . --max-warnings 0`. react-hooks 7.1.1 ships `exhaustive-deps`, `incompatible-library` and `unsupported-syntax` as warnings, and the gate never sees warnings. | [ESLint CLI › --max-warnings](https://eslint.org/docs/latest/use/command-line-interface#--max-warnings) (10.12) | K3 (preventive) | lint | `package.json` script only. 0 warnings today |
| C1 | `clippy.toml` `disallowed-methods`: `tracing::subscriber::set_global_default`, `tracing::dispatcher::set_global_default`, `tracing_subscriber::util::SubscriberInitExt::init`, `…::try_init`. The `reason` says: "global logger only at startup (`logging/mod.rs`) or in a `tests/*.rs` binary with one test; elsewhere use `tracing::subscriber::set_default` (a thread-local guard) and match the line by a unique key". | [Clippy › disallowed-methods](https://doc.rust-lang.org/clippy/lint_configuration.html#disallowed-methods) (clippy 1.99); [tracing › set_default](https://docs.rs/tracing/0.1.44/tracing/subscriber/fn.set_default.html), [dispatcher: global vs scoped](https://docs.rs/tracing/0.1.44/tracing/dispatcher/index.html) (0.1.44) | K5 (P-051; the F-17.1 severe finding) | lint. The `reason` text is the how-to, so no rules line is needed | 0 lines. 4 sites get `#[expect(clippy::disallowed_methods, reason = …)]`: `logging/mod.rs:153` and 3 one-test binaries. `allow-invalid = false` makes a wrong path fail loudly |
| C2 | `disallowed-methods`: `std::process::Command::new` and `tokio::process::Command::new`, with the reason "child processes only through `os/process.rs` (`CREATE_NO_WINDOW`, Job Object, timeouts)". | same Clippy page | none in M3; it guards a non-negotiable | lint | **Saves** context: the text half of `rust.md` line 11 can shrink. Sites: `os/process.rs` plus 4 test files (`#[expect]` with a reason) |
| C3 | `[lints.clippy] allow_attributes_without_reason = "deny"`. Every exception, including the new ones from C1 and C2, says why. | [Clippy › allow_attributes_without_reason](https://rust-lang.github.io/rust-clippy/master/index.html#allow_attributes_without_reason) (restriction group; reasons are stable since Rust 1.81) | K5, K7 | lint | 0 lines. All 49 current `allow` attributes already carry a reason |

### Wave 1: text rules (where no lint can see it)

Exact wording to add. 9 new lines, 1 edited, 1 shortened.

| # | File | Line | Source (version) | Kind |
| - | - | - | - | - |
| F1 | `frontend.md` | A screen that picks its view, copy or buttons from a query handles `isPending` and `isError` first; `data === undefined` means "not loaded yet", never "no MR" or `false`. | [TanStack › Disabling queries](https://tanstack.com/query/v5/docs/framework/react/guides/disabling-queries) (5.104); [TkDodo › Status checks](https://tkdodo.eu/blog/status-checks-in-react-query) | K3 (P-044, P-047; nits on `useSelfReview.ts:10` and `SummaryScreen.tsx:12`) |
| F2 | `frontend.md` | A query with `enabled: false` stays pending with no data; a screen restored on start reads stored state through `useResume` or an enabled query. | TanStack › Disabling queries: "pending" with `fetchStatus: 'idle'` and no data (5.104) | K3 (P-046; the F-17.4 normal finding) |
| F3 | `frontend.md` | Copy and behaviour that depend on the session source come from an exhaustive `switch` on the source kind (no `default`, L1 checks it), never from `data === null` or an id prefix. | typescript-eslint (L1) | K3 (P-041, P-042; F-17.1) |
| M1 | new `mock.md` (`paths: src/ipc/mock/**`) | Each mock command keeps its core command's guard order and `ErrorCode`, and derives flags from the field the core reads (source kind, `headSha`), never from id prefixes or design-mock notes. | [Software Engineering at Google, ch. 13 › Fakes](https://abseil.io/resources/swe-book/html/ch13.html): "a fake should maintain fidelity to the API contracts of the real implementation" | K1 (P-001, P-013, P-042) |
| M2 | `mock.md` | A mock test named with an AC calls a mock command and asserts its result or error, never static fixture data. | same chapter: a fake "must have its own tests" against the real API | K1, K2 (P-034, P-049) |
| T1 | new `tests.md` (`paths: src-tauri/tests/**`, `src-tauri/src/**/*_tests.rs`, `src/**/*.test.{ts,tsx}`, `tests/e2e/**`) | Before committing an assertion, name the production change that would make it fail. Seed through the production write path and read through the production read path; an error branch gets an injected error, not an empty result. | SWE at Google ch. 13: "we prefer realistic tests"; [cargo-mutants](https://mutants.rs/in-diff.html) (a surviving mutant marks a test that cannot fail) | K2 (P-005, P-020, P-035, P-048, P-049; F-04.1, F-06.9, F-09.5) |
| T2 | `tests.md` | For a state change (dismiss, undo, reorder, restore), assert what the screen or a reload shows in each state, not only the stored row. | same | K2, K3 (P-030, P-045; the F-09.4 and F-17.4 normal findings) |
| T3 | `tests.md` | Screen and e2e tests assert the content the criterion names (a button, the plan rows); the landmark name and the route also pass on an empty stub. | Playwright › test user-visible behavior (1.64) | K2 (P-040, P-050; F-17.1) |
| R1 | `rust.md` | Screens and counts read Claude results only as the validated type (after `coverage::enforce`); never deserialize raw cached Claude JSON outside the validator, and keep the validated type's constructor private to it. | [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) (a parser returns a type that "preserves the knowledge gained") | K4 (P-004; the F-04.1 severe finding) |
| R2 | `rust.md` line 13, edited | "…redact tokens… and never log file contents, prompts or Claude output (stderr, `result`); for Claude error codes log only `code` and message (NFR-08)." | [OWASP Logging Cheat Sheet › Data to exclude](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | K5 (P-052) |
| R3 | `rust.md` line 11, shortened after C2 | "Child processes only through `os/process.rs` (clippy enforces)." | C2 | none |

### Wave 2: new dependency, own check or tool (owner's decision)

| # | Rule | Source (version) | Kind | Enforcement | Cost |
| - | - | - | - | - | - |
| D1 | `@tanstack/eslint-plugin-query` with `flat/recommended` plus `prefer-query-options`. The key and `queryFn` of a query live in one `queryOptions()` factory, and every hook and cache call reuses it. | [TanStack › ESLint plugin](https://tanstack.com/query/v5/docs/eslint/eslint-plugin-query), [prefer-query-options](https://tanstack.com/query/v5/docs/eslint/prefer-query-options), [queryOptions](https://tanstack.com/query/v5/docs/framework/react/guides/query-options) (plugin 5.104.3; peer ESLint ^10) | K3 (P-043) | dep + lint | 1 devDependency; its only dependency, `@typescript-eslint/utils` ^8.71, is already in the tree. Trial run: `recommended` 0 violations; `prefer-query-options` 29 sites in 13 files under `src/ipc/hooks/`, a mechanical migration next to the existing `xxxKey()` helpers |
| D2 | Contract cases for mock vs core: one JSON table per IPC command (state, input → result or `ErrorCode`), read by a Rust integration test and by a Vitest test. M1 then adds "a new guard gets a contract case". | SWE at Google ch. 13: contract tests run "against both the real implementation and the fake" | K1 | own test harness, no dependency | about one autopilot item; start with the commands that already drifted (`review_reorder_steps`, `review_ask`, `review_decide`, `review_plan`) |
| D3 | `cargo-mutants --in-diff` as reviewer evidence: a mutant that survives in changed code marks an assertion that cannot fail. | [mutants.rs › in-diff](https://mutants.rs/in-diff.html) (cargo-mutants 27.1.0) | K2 | tool (`cargo install`, not in `Cargo.toml`) | Each mutant costs a build plus tests (`rust:test` median 57 s), so it needs `--file` or `--timeout` caps. It belongs to the autopilot reviewer and gate, which another session is changing, so it should be a separate experiment after E18 |
| D4 | File length: ESLint `max-lines` 400 (`skipBlankLines`, `skipComments`; ignore `src/ipc/mock/fixtures/**`). For Rust, a node test in `tools/` that fails when a `.rs` file over 400 lines grows, or a new one passes 400 (a ratchet; 14 files are over today). | [ESLint › max-lines](https://eslint.org/docs/latest/rules/max-lines) | K7 (3 nits, all in Rust) | lint + own check | low priority; TS trial run: 1 offender (a fixture) |

### Tauri 2 security vs `docs/06-security.md`

| # | Finding | Source (Tauri 2.12.3, tauri-build 2.7.2) | Proposal | Decision |
| - | - | - | - | - |
| S1 | `capabilities/default.json` grants `core:default`, which includes the default sets of `app`, `event`, `image` (create an image from a file path), `menu`, `path`, `resources`, `tray`, `webview` and `window`. The UI uses only `invoke` and `Channel`, `listen` and the current window (`src/ipc/tauri.ts`, `tauri-window.ts`). 06 says "capabilities limited per window". | [Core permissions](https://v2.tauri.app/reference/acl/core-permissions/), [Capabilities](https://v2.tauri.app/security/capabilities/) | Replace it with `core:event:default`, `core:window:default` and the 4 window actions; check in the real app (`/app`). Add a guard test (as for ADR-025) that fails on `core:default`, on a permission outside an allowlist, or on `'unsafe-inline'`, `'unsafe-eval'` or a remote host in the release CSP. | owner (security config) |
| S2 | Tauri allows **every registered app command in every window** unless `build.rs` uses `AppManifest::commands`. With one window that is fine today. 06 wants "tray window: tray commands only", and that cannot hold without it. | [Capabilities › app commands](https://v2.tauri.app/security/capabilities/) | Add it to the M10 plan (tray window): `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&[…])))` and one capability per window. | owner (roadmap note) |
| S3 | CSP, `freezePrototype` and devtools match the Tauri guidance: no remote content, no `'unsafe-*'` in release, no `'wasm-unsafe-eval'` (ADR-023). Devtools are off in release because the `devtools` Cargo feature is not enabled. | [CSP](https://v2.tauri.app/security/csp/), [Debug](https://v2.tauri.app/develop/debug/) | No change; the S1 guard test keeps it this way. | none |
| S4 | 06 does not mention the Isolation pattern, which Tauri "highly recommends … whenever it can be used". Costs: AES-GCM on every IPC message, and on Windows the isolation app must use inline scripts. Not driven by our errors. | [Isolation pattern](https://v2.tauri.app/concept/inter-process-communication/isolation/) | Decide at M11 (hardening), as an ADR. | owner (ADR) |

### Considered and dropped

- **eslint-plugin-playwright 2.12.1:** missing awaits are already caught by `no-floating-promises` (in `strictTypeChecked`), and L2 covers `waitForTimeout` without a dependency.
- **Banning direct `userEvent.click` (P-036):** user-event recommends `userEvent.setup()` ([intro](https://testing-library.com/docs/user-event/intro), 14.6), but there are 148 direct calls and only one incident. The lesson stays in the playbook.
- **`strict-boolean-expressions`:** noisy, and our tri-state bugs were explicit comparisons (`=== null`), which F1 covers.
- **clippy `indexing_slicing`, `print_stdout`, `let_underscore_must_use`, `allow_attributes`:** no incident in M3; `allow_attributes` would mean 49 mechanical edits.
- **A newtype for Claude text** (redacting `Debug`, no `Display`, like `os/credentials.rs::Token`; the pattern of [secrecy 0.10.3](https://docs.rs/secrecy/0.10.3/secrecy/)): sound, but it is a code change, not a rule. It is a candidate item if R2 is not enough.
- **Stryker (TS mutation testing):** heavier than D3; revisit after D3.

## Playbook overlap and context cost

- **Retire what a rule replaces.** AUTOPILOT.md says a lesson becomes a rule after it recurs 3×. K1 to K3 recur 6, 9 and 7 times; K4 and K5 are kept because each produced a severe finding. When a rule lands, the curator should retire the entries it covers so the roles do not pay twice inside the 1.5k-token playbook budget: P-013 and P-042 (M1); P-034 and P-049 (M2, T1); P-005, P-020 and P-035 (T1); P-030 and P-045 (T2); P-040 and P-050 (L3, T3); P-044, P-046 and P-047 (F1, F2); P-041 (F3); P-051 (C1); P-052 (R2); P-004 (R1); P-014 (L2).
- **Context:** +3 lines in `frontend.md`; +2 lines in the new `mock.md` (loaded only for `src/ipc/mock/**`); +3 lines in the new `tests.md`; +1 line, 1 edited and 1 shortened in `rust.md`. In total about +9 lines, roughly 450 tokens, and only when matching files are read. Lints cost no context.

## Experiment proposal for `IMPROVEMENTS.md`

| ID | Date | Change | Metric (baseline → target) | Status |
| - | - | - | - | - |
| E18 | (on approval) | Coding rules wave 1: lints L1–L4 and C1–C3; text rules F1–F3, M1–M2, T1–T3, R1–R3; retire the playbook entries listed above (`docs/process/CODING-RULES-PROPOSAL.md`) | Severe + normal reviewer findings per criterion: 0.44 (7 of 16 criteria up to `ap-20261015-0623`) → ≤ 0.25. Fix rounds per criterion: 0.31 (5 of 16) → ≤ 0.15. Both over the next 16 criteria. Guards: tokens per AC not more than +10%; verify wall time not more than +5 s. Secondary: K2 to K5 findings, 7 → ≤ 2. | planned |

**Order:** E16 (the test author on Opus) is open and measures fix rounds over the next 8 items. The four fix rounds it targets are K2 and K3, the same kinds as E18. Running both together would make neither result readable. **Recommendation:** judge E16 first, then start E18. If E16 is kept, E18's baseline becomes E16's result instead of 0.44 and 0.31. With 16 criteria and 7 findings the noise is large: ≤ 0.25 means at most 4 severe or normal findings in 16 criteria.
