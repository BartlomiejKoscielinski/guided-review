import type { ReactNode } from 'react';
import type { IpcClient } from './client';
import { IpcContext } from './IpcContext';

interface IpcProviderProps {
  client: IpcClient;
  children: ReactNode;
}

export function IpcProvider({ client, children }: IpcProviderProps) {
  return <IpcContext value={client}>{children}</IpcContext>;
}
