import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port (devUrl 1420); `npm run dev:mock` (mode "mock") serves the UI with the
// mock backend. GR_PORT moves it for a parallel lane worktree (tools/lanes.mjs), mock backend only.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: Number(process.env.GR_PORT ?? 1420),
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // The dependency scan does not follow `new Worker(new URL(...))`, so without the worker as an
  // entry Vite finds shiki on the first highlight and reloads every open page mid-session.
  optimizeDeps: { entries: ['index.html', 'src/**/*.worker.ts'] },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // The production CSP allows fonts only from 'self' (no data: URIs), so small font subsets
    // must stay files instead of being inlined. Other small assets use Vite's default.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf)$/.test(filePath) ? false : undefined),
  },
});
