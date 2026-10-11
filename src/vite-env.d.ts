/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mock" in `npm run dev:mock` and e2e tests; unset in the Tauri app. */
  readonly VITE_IPC?: 'mock';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
