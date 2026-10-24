import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTauriClient } from './tauri';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => undefined;
  },
}));
const invokeMock = vi.mocked(invoke);

// F-26.7: the two commands of the question flow, by their contract names (docs/04 › IPC contract,
// plan M7): `claude_reply_draft` takes the thread (project, iid, discussion) and answers
// { reply }; `author_reply` sends the reply at once and takes the same three plus the text.

describe('Tauri IPC client: question replies (F-26.7)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('F-26.7 claude_reply_draft sends the project, the iid and the discussion, nothing else', async () => {
    invokeMock.mockResolvedValue({ reply: 'Fine.' });
    const client = createTauriClient();

    await expect(client.claudeReplyDraft('mobile/mobile-app', 480, 'd-480-2')).resolves.toEqual({
      reply: 'Fine.',
    });

    expect(invokeMock.mock.calls).toEqual([
      ['claude_reply_draft', { project: 'mobile/mobile-app', iid: 480, discussion: 'd-480-2' }],
    ]);
  });

  it('F-26.7 author_reply sends the project, the iid, the discussion and the text as written', async () => {
    invokeMock.mockResolvedValue(null);
    const client = createTauriClient();
    const body = 'Zażółć gęślą jaźń:\n- `Kick()`';

    await client.authorReply('mobile/mobile-app', 480, 'd-480-2', body);

    expect(invokeMock.mock.calls).toEqual([
      ['author_reply', { project: 'mobile/mobile-app', iid: 480, discussion: 'd-480-2', body }],
    ]);
  });
});
