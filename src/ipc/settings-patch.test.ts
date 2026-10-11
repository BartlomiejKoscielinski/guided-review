import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './mock';
import { applySettingsPatch } from './settings-patch';

describe('applySettingsPatch', () => {
  it('merges nested groups and leaves the input unchanged', () => {
    const before = structuredClone(DEFAULT_SETTINGS);
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      ui: { focusLayout: 'C' },
      claude: { tasks: { plan: { effort: 'max' } } },
    });
    expect(next.ui.focusLayout).toBe('C');
    expect(next.ui.startIn).toBe('focus');
    expect(next.claude.tasks.plan).toEqual({ model: 'claude-opus-5-5', effort: 'max' });
    expect(DEFAULT_SETTINGS).toEqual(before);
  });

  it('replaces the last route whole', () => {
    const onStep = applySettingsPatch(DEFAULT_SETTINGS, {
      ui: { lastRoute: { screen: 'S-03', sessionId: 's1' } },
    });
    const next = applySettingsPatch(onStep, { ui: { lastRoute: { screen: 'S-06' } } });
    expect(next.ui.lastRoute).toEqual({ screen: 'S-06' });
  });

  it('sets optional values back to null', () => {
    const withPath = applySettingsPatch(DEFAULT_SETTINGS, { git: { path: 'C:\\git.exe' } });
    expect(applySettingsPatch(withPath, { git: { path: null } }).git.path).toBeNull();
  });
});
