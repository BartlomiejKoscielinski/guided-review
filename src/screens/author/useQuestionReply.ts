import { useQueryClient } from '@tanstack/react-query';
import { toIpcError } from '../../ipc/errors';
import { authorMrKey } from '../../ipc/hooks/useAuthorMr';
import { useIpc } from '../../ipc/IpcContext';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import {
  EMPTY_REPLY,
  useAuthorQuestionStore,
  type QuestionReply,
} from '../../state/authorQuestion';
import { isAnswered } from './authorText';

export interface QuestionReplyControls extends QuestionReply {
  /**
   * The card reads "Answered…": the thread's last note is mine, or my reply went out and no note
   * has come after it yet (the reload may still be on its way or have failed).
   */
  answered: boolean;
  setText: (text: string) => void;
  /** **Draft with Claude**: fills the text with Claude's proposal; sends nothing. */
  draft: () => void;
  /** **Send reply**: the text as typed goes to GitLab at once. */
  send: () => void;
}

/**
 * The reply composer of question `thread` of my MR (F-26.7). Its state lives in
 * `useAuthorQuestionStore`, so a draft or a send that ends while another thread is open lands on
 * the thread it belongs to. Nothing runs until a click.
 */
export function useQuestionReply(project: string, iid: number, question: AuthorThread) {
  const thread = question.id;
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const reply = useAuthorQuestionStore((s) => s.replies[thread]) ?? EMPTY_REPLY;
  const update = useAuthorQuestionStore((s) => s.update);
  const current = () => useAuthorQuestionStore.getState().replies[thread] ?? EMPTY_REPLY;
  const busy = () => current().phase === 'drafting' || current().phase === 'sending';

  const draft = () => {
    if (busy()) return;
    update(thread, { phase: 'drafting', error: null });
    ipc.claudeReplyDraft(project, iid, thread).then(
      (result) => {
        update(thread, { phase: 'idle', text: result.reply });
      },
      (error: unknown) => {
        update(thread, { phase: 'idle', error: toIpcError(error).message });
      },
    );
  };

  const send = () => {
    const text = current().text;
    if (busy() || text.trim() === '') return;
    const notesAtSend = question.notes.length;
    update(thread, { phase: 'sending', error: null });
    ipc.authorReply(project, iid, thread, text).then(
      async () => {
        // The thread then lists my reply and reads Answered; a later note (a follow-up) brings
        // the composer back, as the thread data decides from then on.
        await queryClient.invalidateQueries({ queryKey: authorMrKey(project, iid) });
        update(thread, { phase: 'sent', text: '', notesAtSend });
      },
      (error: unknown) => {
        update(thread, { phase: 'idle', error: toIpcError(error).message });
      },
    );
  };

  const sentPending =
    reply.phase === 'sent' &&
    reply.notesAtSend !== null &&
    question.notes.length <= reply.notesAtSend;
  return {
    ...reply,
    answered: isAnswered(question) || sentPending,
    setText: (text: string) => {
      update(thread, { text });
    },
    draft,
    send,
  } satisfies QuestionReplyControls;
}
