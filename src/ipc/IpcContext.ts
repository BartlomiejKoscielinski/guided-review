import { createContext, useContext } from 'react';
import type { IpcClient } from './client';

export const IpcContext = createContext<IpcClient | null>(null);

/** The IPC client provided by `IpcProvider`. Hooks in `ipc/hooks/` use it; components use the hooks. */
export function useIpc(): IpcClient {
  const client = useContext(IpcContext);
  if (!client) throw new Error('useIpc() must be used inside <IpcProvider>.');
  return client;
}
