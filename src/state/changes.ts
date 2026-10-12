import { create } from 'zustand';
import type { CommitResult } from '../ipc/types/CommitResult';
import type { DiffLayout } from '../diff/rows';

/** S-06 view state kept while the app runs (switching screens keeps it, NFR-03). */
export interface ChangesState {
  /** Selected file per source ("local" or a commit SHA). */
  selected: Readonly<Record<string, string>>;
  layout: DiffLayout;
  /** Folders the user opened (true) or closed (false), per source; others use the default. */
  folders: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  filter: string;
  /** The commit message being written; never lost by navigating away. */
  message: string;
  amend: boolean;
  /** The commit just created ("Created <sha>", F-16.5). */
  created: CommitResult | null;
  select: (source: string, path: string) => void;
  setLayout: (layout: DiffLayout) => void;
  setFolder: (source: string, dir: string, open: boolean) => void;
  collapseAll: (source: string, dirs: readonly string[]) => void;
  setFilter: (filter: string) => void;
  setMessage: (message: string) => void;
  setAmend: (amend: boolean) => void;
  setCreated: (created: CommitResult | null) => void;
}

export const useChangesStore = create<ChangesState>()((set) => ({
  selected: {},
  layout: 'unified',
  folders: {},
  filter: '',
  message: '',
  amend: false,
  created: null,
  select: (source, path) => {
    set((s) => ({ selected: { ...s.selected, [source]: path } }));
  },
  setLayout: (layout) => {
    set({ layout });
  },
  setFolder: (source, dir, open) => {
    set((s) => ({ folders: { ...s.folders, [source]: { ...s.folders[source], [dir]: open } } }));
  },
  collapseAll: (source, dirs) => {
    set((s) => ({
      folders: { ...s.folders, [source]: Object.fromEntries(dirs.map((d) => [d, false])) },
    }));
  },
  setFilter: (filter) => {
    set({ filter });
  },
  setMessage: (message) => {
    set({ message });
  },
  setAmend: (amend) => {
    set({ amend });
  },
  setCreated: (created) => {
    set({ created });
  },
}));
