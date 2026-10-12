import { useState } from 'react';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { useSaveGitlabAccount } from '../../ipc/hooks/useGitlab';
import styles from './Settings.module.css';

export interface GitlabTokenFormProps {
  server: string | null;
  /** Shown while replacing a stored token: back to the stored one. */
  onCancel?: () => void;
  onSaved: () => void;
}

/**
 * Server URL, token input and Check and save (F-19.5). The token lives only in this input
 * until GitLab accepts it; then the input and the finished mutation are cleared, so nothing in
 * the UI holds it (the core returns it masked).
 */
export function GitlabTokenForm({ server, onCancel, onSaved }: GitlabTokenFormProps) {
  const [url, setUrl] = useState(server ?? '');
  const [token, setToken] = useState('');
  const save = useSaveGitlabAccount();
  const submit = () => {
    save.mutate(
      { server: url, token },
      {
        onSuccess: () => {
          setToken('');
          save.reset();
          onSaved();
        },
      },
    );
  };
  return (
    <form
      className={styles.grid}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="gl-server" className={styles.label}>
        Server URL
      </label>
      <input
        id="gl-server"
        className={styles.input}
        type="url"
        value={url}
        spellCheck={false}
        onChange={(e) => {
          setUrl(e.target.value);
        }}
      />
      <label htmlFor="gl-token" className={styles.label}>
        Access token
      </label>
      <div className={styles.inline}>
        <input
          id="gl-token"
          className={cx(styles.input, styles.mono)}
          type="password"
          value={token}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setToken(e.target.value);
          }}
        />
        <Button type="submit" variant="primary" size={40} disabled={save.isPending}>
          Check and save
        </Button>
        {onCancel && (
          <Button size={40} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {save.error && (
        <>
          <span />
          <span role="alert" className={styles.error}>
            {save.error.message}
          </span>
        </>
      )}
    </form>
  );
}
