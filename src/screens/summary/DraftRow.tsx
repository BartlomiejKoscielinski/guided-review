import { useEffect, useRef, useState } from 'react';
import { Checkbox } from '../../components/Checkbox';
import { cx } from '../../components/cx';
import { PencilIcon } from '../../components/icons';
import { Tag } from '../../components/Tag';
import { useUpdateDraft } from '../../ipc/hooks/useDrafts';
import type { Draft } from '../../ipc/types/Draft';
import { SEVERITY_TAG } from '../step/noteCopy';
import { DraftEditor } from './DraftEditor';
import { LINE_CHANGED } from './publishCopy';
import pub from './Publish.module.css';
import styles from './Summary.module.css';

export interface DraftRowProps {
  draft: Draft;
  /** 1-based place in the list, part of the controls' names ("Publish comment 2"). */
  n: number;
  /** A Publish runs: the tick, the pencil and the editor's Save wait (F-12.5). */
  locked?: boolean;
}

/** "DeliveryPhotoViewModel.cs:54": the file name only; the full path goes in the title. */
function fileLine(draft: Draft): { text: string; title?: string } {
  const { position } = draft;
  if (!position) return { text: 'general comment' };
  const name = position.file.split('/').pop() ?? position.file;
  return { text: `${name}:${String(position.line)}`, title: position.file };
}

/**
 * One draft of S-05 (F-12.3, SummaryDesk.dc.html): the blue checkbox that includes it in the next
 * Publish, the severity square (none without a severity), the text, `file:line` and the pencil
 * that edits the text in place (M5 decision 6). Both changes are saved on this PC only. A
 * published draft keeps its row with "· published", its checkbox ticked and locked, no pencil.
 * F-12.5: a row whose last Publish failed shows its reason under `file:line` (M5 decision 9); a
 * draft whose line is gone from a newer version has the OUTDATED tag (decision 10b).
 */
export function DraftRow({ draft, n, locked = false }: DraftRowProps) {
  const include = useUpdateDraft();
  const save = useUpdateDraft();
  const [editing, setEditing] = useState(false);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    pencilRef.current?.focus();
  }, [editing]);

  const published = draft.publishedNoteId !== null;
  // While a tick is being saved the box already shows it; a refused one goes back.
  const ticked = include.isPending
    ? (include.variables.patch.include ?? draft.include)
    : draft.include;
  const tag = draft.severity ? SEVERITY_TAG[draft.severity] : null;
  const location = fileLine(draft);
  const error = include.error ?? save.error;

  const close = () => {
    save.reset();
    refocus.current = true;
    setEditing(false);
  };

  const outdated = draft.outdated && !published;
  const where = (
    <span className={styles.location} title={location.title}>
      {location.text}
      {published && ' · published'}
      {outdated && ` · ${LINE_CHANGED}`}
    </span>
  );

  return (
    <li className={cx(styles.draftRow, !ticked && !published && styles.draftOff)}>
      <Checkbox
        state={ticked || published ? 'on' : 'off'}
        label={`Publish comment ${String(n)}`}
        tone="blue"
        disabled={published || locked}
        className={styles.draftCheck}
        onToggle={() => {
          include.mutate({ id: draft.id, patch: { body: null, include: !ticked } });
        }}
      />
      {tag ? (
        <span className={cx(styles.dot, styles[tag.color])}>
          <span className="visually-hidden">{tag.label}</span>
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      <div className={styles.noteText}>
        {editing ? (
          <DraftEditor
            body={draft.body}
            label={`Comment ${String(n)}`}
            busy={save.isPending || locked}
            onSave={(body) => {
              save.mutate({ id: draft.id, patch: { body, include: null } }, { onSuccess: close });
            }}
            onCancel={close}
          />
        ) : (
          <p className={cx(styles.note, published && styles.noteSent)}>{draft.body}</p>
        )}
        {outdated ? (
          <span className={pub.outdated}>
            <Tag color="orange" size="s">
              Outdated
            </Tag>
            {where}
          </span>
        ) : (
          where
        )}
        {!published && draft.error && <p className={pub.reason}>{draft.error}</p>}
        {error && (
          <p role="alert" className={styles.draftError}>
            {error.message}
          </p>
        )}
      </div>
      {published ? (
        <span aria-hidden="true" className={styles.pencilSpace} />
      ) : (
        <button
          ref={pencilRef}
          type="button"
          className={styles.pencil}
          aria-label={`Edit comment ${String(n)}`}
          title="Edit"
          disabled={locked}
          onClick={() => {
            if (!editing) include.reset();
            setEditing(true);
          }}
        >
          <PencilIcon />
        </button>
      )}
    </li>
  );
}
