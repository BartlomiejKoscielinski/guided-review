import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Square } from '../../components/Square';
import {
  useClaudeRefresh,
  useClaudeSignIn,
  useClaudeStatus,
  usePickClaude,
} from '../../ipc/hooks/useClaude';
import { statusText } from './claudeStatusText';
import styles from './Settings.module.css';

/** Status under the Claude heading with the fixing action (F-18.1, F-18.7). */
export function ClaudeStatusLine() {
  const status = useClaudeStatus();
  const signIn = useClaudeSignIn();
  const refresh = useClaudeRefresh();
  const pick = usePickClaude();
  const { mutate: refreshNow } = refresh;
  const [waitingForSignIn, setWaiting] = useState(false);

  // After Sign in, check again when the user comes back to the app window.
  useEffect(() => {
    if (!waitingForSignIn) return;
    const onFocus = () => {
      setWaiting(false);
      refreshNow(undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [waitingForSignIn, refreshNow]);

  const data = status.data;
  if (!data) return null;
  const color =
    data.state === 'signedIn' ? 'green' : data.state === 'checking' ? 'white' : 'orange';
  return (
    <span className={styles.status} role="status">
      <span className={styles.statusText}>
        <Square color={color} size={9} />
        {statusText(data)}
      </span>
      {data.state === 'notSignedIn' && (
        <Button
          size={28}
          onClick={() => {
            signIn.mutate(undefined, {
              onSuccess: () => {
                setWaiting(true);
              },
            });
          }}
        >
          Sign in to Claude Code
        </Button>
      )}
      {(data.state === 'notFound' || data.state === 'tooOld') && (
        <Button
          size={28}
          onClick={() => {
            pick.mutate(undefined);
          }}
        >
          Change
        </Button>
      )}
      {(signIn.error ?? pick.error) && (
        <span className={styles.error}>{(signIn.error ?? pick.error)?.message}</span>
      )}
    </span>
  );
}
