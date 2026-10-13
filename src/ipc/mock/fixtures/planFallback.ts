import type { AppError } from '../../types/AppError';
import type { ChangeStats } from '../../types/ChangeStats';
import type { Layer } from '../../types/Layer';
import type { PlanView } from '../../types/PlanView';
import type { Step } from '../../types/Step';
import { lineCounts, mrFiles } from './mr';

/** Layers of !482's files as `review/layer.rs` names them (F-05.4). */
function layerOf(path: string): Layer {
  if (path.startsWith('tests/')) return 'tests';
  if (path.includes('/Platforms/')) return 'platforms';
  if (path.includes('/Resources/')) return 'resources';
  if (path.endsWith('.csproj')) return 'build';
  if (path.endsWith('.xaml')) return 'xaml';
  if (path.startsWith('src/Mobile.Core/')) return 'core';
  if (path.startsWith('src/Mobile.Infrastructure/')) return 'infrastructure';
  return 'app';
}

const LAYER_TITLE: Record<Layer, string> = {
  core: 'Core',
  infrastructure: 'Infrastructure',
  app: 'App',
  xaml: 'XAML',
  platforms: 'Platforms',
  tests: 'Tests',
  resources: 'Resources',
  build: 'Build',
  other: 'Other',
};

/** GitLab's diff order as `strategy.rs` computes it: directories first, byte-wise. */
function gitlabPathCmp(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const aFile = i + 1 === x.length;
    const bFile = i + 1 === y.length;
    if (aFile !== bFile) return aFile ? 1 : -1;
    const [p, q] = [x[i] ?? '', y[i] ?? ''];
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

/**
 * S-02's Claude-failed state (02 › S-02): the app's file-order fallback of !482, one step per
 * layer group in GitLab file order, "2 open threads." and full coverage of the mock diff.
 */
export function mockFallbackView(error: AppError): PlanView {
  const files = mrFiles().sort((a, b) => gitlabPathCmp(a.path, b.path));
  const groups = new Map<Layer, typeof files>();
  for (const f of files) {
    const layer = layerOf(f.path);
    groups.set(layer, [...(groups.get(layer) ?? []), f]);
  }
  const steps: Step[] = [];
  const stepStats: ChangeStats[] = [];
  for (const [layer, group] of groups) {
    const id = `f${String(steps.length + 1)}`;
    const reason = group.map((f) => f.path.split('/').at(-1) ?? f.path).join(', ');
    steps.push({
      id,
      title: LAYER_TITLE[layer],
      shortTitle: LAYER_TITLE[layer],
      reason,
      description: reason,
      layer,
      hunkIds: group.flatMap((f) => f.hunks.map((h) => h.id)),
      buildsOn: [],
    });
    const counts = group.map(lineCounts);
    stepStats.push({
      files: group.length,
      additions: counts.reduce((n, c) => n + c.additions, 0),
      deletions: counts.reduce((n, c) => n + c.deletions, 0),
    });
  }
  const order = steps.map((s) => s.id);
  const hunks = files.reduce((n, f) => n + f.hunks.length, 0);
  return {
    plan: {
      intent: '',
      steps,
      orders: { contractToUi: order, testsFirst: order },
      skim: [],
      risks: [],
      descriptionCheck: [],
      alreadyDiscussed: '2 open threads.',
      coverage: { files: files.length, filesTotal: files.length, hunks, hunksTotal: hunks },
    },
    order: { strategy: 'fileOrder', custom: false, order },
    stepStats,
    skimStats: [],
    skimFiles: [],
    fallback: error,
  };
}
