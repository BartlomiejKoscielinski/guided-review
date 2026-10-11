import { createContext } from 'react';

/** Where a `<Kbd>` sits: on a dark surface, or on a filled (colored) button. */
export type KbdSurface = 'default' | 'on-color';

export const KbdContext = createContext<KbdSurface>('default');
