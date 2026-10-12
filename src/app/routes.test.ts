import { describe, expect, it } from 'vitest';
import type { Route } from '../ipc/types/Route';
import { pathFor, routeFor, SCREENS } from './routes';
import { routeObjects } from './router';
import { matchRoutes } from 'react-router';

const EXAMPLES: Route[] = [
  { screen: 'S-01' },
  { screen: 'S-02', sessionId: 's1' },
  { screen: 'S-03', sessionId: 's1' },
  { screen: 'S-04', sessionId: 's1' },
  { screen: 'S-05', sessionId: 's1' },
  { screen: 'S-06' },
  { screen: 'S-07', section: 'notifications' },
  { screen: 'S-08', iid: 482 },
  { screen: 'S-09', sessionId: 'a b/ł' },
  { screen: 'S-10', iid: 480 },
  { screen: 'S-11' },
];

describe('routes', () => {
  it('has one route per screen S-01…S-11', () => {
    expect(SCREENS.map((s) => s.id)).toEqual(EXAMPLES.map((r) => r.screen));
  });

  it('maps every route to a path and back', () => {
    for (const route of [...EXAMPLES, { screen: 'S-06', commit: 'a3f9c12' } satisfies Route]) {
      const matches = matchRoutes(routeObjects, pathFor(route));
      const leaf = matches?.at(-1);
      const handle = leaf?.route.handle as { screen: Route['screen'] } | undefined;
      expect(handle?.screen).toBe(route.screen);
      expect(routeFor(route.screen, leaf?.params ?? {})).toEqual(route);
    }
  });

  it('rejects invalid parameters', () => {
    expect(routeFor('S-07', { section: 'colors' })).toBeNull();
    expect(routeFor('S-08', { iid: 'abc' })).toBeNull();
    expect(routeFor('S-03', {})).toBeNull();
  });
});
