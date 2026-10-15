import { describe, expect, it } from 'vitest';
import type { FileGroup } from '../../ipc/types/FileGroup';
import type { TreeFile } from '../../ipc/types/TreeFile';
import { browseFilter, browseFiles } from './browseFilter';
import { filterCount, flattenTree, onlyFiles, stageCheck } from './tree';

const file = (path: string, staged: TreeFile['staged'] = 'none'): TreeFile => ({
  path,
  name: path.split('/').pop() ?? path,
  status: 'modified',
  binary: false,
  additions: 1,
  deletions: 0,
  staged,
  untracked: false,
});

const groups: FileGroup[] = [
  { dir: 'docs', files: [file('docs/a.md')] },
  {
    dir: 'src/App/Views/Deliveries',
    files: [
      file('src/App/Views/Deliveries/DeliveryPhotoPage.xaml', 'all'),
      file('src/App/Views/Deliveries/DeliveryMapPage.xaml', 'all'),
    ],
  },
];

describe('S-06 tree', () => {
  it('F-15.2 groups files under their folder with counts; small trees are open', () => {
    const rows = flattenTree(groups, { filter: '', local: true, selected: undefined, folders: {} });
    expect(rows.map((r) => (r.kind === 'folder' ? `${r.dir} (${r.count})` : r.file.name))).toEqual([
      'docs (1)',
      'a.md',
      'src/App/Views/Deliveries (2)',
      'DeliveryPhotoPage.xaml',
      'DeliveryMapPage.xaml',
    ]);
  });

  it('F-15.2 folders collapse and the user choice wins', () => {
    const rows = flattenTree(groups, {
      filter: '',
      local: true,
      selected: undefined,
      folders: { docs: false },
    });
    expect(rows.filter((r) => r.kind === 'file')).toHaveLength(2);
  });

  it('F-15.3 filter shows matches with per-folder counts and a match count', () => {
    const rows = flattenTree(groups, {
      filter: 'photo',
      local: true,
      selected: undefined,
      folders: {},
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'folder', count: '1/2' });
    expect(filterCount(groups, 'photo')).toBe(1);
    expect(filterCount(groups, '')).toBe(3);
  });

  it('F-16.1 folder and master checkboxes are tri-state', () => {
    expect(stageCheck(groups[1]?.files ?? [])).toBe('on');
    expect(stageCheck(groups[0]?.files ?? [])).toBe('off');
    expect(stageCheck(groups.flatMap((g) => g.files))).toBe('mixed');
    expect(stageCheck([file('x', 'partial')])).toBe('mixed');
  });

  it('F-06.6 onlyFiles keeps the listed files and drops folders left empty', () => {
    const kept = onlyFiles(groups, ['src/App/Views/Deliveries/DeliveryMapPage.xaml', 'gone.cs']);
    expect(kept.map((g) => [g.dir, g.files.map((f) => f.name)])).toEqual([
      ['src/App/Views/Deliveries', ['DeliveryMapPage.xaml']],
    ]);
    expect(onlyFiles(groups, [])).toEqual([]);
  });

  it('F-06.6 the browse filter travels as router state and unknown state means the whole change', () => {
    expect(browseFiles(browseFilter(['a.cs', 'b.cs']))).toEqual(['a.cs', 'b.cs']);
    expect(browseFiles(null)).toBeNull();
    expect(browseFiles({ files: 'a.cs' })).toBeNull();
    expect(browseFiles({ files: [1] })).toBeNull();
    expect(browseFiles({})).toBeNull();
  });
});
