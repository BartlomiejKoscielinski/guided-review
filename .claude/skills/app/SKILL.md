---
name: app
description: Start, click through, read and screenshot the real Guided Review desktop app (tauri dev, real Rust backend, stand-in GitLab) without the owner. Use whenever a change must be seen working in the real app, for real-app smoke checks, for checking a screen against the real backend, or when the user says /app.
---

The app's UI is a WebView2 page. `tools/app-driver/app.mjs` starts `tauri dev` with WebView2's DevTools port on `127.0.0.1:9222` and drives the page with Playwright over CDP. It builds into its own `src-tauri/target/app-driver/`, so `/verify` and `cargo test` can run while the app is open (the first `start` builds from scratch, which takes a few minutes). Don't ask the owner to click: do it with this tool. The command is pre-allowed in `.claude/settings.local.json`.

## Commands

```
node tools/app-driver/app.mjs start            # waits for the build and the window (first build takes minutes)
node tools/app-driver/app.mjs status | logs [n] | stop [--all]
node tools/app-driver/app.mjs snap [target]    # accessibility tree: read this first, it's cheap
node tools/app-driver/app.mjs click <target> [--shot .app-driver/x.png]
node tools/app-driver/app.mjs fill <target> <text> | press <key> | type <text> | hover | dblclick <target>
node tools/app-driver/app.mjs drag <source> <target>   # real mouse drag in small moves (drag-and-drop lists)
node tools/app-driver/app.mjs wait <target> [--state hidden] [--timeout ms] | text <target>
node tools/app-driver/app.mjs eval "<js expression>" | goto </path>
node tools/app-driver/app.mjs shot [out.png] [--target t] [--full]
node tools/app-driver/app.mjs run steps.json   # [["click","text=Start"],["wait","role=heading[name=/Plan/]"],["shot","a.png"]]
```

Targets are Playwright selectors. Prefer roles from `snap`: `role=button[name="Publish"]`, `role=tab[name=/^Mine/]`, `text=Cancel`, `role=region[name="Commits"] >> role=option >> nth=0`.

## How to work

1. `status`. If it is not reachable, run `start`. If `start` says an app without CDP is running (the owner's `tauri dev`, or one left over), run `stop --all` and then `start` again. It is the same dev build.
2. Understand the screen with `snap` (text) before you take screenshots. Open screenshots as crops (`shot --target <region>`), and keep them in `.app-driver/` (gitignored).
   Three or more steps in a row (click, wait, text, shot) go into one `run .app-driver/<check>.json`, not one call each: one connection, one tool call (E13).
3. `tauri dev` hot-reloads both the UI and the Rust code. After a Rust change, wait (`logs 5` shows `Running target\debug\GuidedReview.exe`), then reconnect. The webview reloads, so `snap` again.
4. Rust tracing and build errors appear in `logs`. UI errors: `eval "..."`, or check what is on screen.
5. When you finish, leave the app running if the owner may look at it. Otherwise `stop`.

## Rules

- This is the real backend. It uses the stand-in GitLab (`https://localhost:8443`, synthetic data), the fixture repos and real `claude`. Everything in CLAUDE.md › Non-negotiables still applies.
- Only click Publish / Approve / Resolve / Reply / Run pipeline / Play job in the stand-in sandbox, and only when the check needs it.
- Real Claude runs (plans, chat, fixes) spend the owner's tokens: use Sonnet 5.5 · low for them (memory "Live checks use Sonnet low"). Prefer fake-claude, or a check that doesn't need Claude.
- Native windows such as file pickers, Rider and the tray menu are outside the webview. The driver can't reach them; say so instead of guessing.
- Port 9222 lets any local process script the app while it runs. Use it only through this tool, on the development PC, with the dev build.
