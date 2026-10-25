import type { IpcClient } from '../client';
import { IpcError } from '../errors';

/** Whitespace, control characters and quotes: refused before the URL is parsed (like the core). */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\s\u0000-\u001f\u007f"'`]/;

/** `url` is an `https` URL on `server`'s host and port, without user info (`os/browser.rs`). */
export function onGitlabHost(server: string | null, url: string): boolean {
  if (server === null || url === '' || UNSAFE.test(url)) return false;
  try {
    const base = new URL(server.trim());
    const target = new URL(url);
    return (
      target.protocol === 'https:' &&
      target.host.toLowerCase() === base.host.toLowerCase() &&
      target.username === '' &&
      target.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * `osOpenGitlabUrl` (F-20.4, M6 decision 13) as `commands/os.rs` answers it: the mock opens no
 * browser; a URL that is not `https` on the configured GitLab host is INVALID_INPUT.
 */
export function createBrowserBackend(
  server: () => string | null,
  respond: <T>(value: T) => Promise<T>,
): Pick<IpcClient, 'osOpenGitlabUrl'> {
  return {
    osOpenGitlabUrl: (url) =>
      onGitlabHost(server(), url)
        ? respond(undefined)
        : Promise.reject(
            new IpcError({
              code: 'INVALID_INPUT',
              message: 'That link isn’t on your GitLab server.',
              retryable: false,
            }),
          ),
  };
}
