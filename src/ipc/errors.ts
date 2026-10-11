import type { AppError } from './types/AppError';
import type { ErrorCode } from './types/ErrorCode';

/** A failed IPC command, carrying the core's `AppError`. */
export class IpcError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  readonly retryable: boolean;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'IpcError';
    this.code = error.code;
    this.detail = error.detail;
    this.retryable = error.retryable;
  }
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' &&
    typeof v.message === 'string' &&
    typeof v.retryable === 'boolean' &&
    (v.detail === undefined || typeof v.detail === 'string')
  );
}

/** Wraps whatever an IPC call rejected with; anything that isn't an `AppError` becomes INTERNAL. */
export function toIpcError(value: unknown): IpcError {
  if (value instanceof IpcError) return value;
  if (isAppError(value)) return new IpcError(value);
  return new IpcError({
    code: 'INTERNAL',
    message: 'Something went wrong in the app.',
    detail: value instanceof Error ? value.message : String(value),
    retryable: false,
  });
}
