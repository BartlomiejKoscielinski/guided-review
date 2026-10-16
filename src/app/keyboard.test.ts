import { describe, expect, it } from 'vitest';
import { isNextStepShortcut, isTyping } from './keyboard';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { key: ']', ...init });

describe('Next step shortcut (F-08.4)', () => {
  it('F-08.4 ] alone is Next step; Ctrl, Alt or Meta with it is not', () => {
    expect(isNextStepShortcut(key({}))).toBe(true);
    expect(isNextStepShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isNextStepShortcut(key({ altKey: true }))).toBe(false);
    expect(isNextStepShortcut(key({ metaKey: true }))).toBe(false);
    expect(isNextStepShortcut(key({ key: '[' }))).toBe(false);
  });

  it('F-08.4 ] typed with AltGr (Ctrl+Alt on Windows) is Next step', () => {
    const altGr = key({ ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(isNextStepShortcut(altGr)).toBe(true);
  });

  it('F-08.4 ] in a field types; on a button it is the shortcut', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const button = document.createElement('button');
    expect(isTyping(input)).toBe(true);
    expect(isTyping(area)).toBe(true);
    expect(isTyping(button)).toBe(false);
    expect(isTyping(document.body)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it('F-08.4 on a checkbox, radio or other input that types nothing ] is the shortcut', () => {
    const input = (type: string) => Object.assign(document.createElement('input'), { type });
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color']) {
      expect(isTyping(input(type))).toBe(false);
    }
    for (const type of ['text', 'search', 'number', 'email', 'password', 'url']) {
      expect(isTyping(input(type))).toBe(true);
    }
    expect(isTyping(document.createElement('select'))).toBe(true);
  });
});
