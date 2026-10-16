import { createElement, type ComponentType } from 'react';
import { createMemoryRouter, Navigate, type RouteObject } from 'react-router';
import type { Route } from '../ipc/types/Route';
import { AuthorScreen } from '../screens/author/AuthorScreen';
import { ChangesScreen } from '../screens/changes/ChangesScreen';
import { CreateMrScreen } from '../screens/create-mr/CreateMrScreen';
import { PipelineScreen } from '../screens/pipeline/PipelineScreen';
import { PlanScreen } from '../screens/plan/PlanScreen';
import { RereviewScreen } from '../screens/rereview/RereviewScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { StartScreen } from '../screens/start/StartScreen';
import { DetailedScreen } from '../screens/detailed/DetailedScreen';
import { StepScreen } from '../screens/step/StepScreen';
import { SummaryScreen } from '../screens/summary/SummaryScreen';
import { pathFor, SCREENS, type ScreenId } from './routes';
import { Shell, type ScreenHandle } from './Shell';

const SCREEN_COMPONENTS: Record<ScreenId, ComponentType> = {
  'S-01': StartScreen,
  'S-02': PlanScreen,
  'S-03': StepScreen,
  'S-04': DetailedScreen,
  'S-05': SummaryScreen,
  'S-06': ChangesScreen,
  'S-07': SettingsScreen,
  'S-08': PipelineScreen,
  'S-09': RereviewScreen,
  'S-10': AuthorScreen,
  'S-11': CreateMrScreen,
};

/** Location state of the first screen when it was restored from `ui.lastRoute` (F-30.4). */
export interface StartState {
  /** Screens opened this way show cached data only and start no Claude or GitLab work. */
  restored: true;
}

export const routeObjects: RouteObject[] = [
  {
    element: createElement(Shell),
    children: [
      ...SCREENS.flatMap((screen): RouteObject[] => {
        const handle: ScreenHandle = { screen: screen.id };
        return [screen.path, ...(screen.morePaths ?? [])].map((path) => ({
          path,
          element: createElement(SCREEN_COMPONENTS[screen.id]),
          handle,
        }));
      }),
      { path: '*', element: createElement(Navigate, { to: '/', replace: true }) },
    ],
  },
];

/** The app's memory router, starting on `start` (the restored last screen or S-01). */
export function createAppRouter(start: Route) {
  const state: StartState = { restored: true };
  return createMemoryRouter(routeObjects, {
    initialEntries: [{ pathname: pathFor(start), state }],
  });
}
