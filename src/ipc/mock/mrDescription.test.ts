import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-27.2 in the mock backend, with the texts of CreateMR.dc.html. `gitMrTitle(target?)` is the
// title S-11 opens with, read without Claude (branch name in words for several commits);
// `claudeMrDescription(task, variant, target?)` is `claude_mr_description`: variant 'normal' is
// the first Write, 'short' and 'long' are Shorter / Longer version. The mock's two texts are the
// mock's D1 (normal, long) and D2 (short); the title is the mock's.

const TITLE = 'Enable compiled bindings in app pages';
const D1 =
  '## What\nAdds x:DataType to 12 pages and their DataTemplates, so XAML bindings are compiled.\n\n## Why\nCompiled bindings fail at build time instead of silently at runtime, and they are faster. Two broken bindings showed up and are fixed here: DeliveryListPage (Adress → Address) and ScannerPage.\n\n## How to test\n1. Build Release for Android and iOS.\n2. Open Deliveries, Scanner and Account. Lists and labels show data.\n3. Rotate the device on Deliveries. Nothing goes blank.';
const D2 =
  '## What\nTurns on compiled bindings (x:DataType) in all 12 app pages.\n\n## Why\nTypos in bindings now break the build. This MR already fixes the two it found.\n\n## How to test\n1. Release build on a device.\n2. Click through Deliveries, Scanner, Account.\n3. Rotate on Deliveries.';

const client = () => createMockClient({ latencyMs: 0 });

describe('mock MR title and description (F-27.2)', () => {
  it('F-27.2 the title from the commits is the branch name in words (3 commits)', async () => {
    expect(await client().gitMrTitle()).toBe('Chore compiled bindings');
    expect(await client().gitMrTitle('main')).toBe('Chore compiled bindings');
  });

  it('F-27.2 a target that is no branch on origin is INVALID_INPUT, like the core', async () => {
    await expect(client().gitMrTitle('nie-ma-takiej')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('F-27.2 without an active repository the title is INVALID_INPUT too', async () => {
    const mock = createMockClient({ latencyMs: 0, changes: { noRepo: true } });
    await expect(mock.gitMrTitle()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Pick a repository first.',
    });
  });

  it('F-27.2 the first Write gives the title and the What / Why / How to test of the mock', async () => {
    expect(await client().claudeMrDescription('t1', 'normal')).toEqual({
      title: TITLE,
      description: D1,
    });
  });

  it('F-27.2 the shorter version is the mock\u2019s short text and the longer version its long one', async () => {
    const mock = client();
    expect(await mock.claudeMrDescription('t1', 'short')).toEqual({
      title: TITLE,
      description: D2,
    });
    expect(await mock.claudeMrDescription('t2', 'long')).toEqual({
      title: TITLE,
      description: D1,
    });
  });

  it('F-27.2 without an active repository Write is INVALID_INPUT before anything runs', async () => {
    const mock = createMockClient({ latencyMs: 0, changes: { noRepo: true } });
    await expect(mock.claudeMrDescription('t1', 'normal')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Pick a repository first.',
    });
  });

  it('F-27.2 a usage limit fails the task like the other Claude commands', async () => {
    const mock = createMockClient({ latencyMs: 0, claude: { suggestFails: 'limited' } });
    await expect(mock.claudeMrDescription('t1', 'normal')).rejects.toMatchObject({
      code: 'CLAUDE_LIMITED',
    });
  });
});
