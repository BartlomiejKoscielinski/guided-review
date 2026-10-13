import type { Layer } from '../types/Layer';

const BUILD_EXTENSIONS = ['.csproj', '.sln', '.props', '.targets'];
const BUILD_NAMES = ['.gitlab-ci.yml', 'global.json', 'nuget.config'];

/** Mock copy of `review/layer.rs` (05 › Layers): first match, folder rules ignore the file name. */
export function layerOf(path: string): Layer {
  const parts = path
    .toLowerCase()
    .split(/[/\\]/)
    .filter((p) => p !== '');
  const name = parts.pop() ?? '';
  const folder = (test: (f: string) => boolean) => parts.some(test);
  if (folder((f) => f.includes('tests') || f === 'test')) return 'tests';
  if (folder((f) => f === 'platforms')) return 'platforms';
  if (
    BUILD_EXTENSIONS.some((ext) => name.endsWith(ext)) ||
    BUILD_NAMES.includes(name) ||
    name.startsWith('directory.')
  )
    return 'build';
  if (folder((f) => f === 'resources') || name.endsWith('.resx')) return 'resources';
  if (name.endsWith('.xaml') || name.endsWith('.xaml.cs')) return 'xaml';
  if (folder((f) => f === 'core' || f.endsWith('.core'))) return 'core';
  if (folder((f) => f === 'infrastructure' || f.endsWith('.infrastructure')))
    return 'infrastructure';
  if (name.endsWith('.cs')) return 'app';
  return 'other';
}
