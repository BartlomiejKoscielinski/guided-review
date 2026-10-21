import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    // E30: each file still gets a fresh jsdom and module graph, but the worker and its compiled
    // external modules are reused; with the default forks pool, jsdom setup (a new process per
    // file) was 40% of the run.
    pool: 'vmThreads',
  },
});
