import './styles/fonts';
import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { createQueryClient } from './app/queryClient';
import { createAppRouter } from './app/router';
import { createIpcClient } from './ipc/client';
import { IpcProvider } from './ipc/IpcProvider';
import type { Route } from './ipc/types/Route';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

const ipc = await createIpcClient();
// F-30.4: the last screen if it can be restored; S-01 when the core can't tell.
const start: Route = await ipc.appStartRoute().catch((): Route => ({ screen: 'S-01' }));
const router = createAppRouter(start);

createRoot(container).render(
  <StrictMode>
    <IpcProvider client={ipc}>
      <QueryClientProvider client={createQueryClient()}>
        <App router={router} />
      </QueryClientProvider>
    </IpcProvider>
  </StrictMode>,
);
