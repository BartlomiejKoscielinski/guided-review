import type { Route } from '../types/Route';

/**
 * The mock's copy of the core's restore rule (`Route::restored` in src-tauri/src/route.rs):
 * session screens need their session, GitLab screens go to S-01, S-11 goes to S-06.
 */
export function restoreRoute(route: Route, sessionExists: (id: string) => boolean): Route {
  switch (route.screen) {
    case 'S-01':
    case 'S-06':
    case 'S-07':
      return route;
    case 'S-08':
    case 'S-10':
      return { screen: 'S-01' };
    case 'S-11':
      return { screen: 'S-06' };
    case 'S-02':
    case 'S-03':
    case 'S-04':
    case 'S-05':
    case 'S-09':
      return route.sessionId && sessionExists(route.sessionId) ? route : { screen: 'S-01' };
  }
}
