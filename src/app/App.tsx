import { RouterProvider } from 'react-router/dom';
import type { createAppRouter } from './router';

export interface AppProps {
  router: ReturnType<typeof createAppRouter>;
}

/** The app: shell and screens on a memory router created once at start (main.tsx). */
export function App({ router }: AppProps) {
  return <RouterProvider router={router} />;
}
