# Provisional decisions (Autopilot)

Decisions the autopilot took on its own where the spec was unclear (docs/process/AUTOPILOT.md §3.2): it picked the recommended option and continued. Review them when convenient: set the status to `accepted`, or to `vetoed` (the next `backlog.mjs sync` adds a rework item). More than 5 rows in `provisional` stop the loop. Accepted decisions move into the docs (01–08) with the next item that touches them.

| ID | Date | Item | Question | Chosen | Alternatives | Reversible | Status |
| - | - | - | - | - | - | - | - |
| D-01 | 2026-10-14 | F-02.5 | Row note when a plan is cached and no other note applies | Exactly "plan is ready" (lowercase, as the criterion quotes it); with a note "<note> · plan is ready" | "Plan is ready" capitalised when alone | yes | provisional |
| D-02 | 2026-10-14 | F-02.5 | Where the " · plan is ready" suffix comes from in the mock backend | The row composes it from MrRow.planReady (as the core); mock !482 note is "You’re a reviewer" + planReady true; the existing F-02.2 mock assertion was changed accordingly (tests cd12450) | Keep the suffix baked into the mock note, planReady false | yes | provisional |
| D-03 | 2026-10-14 | F-02.5 | Mock All open list: !482 shows no note in Start.dc.html, but the core sets planReady per head on every tab | Follow the mock: All open !482 has planReady false (reviewer nit: the core cannot produce this) | planReady true for !482 on every tab (matches the core) | yes | provisional |
