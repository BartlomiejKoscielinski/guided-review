import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../client';
import type { SummaryField } from '../types/SummaryField';
import { persistSummary } from './useSummary';

const field = (text: string): SummaryField => ({ enabled: true, text, suggested: false });

describe('persistSummary (F-12.4)', () => {
  it('F-12.4 writes one at a time and replaces the waiting field, so the last keystroke is kept last', async () => {
    const written: string[] = [];
    const release: (() => void)[] = [];
    const ipc = {
      sessionSetSummary: (_session: string, summary: SummaryField) =>
        new Promise<void>((resolve) => {
          written.push(summary.text);
          release.push(resolve);
        }),
    } as unknown as IpcClient;

    const first = persistSummary(ipc, 's', field('a'));
    void persistSummary(ipc, 's', field('ab'));
    const last = persistSummary(ipc, 's', field('abc'));
    expect(written).toEqual(['a']);
    release[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(written).toEqual(['a', 'abc']);
    release[1]?.();
    await expect(last).resolves.toBeUndefined();
    await expect(first).resolves.toBeUndefined();

    // Nothing is in flight now: the next field is written at once.
    void persistSummary(ipc, 's', field('abcd'));
    expect(written).toEqual(['a', 'abc', 'abcd']);
  });
});
