import type { Route } from './types/Route';
import type { Settings } from './types/Settings';

/**
 * A partial settings change; nested groups merge, a route and the changed shortcuts
 * (`ui.shortcuts`) are always replaced whole.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Route ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type SettingsPatch = DeepPartial<Settings>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Paths whose value replaces the stored one whole (same rule as the core's `REPLACED_WHOLE`). */
const REPLACED_WHOLE = new Set(['ui.lastRoute', 'ui.shortcuts']);

function merge(target: unknown, patch: unknown, path: string): unknown {
  if (!isPlainObject(target) || !isPlainObject(patch) || REPLACED_WHOLE.has(path)) {
    return structuredClone(patch);
  }
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const child = path ? `${path}.${key}` : key;
    result[key] = key in target ? merge(target[key], value, child) : structuredClone(value);
  }
  return result;
}

/** Returns new settings with the patch applied; the input is not changed. */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  return merge(settings, patch, '') as Settings;
}
