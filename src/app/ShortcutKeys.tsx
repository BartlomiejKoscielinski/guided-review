import { Fragment } from 'react';
import { Kbd } from '../components/Kbd';
import { useShortcutKeys, type ShortcutId } from './shortcuts';

export interface ShortcutKeysProps {
  id: ShortcutId;
}

/** An action's keys now as key boxes (`Ctrl` `K`): a hint that follows Settings › Shortcuts (F-19.7). */
export function ShortcutKeys({ id }: ShortcutKeysProps) {
  const keys = useShortcutKeys(id);
  return keys.map((key, i) => (
    <Fragment key={`${String(i)}-${key}`}>
      {i > 0 && ' '}
      <Kbd>{key}</Kbd>
    </Fragment>
  ));
}
