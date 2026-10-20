---
paths:
  - "src/**/*.{ts,tsx,css}"
  - "tests/e2e/**/*.ts"
---

# Frontend rules

- Colors, fonts, shadows only through variables from `src/styles/tokens.css`. No hex values in components.
- Square corners (`border-radius: 0`); the only exception is `<Kbd>`. No decorative borders: separate regions with background steps and gaps; rings (`box-shadow: inset 0 0 0 2px`) only for selection/focus.
- Headings, buttons, tags and small labels: Barlow Condensed, uppercase via CSS, letter-spacing as in `03-design-system.md`. Body: Barlow. Code, SHAs, paths, counts: JetBrains Mono.
- Status is a word tag (NEW, DELETED, RENAMED, Should fix, Passed) with a color, never a letter or color alone.
- Claude content is marked with a purple square and "Claude", never a purple left border.
- English copy exactly as in the specs and mocks. Write strings in sentence case; uppercase comes from CSS.
- Long lists and diffs are virtualized (TanStack Virtual). Syntax highlighting only in the Shiki worker.
- Every interactive element is keyboard reachable with a visible 2px yellow focus outline; tabs/radios/switches have ARIA roles; icons have `aria-hidden` and buttons have labels.
- Data comes only through `src/ipc/client.ts` (TanStack Query hooks). Never call Tauri APIs directly from components.
- When adding an IPC call, add it to both `src/ipc/tauri.ts` and `src/ipc/mock/`.
