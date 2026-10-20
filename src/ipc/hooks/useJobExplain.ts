import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { JobExplanation } from '../types/JobExplanation';
import { CLAUDE_STATUS_KEY } from './useClaude';

/** The explanation of one job, kept while the app runs (decision 14: it stays for that job). */
const explainKey = (project: string, iid: number, job: number) =>
  ['jobExplain', project, iid, job] as const;
/** Its suggested comment went to the drafts. */
const draftedKey = (project: string, iid: number, job: number) =>
  ['jobExplainDrafted', project, iid, job] as const;

export interface JobExplain {
  /** The answer once Claude gave it (also after leaving the job and coming back). */
  result: JobExplanation | undefined;
  running: boolean;
  /** The worktree is being prepared ("Preparing the code…") before Claude reads. */
  preparing: boolean;
  failed: boolean;
  /** Why the last run failed (the error's message), shown after "Couldn't explain this failure.". */
  error: string | null;
  /** Explain failure and Retry: one run at a time. */
  explain: () => void;
  /** The suggested comment is in the drafts. */
  drafted: boolean;
  drafting: boolean;
  draftError: string | null;
  /** Add to drafts: the suggested comment unchanged as a general comment, once. */
  addToDrafts: () => void;
}

/**
 * Explain failure of S-08 (F-20.7, M6 decisions 12 and 14): `jobExplain` runs only on the click
 * (the query is never enabled on its own); the answer stays in the query cache per job, so the
 * job's panel shows it again after another job was picked. Add to drafts creates the MR draft
 * once (`draftsCreateForMr`, general comment), remembered per job too.
 */
export function useJobExplain(project: string, iid: number, job: number): JobExplain {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [preparing, setPreparing] = useState(false);
  const query = useQuery<JobExplanation, IpcError>({
    queryKey: explainKey(project, iid, job),
    queryFn: async () => {
      try {
        return await ipc.jobExplain(project, iid, job, (event) => {
          setPreparing(event.kind === 'preparing');
        });
      } finally {
        setPreparing(false);
        // The status follows the task result (F-18.1, F-18.7).
        void queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY });
      }
    },
    enabled: false,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const drafted = useQuery<boolean>({
    queryKey: draftedKey(project, iid, job),
    queryFn: () => false,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const sending = useRef(false);
  const draft = useMutation<unknown, IpcError, string>({
    mutationFn: (body) =>
      ipc.draftsCreateForMr(project, iid, { body, position: null, severity: null }),
    onSuccess: () => {
      queryClient.setQueryData(draftedKey(project, iid, job), true);
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  const running = query.fetchStatus === 'fetching';

  return {
    result: running ? undefined : query.data,
    running,
    preparing: running && preparing,
    failed: !running && query.status === 'error',
    error: !running && query.error ? query.error.message : null,
    explain: () => {
      if (running) return;
      void query.refetch();
    },
    drafted: drafted.data === true,
    drafting: draft.isPending,
    draftError: draft.error ? draft.error.message : null,
    addToDrafts: () => {
      const body = query.data?.suggestedComment ?? '';
      if (sending.current || drafted.data === true || body === '') return;
      sending.current = true;
      draft.mutate(body);
    },
  };
}
