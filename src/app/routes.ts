import type { Route } from '../ipc/types/Route';
import type { SettingsSection } from '../ipc/types/SettingsSection';

export type ScreenId = Route['screen'];

/** Dock tile that is active on a screen (docs/02 › Shell table). */
export type DockArea = 'mrs' | 'review' | 'changes' | 'settings';

export interface ScreenInfo {
  id: ScreenId;
  /** Memory-router path pattern. */
  path: string;
  /** More patterns for the same screen (S-06 commit mode). */
  morePaths?: readonly string[];
  /** Accessible name of the screen (heading of the stub until its milestone). */
  name: string;
  dock: DockArea;
}

/** S-01…S-11 (S-12 is a capability inside S-03/S-04, S-13 a separate window). */
export const SCREENS: readonly ScreenInfo[] = [
  { id: 'S-01', path: '/', name: 'Start', dock: 'mrs' },
  { id: 'S-02', path: '/session/:sessionId/plan', name: 'Review plan', dock: 'review' },
  { id: 'S-03', path: '/session/:sessionId/step', name: 'Step review', dock: 'review' },
  { id: 'S-04', path: '/session/:sessionId/detailed', name: 'Step review', dock: 'review' },
  { id: 'S-05', path: '/session/:sessionId/summary', name: 'Summary', dock: 'review' },
  {
    id: 'S-06',
    path: '/changes',
    morePaths: ['/changes/commit/:commit'],
    name: 'Changes',
    dock: 'changes',
  },
  { id: 'S-07', path: '/settings/:section', name: 'Settings', dock: 'settings' },
  { id: 'S-08', path: '/mr/:iid/pipeline', name: 'Pipeline', dock: 'review' },
  {
    id: 'S-09',
    path: '/session/:sessionId/since-last-review',
    name: 'Since your last review',
    dock: 'review',
  },
  { id: 'S-10', path: '/mr/:iid/author', name: 'Your MR', dock: 'mrs' },
  { id: 'S-11', path: '/changes/new-mr', name: 'New merge request', dock: 'changes' },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'general',
  'claude',
  'gitlab',
  'integrations',
  'notifications',
  'rules',
  'shortcuts',
];

export function screenInfo(id: ScreenId): ScreenInfo {
  const info = SCREENS.find((s) => s.id === id);
  if (!info) throw new Error(`Unknown screen ${id}.`);
  return info;
}

/** The router path of a route. */
export function pathFor(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.screen) {
    case 'S-01':
      return '/';
    case 'S-02':
      return `/session/${enc(route.sessionId)}/plan`;
    case 'S-03':
      return `/session/${enc(route.sessionId)}/step`;
    case 'S-04':
      return `/session/${enc(route.sessionId)}/detailed`;
    case 'S-05':
      return `/session/${enc(route.sessionId)}/summary`;
    case 'S-06':
      return route.commit ? `/changes/commit/${enc(route.commit)}` : '/changes';
    case 'S-07':
      return `/settings/${route.section}`;
    case 'S-08':
      return `/mr/${String(route.iid)}/pipeline`;
    case 'S-09':
      return `/session/${enc(route.sessionId)}/since-last-review`;
    case 'S-10':
      return `/mr/${String(route.iid)}/author`;
    case 'S-11':
      return '/changes/new-mr';
  }
}

type Params = Readonly<Partial<Record<string, string>>>;

function isSection(value: string | undefined): value is SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection);
}

/** The route of a matched screen and its path parameters, or `null` if they are invalid. */
export function routeFor(screen: ScreenId, params: Params): Route | null {
  const sessionId = params.sessionId ?? '';
  const iid = Number(params.iid);
  switch (screen) {
    case 'S-01':
    case 'S-11':
      return { screen };
    case 'S-06':
      return params.commit ? { screen, commit: params.commit } : { screen };
    case 'S-02':
    case 'S-03':
    case 'S-04':
    case 'S-05':
    case 'S-09':
      return sessionId ? { screen, sessionId } : null;
    case 'S-07':
      return isSection(params.section) ? { screen, section: params.section } : null;
    case 'S-08':
    case 'S-10':
      return Number.isSafeInteger(iid) && iid > 0 ? { screen, iid } : null;
  }
}

/** Settings › General: where the Settings tile and Ctrl+, go (F-19.4). */
export const SETTINGS_ROUTE: Route = { screen: 'S-07', section: 'general' };
/** Settings › Claude: where the model chip goes (F-18.5). */
export const CLAUDE_SETTINGS_ROUTE: Route = { screen: 'S-07', section: 'claude' };
