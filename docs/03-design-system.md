# 03 · Design system

Dark, flat color blocks, bold condensed type. It must **not** look like GitHub: no grey bordered boxes, no rounded cards, no green/red pill badges. The mocks in `design/mocks/` are the reference; this file names what they use so the implementation uses tokens instead of copied hex values.

## Rules

1. **Fills, not borders.** Separate regions with background steps and 2–4px gaps. Borders appear only as 2px rings for selection/focus and on empty checkboxes.
2. **Square corners everywhere.** The only rounded element is `<kbd>` (3px).
3. **Color carries meaning, never alone.** A colored square or block is always paired with a word ("Should fix", "NEW", "Passed").
4. **Ink on color is black** (`--ink`). Text on a yellow/green/blue/purple/orange/white block uses `#101010`.
5. **Headings, buttons, tags and small labels use Barlow Condensed, uppercase.** Body text uses Barlow. Code uses JetBrains Mono.
6. **Claude content is marked with a purple square** (8–14px) and the word "Claude" or a heading. Never a purple left border.
7. **Calm.** At most one yellow primary action per region. No gradients, no glows, no animation except spinners and the log cursor.

## Tokens

Paste into `src/styles/tokens.css` and use only these variables in components.

```css
:root {
  /* surfaces */
  --bg: #101010;            /* app background */
  --bg-chrome: #0A0A0A;     /* title bar, dock, log background */
  --bg-sunken: #0D0D0D;     /* inputs, empty diff side, inactive segmented background */
  --panel: #141414;         /* side panels, sections */
  --panel-2: #1A1A1A;       /* sticky bars, rows on panel */
  --card: #1C1C1C;          /* list rows, cards, popover body */
  --raised: #1F1F1F;        /* controls, hunk header, chips */
  --raised-2: #262626;      /* neutral buttons, selected row, hover card */
  --line: #2A2A2A;          /* inactive progress segment */
  --ring: #4A4A47;          /* empty checkbox ring, dashed approval box */
  --ring-2: #3A3A38;        /* canceled/neutral blocks */

  /* text */
  --text: #F4F4F2;
  --text-2: #E8E8E4;
  --text-3: #D6D6D1;
  --text-body: #C9C9C4;     /* paragraphs on dark */
  --text-secondary: #B3B3AE;
  --text-muted: #8C8C87;    /* labels, meta */
  --text-lineno: #7E7E79;
  --ink: #101010;           /* text on color blocks */

  /* color blocks (meaning in the table below) */
  --yellow: #F7CF3D;   --yellow-hover: #FFE27A;
  --green: #63D676;    --green-text: #93E3A0;
  --purple: #B93CF6;   --purple-text: #C77DF8;  --purple-text-2: #D3A2FA;
  --orange: #EF6E2E;   --orange-text: #F6A983;
  --blue: #3F7CF2;     --blue-text: #9DBBF8;
  --white-block: #F4F4F2;

  /* diff, default palette "blue · orange" */
  --diff-add-bg: rgba(63, 124, 242, 0.16);
  --diff-add-em: rgba(63, 124, 242, 0.42);
  --diff-add-ln: rgba(63, 124, 242, 0.10);
  --diff-add-text: #9DBBF8;
  --diff-del-bg: rgba(239, 110, 46, 0.14);
  --diff-del-em: rgba(239, 110, 46, 0.40);
  --diff-del-ln: rgba(239, 110, 46, 0.09);
  --diff-del-text: #F6A983;
  --diff-empty: #0D0D0D;
  --diff-moved-bg: rgba(244, 244, 242, 0.035);
  --diff-moved-ln: rgba(244, 244, 242, 0.05);
  --diff-fresh-bg: rgba(99, 214, 118, 0.14);   /* lines just changed by an accepted fix */

  /* syntax */
  --syn-keyword: #D3A2FA;
  --syn-type: #93E3A0;
  --syn-string: #F6DC80;
  --syn-comment: #8C8C87;
  --syn-attribute: #B8C7E8;
  --syn-number: #F6A983;
  --syn-plain: #E8E8E4;
  --syn-punct: #A3A39E;

  /* misc */
  --focus: #F7CF3D;
  --shadow-pop: 0 14px 34px rgba(0, 0, 0, 0.5);
  --shadow-hover: 0 18px 40px rgba(0, 0, 0, 0.6);
  --kbd-bg: #2A2A2A;
  --caption-close-hover: #C42B1C;   /* Windows close button hover, the only off-palette color */
  --switch-off: #333331;            /* Switch track when off (Settings mock) */
  --green-tint: #1F2A20;            /* selected RadioCard (Start mock) */

  --font-ui: 'Barlow', 'Segoe UI', system-ui, sans-serif;
  --font-display: 'Barlow Condensed', 'Barlow', sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
}

/* Settings › General › Diff colors = "Green · red" */
:root[data-diff="green-red"] {
  --diff-add-bg: rgba(99, 214, 118, 0.15);
  --diff-add-em: rgba(99, 214, 118, 0.40);
  --diff-add-ln: rgba(99, 214, 118, 0.10);
  --diff-add-text: #93E3A0;
  --diff-del-bg: rgba(240, 80, 70, 0.14);
  --diff-del-em: rgba(240, 80, 70, 0.40);
  --diff-del-ln: rgba(240, 80, 70, 0.09);
  --diff-del-text: #FF968C;
}
```

Global: `body { background: var(--bg); color: var(--text); font: 14px/1.45 var(--font-ui); }`, `* { box-sizing: border-box }`, `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`, `color-scheme: dark`.

## Color meaning

| Color | Means | Examples |
| - | - | - |
| Yellow | Primary action, current position, Review area | Start, Next step, Mark reviewed (except Focus layout A, where Finish review is the region's yellow action and Mark reviewed is neutral), Commit, current step row, Review dock tile, drafts badge |
| Green | Done, approved, resolved, Changes area, included | reviewed step check, Approve MR, Resolve, Accept, NEW tag, staging checkboxes, Changes tile, passed job |
| Purple | Claude and Settings | Claude labels/squares, Suggest, Ask Claude, Fix with Claude, model chip square, Settings tile, settings nav selection |
| Orange | Should fix, deletions, warnings | Should fix tag, DELETED tag, failed job, "2 new commits", conflicts |
| Blue | Questions, additions, GitLab sends, MRs area | Question tag (also as a thread status in author mode), added lines, Publish and its draft checkboxes, Send reply, RENAMED tag, MRs tile, New commit (range-diff), running job |
| White block | Neutral selection, moved code, commits | selected segmented option, MOVED tag, Commits column header, manual job ring |

## Typography

| Use | Font | Size / line | Weight | Case, tracking |
| - | - | - | - | - |
| Page heading (S-01, S-07, S-08, S-11) | Barlow Condensed | 48–56px / 0.95 | 800 | uppercase |
| Screen heading in a panel (S-09, S-10) | Barlow Condensed | 46px / 0.95 | 800 | uppercase |
| Step title / MR title | Barlow Condensed | 34px / 1.02 | 800 | uppercase, `text-wrap: balance` |
| Section heading | Barlow Condensed | 22px | 800 | uppercase |
| Small label ("STEP 4 OF 8", "COMMITS IN THIS MR") | Barlow Condensed | 13–14px | 700 | uppercase, 0.08em |
| Buttons | Barlow Condensed | 13–19px | 700 (neutral) / 800 (filled) | uppercase, 0.04em |
| Tags | Barlow Condensed | 12–14px | 800 | uppercase, 0.05em |
| Body | Barlow | 14–15px / 1.45–1.55 | 400–600 | — |
| Meta | Barlow | 12.5–13.5px | 400 | color `--text-muted` |
| Code | JetBrains Mono | 12.5px / 21px | 400 | — |
| Line numbers | JetBrains Mono | 11px | 400 | `--text-lineno` |
| SHAs, paths, counts | JetBrains Mono | 11.5–13px | 500–600 | SHAs in yellow, MR iids in light blue or yellow |

Fonts are bundled (offline desktop app) with `@fontsource/barlow` (400, 500, 600, 700), `@fontsource/barlow-condensed` (600, 700, 800), `@fontsource/jetbrains-mono` (400, 500, 600), including the latin-ext subset (Polish names like "Paweł"). Never load Google Fonts at runtime.

## Spacing and layout

- Base unit 2px; common gaps 2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 26, 28, 32, 36, 44, 48.
- Page padding: 26–48px. Panels: 14–22px inner padding. Rows: 9–14px vertical padding.
- Lists of rows use 2px gaps on a panel background, not dividers.
- Minimum window 1280×800 (the work area when a screen is smaller, F-30.4); the mocks are drawn at 1600×1000. Side panels wrap below the main column on narrow windows (`flex-wrap`, `flex-basis` as in the mocks).

## Components

| Component | Spec (see mocks for exact styles) |
| - | - |
| **TitleBar** | 44px, `--bg-chrome`, drag region (double-click maximizes), logo square 26px yellow with the black "H" mark (`M4 2v12M12 2v12M4 8h8`, also the app icon, ADR-020), caption buttons 46px, close hover `--caption-close-hover`. |
| **Dock / DockTile** | 72px column; tile 58px wide, icon 22px stroke 2 square caps, label 11px condensed 700 uppercase. Active: fill with area color, ink text. |
| **Button** | Variants: `primary` (yellow), `approve` (green), `send` (blue), `claude` (purple), `neutral` (`--raised-2`), `ghost` (transparent, `--text-secondary`). Sizes: 28/30 (S), 34/36 (M), 40/42 (L), 50 (XL). Can include a `<Kbd>`; on filled buttons kbd uses `rgba(16,16,16,0.15)` background and ink text. Disabled: `--raised-2` background, `--text-muted`. |
| **Tag** | Word tag, condensed 800 uppercase, padding 1–3px × 7–12px. Variants: filled color, or ring (`box-shadow: inset 0 0 0 2px <color>`, colored text) for "allowed failure", "manual". |
| **Square** | 8–14px color square used as legend/indicator (Claude, status, severity). |
| **SeverityBadge** | 19–22px square, mono 10.5–11px number; fill = severity color; draft = yellow; dismissed = transparent with ring. |
| **Avatar** | Initials square 26–32px, condensed 800, color per person (stable hash into green/orange/blue/yellow/purple). |
| **Segmented** | Background `--bg-sunken` or `--raised`; selected item filled (white block, yellow, purple or green depending on context). |
| **Tabs** | Same as Segmented, with counts in mono. |
| **Switch** | 46×26 square track (`--switch-off` off, green on), 18px square knob (ink on, `--text-muted` off). |
| **Checkbox** | 17px, accent green; tri-state for directories. Large staging checkboxes in S-06 are 18px green squares with black check. Draft checkboxes in S-05 are blue (they select what gets published). |
| **RadioCard** | Card with radio; selected = green tint `--green-tint` (`#1F2A20`) + 2px green ring. |
| **Input / Select / TextArea** | 36–46px height, no border, `--bg-sunken` or `--panel-2`, text `--text`; mono for commit messages and descriptions. |
| **ProgressSegments** | 8 segments 12×6px: done green, current yellow (or white in title bar), upcoming `--line`. |
| **CoverageBar** | 8px green bar; remainder `--line`. |
| **Banner** | Full-width color block with ink text and optional actions (publish result, confirmations). |
| **NoteCard** | `--card` + `--shadow-pop`; tag, title 15–16px 600, Claude label, body, evidence chips, suggested comment block (`--bg`), actions. |
| **ThreadCard** | Messages with avatars; Resolve (green) / Reply / Reopen. |
| **FoldRow** | `#191919` row with mono title, muted reason, action button. |
| **HunkHeader** | `--raised` row, mono 12px `#A3A39E`. |
| **GutterMarker** | 12px severity square (Focus A/B) or 19px numbered square (C, Detailed); focused = 2px yellow outline. |
| **MovedRow** | `--raised` row: white MOVED tag, origin text, orange "N LINE CHANGED" tag, Show/Hide, Go to origin. |
| **HoverCard** | 470px, `--raised-2`, `--shadow-hover`, kind tag (green interface/class, blue method), signature mono, doc, action bar on `--panel`. |
| **Kbd** | mono 10.5–11px, `--kbd-bg`, `--text-3`, 3px radius. |
| **ModelChip** | 28px, `--panel-2`, 8px purple square + "Sonnet 5.5 · medium"; links to Settings › Claude. |
| **StatusChip** | 28px, `--panel-2`, 8px status square + text (pipeline status). |
| **Toast (native)** | Windows notification; app icon, title, body, two actions. |

## Icons

Inline SVG, `stroke="currentColor"`, stroke width 2–2.4 (2.6–3 for checks), `stroke-linecap="square"`. Reuse the paths from the mocks (MRs graph, map-pin Review, commit node Changes, gear Settings, check, cross, chevrons, play, stop, retry, lock, comment). Keep them in `src/components/icons.tsx`. No icon font.

## Motion

- Spinner: 0.9s linear rotation of a 3/4 arc. Log cursor: 1s step blink.
- Hover/press background changes ≤ 120ms. No slide or fade transitions between screens.
- `@media (prefers-reduced-motion: reduce)` disables all animations.

## Copy style (English UI)

- Short, plain, specific. Sentence case for text, uppercase only via CSS on condensed elements (write strings in normal case in code).
- Say what happens and what doesn't: "Approving doesn't publish comments." "Only you can see drafts until you publish them."
- No exclamation marks, no praise, no emoji.
- Numbers as digits; times as "2 h ago", "just now".
