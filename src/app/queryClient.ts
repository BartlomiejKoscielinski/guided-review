import { QueryClient } from '@tanstack/react-query';

/** IPC data lives in TanStack Query; the core decides about retries (AppError.retryable). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
}
