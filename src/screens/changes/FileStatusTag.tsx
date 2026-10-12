import { Tag } from '../../components/Tag';
import type { TreeFile } from '../../ipc/types/TreeFile';

export interface FileStatusTagProps {
  file: Pick<TreeFile, 'status' | 'oldPath'>;
  /** "renamed from X" in the diff header; the tree shows the word with a tooltip. */
  long?: boolean;
}

const fileName = (path: string) => path.split('/').pop() ?? path;

/** NEW (green), DELETED (orange), RENAMED (blue); modified files have no tag (F-15.4). */
export function FileStatusTag({ file, long = false }: FileStatusTagProps) {
  switch (file.status) {
    case 'added':
      return (
        <Tag color="green" size={long ? 's' : 'xs'}>
          New
        </Tag>
      );
    case 'deleted':
      return (
        <Tag color="orange" size={long ? 's' : 'xs'}>
          Deleted
        </Tag>
      );
    case 'renamed':
    case 'copied': {
      const from = file.oldPath ?? '';
      const word = file.status === 'renamed' ? 'Renamed' : 'Copied';
      return (
        <Tag color="blue" size={long ? 's' : 'xs'} title={`${word} from ${from}`}>
          {long ? `${word} from ${fileName(from)}` : word}
        </Tag>
      );
    }
    case 'modified':
      return null;
  }
}
