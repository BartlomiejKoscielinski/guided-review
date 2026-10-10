# Design references

- `mocks/*.dc.html`: interactive HTML mocks from the design canvas. Markup + inline styles = the exact visual spec. The `<script type="text/x-dc">` block holds the mock's example data and interaction logic (`renderVals()`); read it to understand behaviour, never copy its runtime into the app.
- `screens/*.png`: renders of the mocks at 1600×1000 (Detailed at 1600×1040) with the real fonts.
- Links between mocks (`href="Review.dc.html"`) show navigation between screens.
- Opening a `.dc.html` file directly in a browser shows the raw template (it expects the design tool's runtime, `support.js`, which is not included). Use the renderer below or the PNGs.

## Render a mock in any state

Requires the dev dependencies `playwright`, `@fontsource/barlow`, `@fontsource/barlow-condensed`, `@fontsource/jetbrains-mono` (they are app dependencies anyway).

```
node tools/mock-preview/render-mock.mjs Review.dc.html --state '{"layout":"C"}' --out .design-check/mock-S-03-C.png --text
```
`--text` also writes the visible text, useful for checking copy. `--props '<json>'` sets mock props (Tweaks).

## Mock ↔ screen ↔ states

| Screen | Mock | State presets used for `screens/*.png` |
| - | - | - |
| S-01 Start | `Start.dc.html` | `{}` · `{"tab":"mine"}` |
| S-02 Plan | `Overview.dc.html` | `{}` (strategy toggle: `{"strategy":"tests"}` / `{"strategy":"files"}`) |
| S-03 Focus | `Review.dc.html` | `{}` (A) · `{"layout":"B"}` · `{"layout":"C"}`; notes: `{"focus":"f1"}`… |
| S-04 Detailed | `Main.dc.html` (1600×1040) | `{}`; props `{"diffColors":"green-red"}`, `{"showInline":false}` |
| S-05 Summary | `SummaryDesk.dc.html` | `{}` (threads) · `{"tab":"drafts"}` · `{"tab":"drafts","published":true}` · `{"tab":"drafts","approved":true}` |
| S-06 Changes | `Changes.dc.html` | `{}` (local) · `{"source":"commit"}` · `{"committed":true,"message":"Enable compiled bindings in app pages"}` |
| S-07 Settings | `Settings.dc.html` | `{"section":"general"}` · `claude` · `gitlab` · `integrations` · `notifications` · `rules` · `shortcuts` |
| S-08 Pipeline | `Pipeline.dc.html` | `{}` · `{"job":"distribute:qa"}` · `{"hasNew":true,"pipe":"p351","job":"build:android","tick":1}` · `{"pipe":"p321","job":"unit-tests","ex":{"p321:unit-tests":"done"}}` |
| S-09 Since last review | `Rereview.dc.html` | `{}` · `{"sel":"c4"}` · `{"from":"v1"}` |
| S-10 Author mode | `Author.dc.html` | `{}` · `{"fix":"proposed"}` · `{"fix":"committed"}` · `{"fix":"pushed"}` · `{"sel":"t2"}` |
| S-11 New MR | `CreateMR.dc.html` | `{}` · `{"created":true}` |
| S-12 Navigation | `Navigate.dc.html` | `{}` · `{"peek":true}` · `{"moved":true,"hover":false}` |
| S-13 Tray | `Tray.dc.html` | `{}` |
| Flow (doc, PL) | `Flow.dc.html` (1800×1100) | — |
| Architecture (doc, PL) | `Architecture.dc.html` (1440×900) | — |

State keys are whatever the mock's `renderVals()` reads from `this.state`; open the script block of a mock to see all of them.

## Pending re-renders

Kickoff (2026-10-10) changed copy and colors in these mocks; their PNGs are stale until re-rendered in M0 (once Playwright is installed). Until then the mock wins over the PNG.

| Mock | Change | PNGs to re-render |
| - | - | - |
| `Review.dc.html` | "Finish" → "Finish review" | `S03-focus-layout-A/B/C.png` |
| `SummaryDesk.dc.html` | model chip "Sonnet 5.5 · low" | `S05-summary-*.png` |
| `Pipeline.dc.html` | model chip "Sonnet 5.5 · low" | `S08-pipeline*.png` |
| `Author.dc.html` | Question tag blue; fixup note; neutral "resolved the thread" and "Answered…" copy | `S10-author*.png` |
| `Settings.dc.html` | "Writes in" hint; complete shortcut list | `S07-settings-claude.png`, `S07-settings-shortcuts.png` |
| `Architecture.dc.html` | moved-code text (own detection, not `--color-moved`) | `D02-architecture.png` |

Settings rows that exist only in `02-screens.md` › S-07 (tray on close, Claude executable and task limit, GitLab token setup and repositories, quiet hours editing) have no mock; they reuse the existing row styles.
