import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { createQueryClient } from './app/queryClient';
import { createIpcClient } from './ipc/client';
import { IpcProvider } from './ipc/IpcProvider';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

const ipc = await createIpcClient();

createRoot(container).render(
  <StrictMode>
    <IpcProvider client={ipc}>
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>
    </IpcProvider>
  </StrictMode>,
);
