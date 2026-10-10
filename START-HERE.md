# Start here

This package contains everything Claude Code needs to build Guided Review exactly as designed. This file is for you, the human. Claude Code reads `CLAUDE.md` and `docs/`.

## What's inside

- `CLAUDE.md`: standing instructions for Claude Code, loaded in every session.
- `docs/`: the specification.
  - `01-product.md`: 30 features and 183 acceptance criteria (175 `F-xx.n` + 8 NFR), each with an ID.
  - `02-screens.md`: screens.
  - `03-design-system.md`: tokens and components.
  - `04`–`06`: architecture, integrations and security.
  - `07-roadmap.md`: milestones M0–M11.
  - `08-decisions.md`: decisions made and spikes.
  - `09-testing.md`: testing.
  - `PROGRESS.md`: checklist of every criterion; it is the memory between sessions.
- `docs/design/`: 15 `.dc.html` mocks (exact styles) and 40 PNG screenshots in different states.
- `docs/claude/`: prompts and JSON schemas for the tasks the app gives Claude.
- `.claude/skills/`: the commands `/milestone`, `/design-check`, `/verify` and `/audit`.
- `.claude/rules/`: rules that load only when Claude works on frontend, Rust or Claude-integration files.
- `tools/`:
  - `render-mock.mjs` renders any mock in any state;
  - `audit.mjs` checks that every criterion has a test and is ticked.

## 1. Prepare your machine (Windows)

- Node.js LTS.
- Rust via `rustup` (MSVC toolchain) and Visual Studio Build Tools with "Desktop development with C++".
- WebView2. It is built into Windows 11.
- Git 2.40 or newer: `git --version`.
- Claude Code from the **native installer** (not the npm package), signed in. `claude auth status` must show that you are signed in.
- A GitLab token (personal access token, scope `api`). Needed from M2.
- From M9: the .NET SDK and `dotnet tool install --global csharp-ls`.

**Two machines** (ADR-019): development happens on a PC without VPN, with a personal Claude account, a stand-in GitLab on gitlab.com (a private sandbox project with synthetic code; its token is stored by you) and Rider installed as on the laptop. The company laptop (VPN, on-prem GitLab, Claude Enterprise, Rider, the MAUI solution) clones the repo for short **field visits** (`field/RUNBOOK-<n>.md` + `gr-probe.exe`); only a sanitized report comes back. No company code or data on the PC.

## 2. Create the repository

1. Create an empty project on GitLab, e.g. `guided-review`, and clone it.
2. Copy the whole package into it, including the hidden `.claude/` folder and `.gitignore`.
3. Commit as `docs: specification and design` and push.

## 3. First session: let Claude read before it writes

In the repository folder run `claude` and paste:

> Read CLAUDE.md, docs/README.md and every file in docs/. Look at the screenshots in docs/design/screens. Don't write code. Write to docs/questions.md: (1) anything unclear or contradictory between the documents and the mocks, (2) what is missing to start M0, (3) which items marked "verify" you will check first. Reference an ID for every point.

Answer the questions. If something needs to change, Claude updates the documents first and writes code only after that. This is the main rule that keeps anything from getting lost.

## 4. The loop for every milestone

| Step | What you do |
| - | - |
| 1 | `git switch -c m0-foundations` (name it after the milestone) |
| 2 | In Claude Code: `/milestone M0` |
| 3 | Claude reads the specification and presents a plan as a table: criterion ID → what it will build → how it will test it. **Check that the table contains every ID** in the M0 section of `PROGRESS.md`. Only then approve. |
| 4 | Claude builds in small commits (`M0: F-30.1 title bar`). Screens first on test data (mock backend), then the real connection. |
| 5 | `/design-check S-xx` for every screen touched. Claude takes a screenshot of its version and compares it with the mock's PNG. |
| 6 | `/verify` runs all tests and linters. |
| 7 | `/audit M0` shows criteria ticked without a test, tests without a tick, and gaps. |
| 8 | Review the changes and merge. From M5 on you can review this app with its own tool. |

Order: M0 → M1 → M2 → M3 → M4/M5 → M6 → M7 → M8 → M9 → M10 → M11. After M1 you already have a tool that's useful every day (reviewing local changes and committing). After M5 you have full MR review with publishing.

## 5. Rules that keep anything from getting lost

- **The specification is the source of truth.** A change in behavior starts in `docs/01-product.md`, a change in looks starts in the mock. Code comes last.
- **Everything has an ID.** Criteria, screens and decisions are numbered. Tests and commits carry the numbers too, so `/audit` finds every gap.
- **`PROGRESS.md` is the memory between sessions.** Every session ends by updating it, and every new session starts by reading it.
- **One session is one milestone or part of one.** Split large milestones when you approve the plan, e.g. "F-06 first, then F-07". M3 has 35 criteria, and M7 and M8 are big too. Use `/clear` between parts.
- **Decisions don't change silently.** If Claude wants to deviate from `08-decisions.md`, it has to explain why and add a new ADR after you agree.
- **Security isn't negotiable.** The "Non-negotiables" section in `CLAUDE.md` says, among other things, that Claude only reads teammates' code, never uses `--bare`, nothing reaches GitLab without a click, and the token lives in Windows Credential Manager.
- When planning large milestones, use the strongest model and higher effort (`/model`, `/effort`). Simpler parts can run on a faster model.

## 6. When something goes wrong

- **The UI doesn't match the mock:** run `/design-check S-05`, or point to a specific PNG and region.
- **Claude guesses an API** (Tauri, csharp-ls, GitLab): remind it of point 8 in "How to work" in `CLAUDE.md`. It must check the current documentation first.
- **A spike disproves an assumption** (e.g. `--restricted` doesn't work with the Enterprise account): the change goes into `05-integrations.md` and `08-decisions.md` first, then into the code.
- **The context is running out:** have Claude update `PROGRESS.md`. Then `/clear` and `/milestone Mx` again. The plan skips what is already ticked.
- **A Claude Code update changed how `claude -p` behaves:** the app runs a startup check, and the risk is described in ADR-002. Read the release notes first.
