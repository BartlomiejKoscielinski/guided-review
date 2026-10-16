import type { Finding } from '../../ipc/types/Finding';
import type { LineSelection } from '../../ipc/types/LineSelection';

/** An open answer card (F-10, M3 decision 4); null = closed. */
export interface AskState {
  /** The lines the question is about; null asks about the whole step. */
  selection: LineSelection | null;
  /** A question typed in the guide panel, asked when the card opens. */
  question?: string;
  /** B's Ask Claude and More › Ask Claude open the card with the input focused. */
  focusInput: boolean;
  /** Opening again remounts the card. */
  nonce: number;
  /**
   * A request to move the focus to the open card's question field (`A` while the card is open,
   * F-30.6): a `nextNonce` number, so the card keeps its answer and also comes into view.
   */
  focus?: number;
}

/** The selection More › Ask Claude means: the note's line. */
export const selectionOf = (finding: Finding): LineSelection => ({
  file: finding.file,
  side: finding.side,
  start: finding.line,
  end: finding.line,
});
