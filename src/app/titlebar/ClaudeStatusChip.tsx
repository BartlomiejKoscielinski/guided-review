import { useNavigate } from 'react-router';
import { ModelChip } from '../../components/ModelChip';
import { StatusChip } from '../../components/StatusChip';
import { useClaudeSignIn, useClaudeStatus } from '../../ipc/hooks/useClaude';
import { CLAUDE_SETTINGS_ROUTE, pathFor } from '../routes';

/**
 * S-01: "Claude Code signed in" in the model chip's place (F-01.6, F-18.1). A failing check
 * turns orange and offers the fixing action.
 */
export function ClaudeStatusChip() {
  const navigate = useNavigate();
  const status = useClaudeStatus();
  const signIn = useClaudeSignIn();
  const openSettings = () => {
    void navigate(pathFor(CLAUDE_SETTINGS_ROUTE));
  };
  const state = status.data?.state ?? 'checking';
  switch (state) {
    case 'signedIn':
    case 'checking':
      return <ModelChip label="Claude Code signed in" onOpen={openSettings} />;
    case 'notSignedIn':
      return (
        <StatusChip
          color="orange"
          label="Sign in to Claude Code"
          onOpen={() => {
            signIn.mutate(undefined);
            openSettings();
          }}
        />
      );
    case 'limited':
      return <StatusChip color="orange" label="Claude usage limit reached" onOpen={openSettings} />;
    case 'notFound':
      return <StatusChip color="orange" label="Claude Code: not found" onOpen={openSettings} />;
    case 'tooOld':
    case 'failed':
      return <StatusChip color="orange" label="Claude Code" onOpen={openSettings} />;
  }
}
