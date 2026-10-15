import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FileDiff } from '../../ipc/types/FileDiff';
import { renderWithIpc } from '../../test/render';
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
