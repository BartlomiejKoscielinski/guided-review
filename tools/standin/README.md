# Stand-in GitLab

GitLab EE **17.11.7-ee** (the on-prem version) in Docker on the development PC (ADR-019, `docs/09-testing.md` › Environments). Without a license it has the Free-tier features; tier and instance settings are compared with on-prem at field visits. Synthetic data only: fixture repos and test users, never company code.

- URL: `https://localhost:8443` (git over SSH: `localhost:2222`), reachable from this PC only.
- TLS: a test CA in `CurrentUser\Root`, like the internal CA on the laptop. Its private key is never stored, so it vouches only for the stand-in's own certificate.
- Data: Docker volumes `gr-standin_gitlab-config`, `…-logs`, `…-data`. RAM: about 3 GB idle (measured 2026-10-11), more under load.

## Setup (once)

| # | Who | Step |
| - | - | - |
| 1 | you | Install Docker Desktop (WSL 2 backend) and restart. |
| 2 | Claude or you | `cargo run --manifest-path src-tauri/Cargo.toml --example standin_cert -- --out tools/standin/ssl` writes the certificate and prints the CA name. |
| 3 | **you** | `certutil -user -addstore Root tools\standin\ssl\gr-standin-ca.cer` and confirm the Windows security prompt. |
| 4 | Claude or you | `docker compose -f tools/standin/compose.yaml up -d`, then wait until `docker compose -f tools/standin/compose.yaml ps` shows `healthy` (first start: image 1.9 GB, then 3–5 min). |
| 5 | **you** | `docker exec gr-standin-gitlab grep "Password:" /etc/gitlab/initial_root_password`, sign in at `https://localhost:8443` as `root`, change the password. The file is deleted at the first restart after 24 h. |
| 6 | Claude or you | `docker cp tools/standin/seed.rb gr-standin-gitlab:/tmp/seed.rb`, then `docker exec gr-standin-gitlab gitlab-rails runner /tmp/seed.rb`: users `dev` (you in the app), `alice`, `bob` (teammates), all Developers in group `sandbox`, and the project `sandbox/gr-sandbox` with a synthetic app skeleton and six MRs for S-01 (`dev` reviews !2–!4, approved !5, authored !6 with 3 unresolved threads (one on a changed line of `UploadWorker.cs`) and a package bump in the test project's `.csproj`, draft !7; a stand-in seeded before the test project existed gets it on `main` and !6 rebased onto it; pipelines are records with a status, no runner). Users get random passwords nobody knows. |
| 7 | **you** | As root: Admin area › Users › `dev` › Edit › set a password. Sign in as `dev` in a private window (GitLab asks for a new password), then Edit profile › Access tokens › Add new token, scope `api`. Store it: `.\src-tauri\target\release\gr-probe.exe token set --server https://localhost:8443`. Not through impersonation: tokens created while impersonating are revoked when it ends. |
| 8 | Claude or you | `.\src-tauri\target\release\gr-probe.exe tls --server https://localhost:8443` and `gitlab read --server https://localhost:8443 --project sandbox/gr-sandbox`. |

## Daily use

- Start: `docker compose -f tools/standin/compose.yaml up -d` · stop: `docker compose -f tools/standin/compose.yaml stop`. A stopped stand-in stays stopped after a reboot.
- Logs: `docker compose -f tools/standin/compose.yaml logs -f gitlab`.
- Cassettes and GraphQL checks (ADR-024): `cargo run --manifest-path src-tauri/Cargo.toml --example standin_query -- --graphql <file> --vars <json> --out <file>` or `-- --get /user`; it uses the token stored for `localhost` and talks to the stand-in only. In Git Bash set `MSYS_NO_PATHCONV=1` so `/user` stays a path.

## When on-prem is upgraded

Change the image tag in `compose.yaml` and the version in `docs/09-testing.md` › Environments, following GitLab's upgrade path (required stops between versions), then `up -d`.

## Removing it

1. `docker compose -f tools/standin/compose.yaml down -v` (deletes the volumes and all stand-in data).
2. `certutil -user -delstore Root "<CA name printed in step 2>"`.
3. `.\src-tauri\target\release\gr-probe.exe token delete --server https://localhost:8443`.
