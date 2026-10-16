import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pathFor } from '../../app/routes';
import { IpcError } from '../../ipc/errors';
import type { FileDiff } from '../../ipc/types/FileDiff';
import { renderWithIpc } from '../../test/render';
import { renderApp } from '../../test/renderApp';
import { FileBar } from './FileBar';

// F-08.5 states of the S-04 file bar that the spec and Main.dc.html don't show.

const deleted: FileDiff = {
  oldPath: 'src/Mobile.App/Services/LegacyUploader.cs',
  status: 'deleted',
  binary: false,
  additions: 0,
  deletions: 12,
  layer: 'app',
  lineStaging: false,
  hunks: [],
};

describe('S-04 file bar states (F-08.5)', () => {
  it('F-08.5 a deleted file has Open in Rider disabled, as on S-06', () => {
    renderWithIpc(
      <FileBar
        sessionId="mock-mr-session-1"
        file={deleted}
        path="src/Mobile.App/Services/LegacyUploader.cs"
        layout="split"
        onLayout={() => undefined}
        ignoreWhitespace={false}
        onIgnoreWhitespace={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Open in Rider' })).toBeDisabled();
    expect(screen.getByText('LegacyUploader.cs', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('−12', { exact: true })).toBeInTheDocument();
  });
});

describe('S-04 step files states (F-08.5)', () => {
  it('F-08.5 when the step files cannot be read, the error shows under the step header, as on S-03', async () => {
    const session = 'mock-mr-session-1';
    const app = renderApp(
      { screen: 'S-04', sessionId: session },
      {
        reviewStep: () =>
          Promise.reject(
            new IpcError({
              code: 'INTERNAL',
              message: 'The step could not be read.',
              retryable: false,
            }),
          ),
      },
    );
    await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: session })}?step=s4`);
    await screen.findByRole('heading', { level: 1 });
    const main = document.querySelector<HTMLElement>('main main');
    if (!main) throw new Error('no S-04 main column');
    expect(await within(main).findByRole('alert')).toHaveTextContent('The step could not be read.');
    expect(within(main).queryByRole('radiogroup', { name: 'Diff layout' })).toBeNull();
  });
});
