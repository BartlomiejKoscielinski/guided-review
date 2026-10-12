# M0 spikes S5, S6, S7, S9 · development PC (session 3)

Notes behind the S5, S6, S7 and S9 rows of the spike table in `08-decisions.md`. Field visit 1 (`field/RUNBOOK-1.md`, `gr-probe`) repeats S1–S6 and the S9 paths on the company laptop.

- **Where:** development PC, Windows 11 Pro 25H2 (build 26200), one 5120×1440 monitor at 100 %, taskbar at the bottom.
- **Date:** 2026-10-11. **Versions:** Tauri 2.12.3, reqwest 0.13.5 (rustls 0.23.45 + rustls-platform-verifier 0.7.1, native-tls 0.2.18 for the comparison), tauri-plugin-deep-link 2.6.1, tauri-plugin-single-instance 2.5.3, tauri-plugin-notification 2.6.0, tauri-plugin-positioner 2.4.0, tauri-winrt-notification 0.8.1, windows 0.62.2, Rider 2026.2.3.1 (build 262.10968.170), Claude Code 2.1.296.
- **Tools:** `gr-probe` (`src-tauri/src/bin/gr-probe/`), `examples/s6_tls_server.rs`, the throwaway Tauri app `tools/spikes/tauri-s7/`.

## S6 · TLS with the Windows certificate store

A fresh test CA ("Guided Review Test CA 6acb9580", private key only in the server process), four HTTPS servers on `127.0.0.1` (valid for `localhost`/`127.0.0.1`, expired in 2021, valid only for `wrong.example`, valid with an unreachable CRL distribution point), `gr-probe tls` with both backends. The user imported the CA into `CurrentUser\Root` with `certutil -user -addstore Root` and removed it afterwards.

| Server certificate | CA not trusted | CA in `CurrentUser\Root`: rustls + platform verifier | CA in `CurrentUser\Root`: SChannel (native-tls) |
| - | - | - | - |
| valid | both `tls:unknown_issuer` | **200**, ~50 ms per new connection | 200, ~6 ms |
| expired | both `tls:unknown_issuer` | `tls:expired` | `tls:expired` |
| wrong name | both `tls:unknown_issuer` | `tls:name_mismatch` | `tls:name_mismatch` |
| CRL distribution point unreachable | both `tls:unknown_issuer` | **200 after ~2.1 s** on every new connection (no caching across processes) | 200, ~7 ms |

- **Decision: the app uses reqwest's default TLS** (rustls with `rustls-platform-verifier`): it trusts a CA from the Windows store with no configuration, and its errors are classified (`gitlab/tls.rs`). native-tls stays only in `gr-probe` (feature `field-probe`) for the comparison at field visit 1.
- Windows behaviour of the platform verifier (source, 0.7.1): Windows builds the chain from the system stores incl. enterprise and user roots; revocation is checked for the end certificate only; an unknown or offline revocation status is ignored (`CERT_CHAIN_POLICY_IGNORE_ALL_REV_UNKNOWN_FLAGS`), so an unreachable CRL never blocks, but it costs ~2 s per new TLS connection. reqwest keeps connections alive, so this hits only the first request of a burst. If the on-prem certificate has an unreachable CDP, field visit 1 shows it as `platform.handshake` ms ≫ `schannel.handshake` ms.
- Error chain detail: tokio-rustls wraps `rustls::Error` in an `io::Error` whose `source()` skips it (`get_ref()` needed); native-tls hides the Windows code entirely except in its text `(os error -2146762487)`.
- `localhost` costs ~300 ms more than `127.0.0.1` when the server listens on IPv4 only (`::1` is tried first).

## S7 · Tauri on Windows (rest of the spike; the title bar was done in session 2)

Spike app `tools/spikes/tauri-s7/` with the app identifier `com.inpost.guidedreview` and the scheme `guidedreview`; every event logged to `%TEMP%\gr-s7-spike.log`. Its HKCU keys and the Start-menu shortcut were removed afterwards.

**Deep link + single instance: works.**
- `register_all()` in a debug build writes `HKCU\Software\Classes\guidedreview` (`URL:com.inpost.guidedreview protocol`, command `"<exe>" "%1"`).
- Cold start from `guidedreview://mr/7?project=g%2Fp`: the URL is in `argv` and in `get_current()`.
- Warm start: the second process forwards in ~28 ms; the running instance gets `on_open_url` (parsed `Url`) and the single-instance callback with the full `argv`. CLI arguments with spaces and Polish characters (`review --repo "C:\Repos\Zażółć gęślą\app" --branch feature/x`) arrive intact.
- `Windows.System.Launcher.LaunchUriAsync` (what the shell does) reaches the running instance the same way.

**Toasts: shown, but the button → deep link path does not work as ADR-017 assumes.**
- `tauri-plugin-notification` in a dev build: shown under "Windows PowerShell" (its AUMID), no action buttons (the plugin's actions are mobile only).
- Toast XML through the `windows` crate or `tauri-winrt-notification` with the AUMID `com.inpost.guidedreview`:
  - not registered: `CreateToastNotifierWithId` fails (`0x8000FFFF`);
  - registered under `HKCU\Software\Classes\AppUserModelId\com.inpost.guidedreview` (DisplayName, IconUri): shown with both buttons, the header shows the raw AUMID;
  - plus a Start-menu shortcut carrying `System.AppUserModel.ID` (what the installer creates): header shows the shortcut's name and icon.
- **Any WinRT toast call made inside the single-instance callback fails with `0x8000FFFF`** (it runs in the window procedure handling `WM_COPYDATA`); the same call from another thread works. Rule for M10: never call WinRT from that callback; hand off to a thread/task.
- **Clicking a button with `activationType="protocol"`:** with the registry-only AUMID and with the shortcut, synthetic clicks (SetCursorPos/mouse_event, verified on screen) dismissed the toast without launching anything; one real click by the user (shortcut variant) launched the shortcut's exe **without the URI** (`argv` = exe only). So the URI of a protocol button is lost for an unpackaged app. Options for M10 (decision needed, would supersede ADR-017): handle activation in-process (`ToastNotification.Activated`, works while the app runs in the tray, which is when toasts are produced), a COM activator (`ToastActivatorCLSID` on the shortcut, `INotificationActivationCallback`), or the Windows App SDK `AppNotificationManager` for unpackaged apps. To be re-checked in an M10 spike with real clicks.

**Tray: works, positioning needs our own code.**
- New tray icons sit in the overflow flyout (`^`) on Windows 11 by default; the click `rect` is the icon inside the flyout (here 40×40 at 4827,1295).
- `tauri-plugin-positioner` `TrayBottomCenter` put the window's top at the icon's top (macOS menu-bar semantics): with the bottom taskbar the 410×520 window (outer 426×529) runs below the work area (bottom 1392). M10 places the window **above** the icon rect and clamps it to the monitor's work area (pure function with tests for all four taskbar edges; Windows 11 only has the bottom edge, Windows 10 22H2 has all four).
- Hiding on focus loss (`WindowEvent::Focused(false)`) works.
- Not checked: second monitor, other DPI (no second monitor; scale not changed), Windows 10 taskbar edges. They stay in the `09` manual checklist (F-30.1, F-28.1) and field visit 5.

## S9 · Rider

- **Install on this PC:** standalone, `C:\Program Files\JetBrains\JetBrains Rider 2026.2.3.1\bin\rider64.exe`; no Toolbox. `product-info.json` next to `bin\` gives `version` 2026.2.3.1, `buildNumber` 262.10968.170 and `dataDirectoryName` **Rider2026.2** = the config folder `%APPDATA%\JetBrains\Rider2026.2` (created on first start; logs in `%LOCALAPPDATA%\JetBrains\Rider2026.2\log`). Registry: `HKLM\SOFTWARE\JetBrains\JetBrains Rider\<build>` (default value = install folder, `AssociationKey` = Rider2026.2) and an Uninstall entry with `InstallLocation`; **no App Paths entry** (05's last fallback finds nothing). Discovery: `os/rider.rs` (Settings → Toolbox `rider.cmd` resolved → `%LOCALAPPDATA%\Programs\Rider*` → Toolbox apps → Program Files, newest first).
- **Open at line:** `rider64.exe --line 5 --column 16 "<…\gr-s9 zażółć\src\Sample Zażółć.cs>"` run by the user opened the file in the running Rider with the caret at **5:17**: `--line` is 1-based, **`--column` is 0-based**. A file outside a project opens with its folder as a project (`.idea` is created there).
- Launched from this session's sandboxed shell, the forwarding to the running Rider hung for 30 s and the launcher showed "Start Failed: CannotActivateException … did not respond" (the instance communicates through its system folder); from the user's own terminal it works. The app must handle a launcher that neither forwards nor exits (timeout, `spawn_detached`, no wait).
- **External Tools:** the config folder has no `tools\` until a tool exists. A tool set "Guided Review" in IntelliJ's format was written to `tools\Guided Review.xml` (one file per tool group, as IntelliJ stores them) with two tools that append `$ProjectFileDir$`, `$FilePath$`, `$LineNumber$`, `$ColumnNumber$`, `$SelectedText$` and `$ClipboardContent$` to `%TEMP%\gr-s9-macros.txt`. **Verified 2026-10-12** (owner restarted Rider and ran both tools from Tools › External Tools › Guided Review, on the project `gr-s9 zażółć\src`):
  - Rider lists the "Guided Review" group after a restart; both tools run.
  - `$ProjectFileDir$` = the folder Rider opened (here `…\gr-s9 zażółć\src`, below the repo root), `$FilePath$` = the editor file, `$LineNumber$` 1-based, `$ColumnNumber$` **1-based** (the caret at the start of the selection on line 5 gave 16; `rider64.exe --column` is 0-based). Polish characters in paths arrive intact (the test's own log file was ANSI, which only garbled the display).
  - `$SelectedText$` = the editor selection (`LineFive => 5;`); empty when nothing is selected. External Tools have no VCS log placement, so it never holds a commit.
  - Copy Revision Number in the Git log, then "Review this commit": `$ClipboardContent$` = the 40-hex SHA. **Answer to R-12:** "Review this commit" uses `$ClipboardContent$`.
  - **The clipboard can hold anything:** the first run passed a GitLab token that was still on the clipboard (stand-in token; masked in the test file, rotation advised). The app must accept only a hex SHA for `--commit`, show nothing of a rejected value and never log it (T5). It also arrives on the command line, visible to the user's other processes.
  - `--repo "$ProjectFileDir$"` may point below the repository root; the CLI resolves the repository with git.

## S5 · GitLab API

Run on the stand-in (2026-10-12): GitLab EE **17.11.7-ee** (the on-prem version) in Docker, unlicensed (Free-tier features), `tools/standin/`, project `sandbox/gr-sandbox`, user `dev` (Developer) with a personal access token (`api`). `gr-probe tls`, `gitlab read` and `gitlab write` (all 20 writes confirmed); report `field/baseline/standin-keysets.{md,json}`, the baseline field visit 1 is compared with.

- **TLS:** the stand-in's test CA in `CurrentUser\Root` is trusted by the app's TLS (rustls-platform-verifier) and by SChannel, no configuration (as S6). git uses `http.sslBackend=schannel` here, so git over HTTPS trusts it too.
- **Token check:** `GET /personal_access_tokens/self` → 200 with `scopes`, `expires_at`, `active`, `revoked`, `last_used_at`.
- **Create MR:** `draft: true` is **ignored** (`draft` stays false); the `Draft:` title prefix works (`draft` true).
- **Draft notes:** positions on an added (`new_line`), a deleted (`old_line`) and a context line (both) are created (201) and kept after `bulk_publish` (204). A draft **without position becomes a general comment** in the same publish, so the F-12.4 summary works as `05` describes.
- **`bulk_publish` with `note` and `reviewer_state`:** 204, but the summary `note` is **not published** on 17.11.7 (newer than 17.11). Don't use it.
- **Approve:** with a stale `sha` → **409**; with the head SHA → 201 and the user is in `approved_by`; `unapprove` → 201. The MR author could approve their own MR (default settings here; on-prem may forbid it, a Premium setting).
- **`/approvals` on unlicensed EE:** `approved`, `approved_by`, `approvals_required`, `approvals_left`, `approval_rules_left`, `has_approval_rules`, `user_can_approve`, `user_has_approved`, `merge_request_approvers_available`, `multiple_approval_rules_available`, `require_password_to_approve`, `suggested_approvers`, `approvers`, `approver_groups`, `invalid_approvers_rules`.
- **MR list filters:** `reviewer_username`, `author_username`, `approved_by_usernames[]` (also `None`), `approver_ids[]`, `draft=no` → 200. **`scope=reviews_for_me` → 400** (newer than 17.11). **`not[approved_by_usernames][]=<me>` is ignored:** an MR the user had approved was still listed. So "have not approved" (F-02.1) needs the per-MR approvals fallback in `05`. Not proven yet: that `approved_by_usernames[]` narrows the list (needs an MR approved by someone else; check in M2 with `alice`/`bob`).
- **Pagination:** `x-next-page`, `x-page`, `x-per-page`, `x-prev-page`, `x-total`, `x-total-pages`, `link`.
- **MR pipeline:** `POST …/merge_requests/:iid/pipelines` → **200**; a manual job reads `created` right after, before it becomes `manual`, so poll instead of expecting `manual`. Play with `job_variables_attributes` → 200 (no runner needed), cancel → 201. The job object has **no description** and no default variables (F-20.6: description hidden, variables start empty).
- **Not measurable here:** one notification per publish (the stand-in sends no mail); stays a `[field]` check (F-12.5).
