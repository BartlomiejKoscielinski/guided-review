import { createContext, useContext } from 'react';

/**
 * Whether the open step may ask for its notes. False on S-03 restored on start: restoring starts
 * no Claude work (F-30.4), so only notes already in Claude's cache show (F-04.3); moving to
 * another step asks as usual.
 */
export const NotesRequest = createContext(true);

export const useNotesRequest = (): boolean => useContext(NotesRequest);
