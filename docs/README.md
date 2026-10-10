# Guided Review · specification

| File | What it answers |
| - | - |
| `01-product.md` | What the app does: principles, glossary, features `F-01…F-30` with acceptance criteria `F-xx.n`, non-functional requirements `NFR-01…08`. **The contract.** |
| `02-screens.md` | Every screen `S-01…S-13`: mock, screenshots, regions, states the mocks don't show, data needed, features covered. |
| `03-design-system.md` | Tokens (paste-ready CSS), color meaning, typography, components, icons, motion, copy style. |
| `04-architecture.md` | Stack, repository layout, IPC contract, data model, SQLite schema, background work, Windows process rules. |
| `05-integrations.md` | git commands, GitLab endpoints, Claude Code invocation profiles and tasks, code index, Rider, Windows APIs. |
| `06-security.md` | Threats and mitigations. |
| `07-roadmap.md` | Milestones M0–M11, each a usable increment, with the features it delivers. |
| `08-decisions.md` | Decisions already made (ADRs) and the spike table for M0. |
| `09-testing.md` | Test layers, naming with AC IDs, fixtures, fake `claude`, manual checklist. |
| `PROGRESS.md` | Every acceptance criterion by milestone, ticked with commit SHAs, plus the session log. |
| `claude/` | Prompts and JSON Schemas for the Claude tasks inside the app. |
| `design/` | Interactive mocks (`mocks/`), rendered screenshots (`screens/`), how to render states. |

## Reading order for a new session
`PROGRESS.md` → the current milestone in `07-roadmap.md` → its features in `01-product.md` → its screens in `02-screens.md` + PNGs → the technical files you need.

## IDs
- `F-xx` feature, `F-xx.n` acceptance criterion, `NFR-xx` non-functional requirement, `S-xx` screen, `M-x` milestone, `ADR-xxx` decision, `S1…S9` spikes, `T1…T10` threats.
- Tests, commits and PROGRESS refer to these IDs. `node tools/audit.mjs` checks the links.

## Changing the spec
Change the docs first (and the mock if the look changes), then the code. Never let the code silently disagree with the docs. New acceptance criteria get the next free number; don't renumber existing ones.

## Language
The app UI is English; these docs are English so they can quote UI strings verbatim. The two documentation boards (`design/mocks/Flow.dc.html`, `Architecture.dc.html`) are Polish; `START-HERE.md` in the repository root is the human-facing setup guide.
