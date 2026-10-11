import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTauriClient } from './tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

describe('Tauri IPC client', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
  });

  it('calls app_health', async () => {
    invokeMock.mockResolvedValue({ version: '0.1.0', platform: 'windows' });
    await expect(createTauriClient().appHealth()).resolves.toEqual({
      version: '0.1.0',
      platform: 'windows',
    });
    expect(invokeMock).toHaveBeenCalledWith('app_health', undefined);
  });

  it('calls the settings, start-route and sessions commands by their contract names', async () => {
    const client = createTauriClient();
    await client.appSettingsGet();
    await client.appSettingsSet({ ui: { startIn: 'detailed' } });
    await client.appStartRoute();
    await client.sessionsListUnfinished();
    expect(invokeMock.mock.calls).toEqual([
      ['app_settings_get', undefined],
      ['app_settings_set', { patch: { ui: { startIn: 'detailed' } } }],
      ['app_start_route', undefined],
      ['sessions_list_unfinished', undefined],
    ]);
  });

  it('rejects with an IpcError carrying the AppError', async () => {
    invokeMock.mockRejectedValue({ code: 'INTERNAL', message: 'Broken.', retryable: false });
    await expect(createTauriClient().appHealth()).rejects.toMatchObject({
      name: 'IpcError',
      code: 'INTERNAL',
      message: 'Broken.',
    });
  });
});
