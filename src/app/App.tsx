import { RouterProvider } from 'react-router/dom';
import type { createAppRouter } from './router';

export interface AppProps {
  router: ReturnType<typeof createAppRouter>;
}

/**
 * The app: shell and screens on a memory router created once at start (main.tsx). Router state
 * is applied at once, not as a React transition: no route is lazy, and a transition lets data that
 * arrives meanwhile render against the previous URL (S-03 showed step 1's list for ?step=s4).
 */
export function App({ router }: AppProps) {
  return <RouterProvider router={router} useTransitions={false} />;
}
