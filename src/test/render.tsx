import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../app/queryClient';
import type { IpcClient } from '../ipc/client';
import { IpcProvider } from '../ipc/IpcProvider';
import { createMockClient } from '../ipc/mock';

/** Renders UI with the mock backend (no latency) and a fresh query cache. */
export function renderWithIpc(
  ui: ReactElement,
  client: IpcClient = createMockClient({ latencyMs: 0 }),
): RenderResult {
  return render(
    <IpcProvider client={client}>
      <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>
    </IpcProvider>,
  );
}
