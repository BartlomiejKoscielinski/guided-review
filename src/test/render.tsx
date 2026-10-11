import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../app/queryClient';
import type { IpcClient } from '../ipc/client';
import { IpcProvider } from '../ipc/IpcProvider';
import { createMockClient, type MockOptions } from '../ipc/mock';

/** The mock backend without latency, with some commands replaced for a test. */
export function mockClient(
  overrides: Partial<IpcClient> = {},
  options: MockOptions = {},
): IpcClient {
  return { ...createMockClient({ latencyMs: 0, ...options }), ...overrides };
}

/** Renders UI with the mock backend (no latency, commands replaceable) and a fresh query cache. */
export function renderWithIpc(ui: ReactElement, client: Partial<IpcClient> = {}): RenderResult {
  const ipc = mockClient(client);
  return render(
    <IpcProvider client={ipc}>
      <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>
    </IpcProvider>,
  );
}
