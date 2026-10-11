import { useAppHealth } from '../ipc/hooks/useAppHealth';

/** Placeholder until the shell (TitleBar, Dock, routes) lands in M0 session 2. */
export function App() {
  const health = useAppHealth();
  return (
    <main>
      <h1>Guided Review</h1>
      <p data-testid="app-health">
        {health.data
          ? `Version ${health.data.version}`
          : health.error
            ? health.error.message
            : 'Loading'}
      </p>
    </main>
  );
}
