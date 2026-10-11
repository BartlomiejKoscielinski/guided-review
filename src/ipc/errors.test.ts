import { describe, expect, it } from 'vitest';
import { IpcError, isAppError, toIpcError } from './errors';

describe('IPC errors', () => {
  it('keeps the AppError a command rejected with', () => {
    const e = toIpcError({
      code: 'GITLAB_UNREACHABLE',
      message: 'GitLab is unreachable.',
      detail: 'timeout',
      retryable: true,
    });
    expect(e).toBeInstanceOf(IpcError);
    expect(e).toMatchObject({
      code: 'GITLAB_UNREACHABLE',
      message: 'GitLab is unreachable.',
      detail: 'timeout',
      retryable: true,
    });
  });

  it('maps anything else to INTERNAL with the original text as detail', () => {
    const e = toIpcError('command app_nope not found');
    expect(e.code).toBe('INTERNAL');
    expect(e.retryable).toBe(false);
    expect(e.detail).toBe('command app_nope not found');
  });

  it('recognises AppError shapes only', () => {
    expect(isAppError({ code: 'INTERNAL', message: 'x', retryable: false })).toBe(true);
    expect(isAppError({ code: 'INTERNAL', message: 'x' })).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
