import type { IpcClient } from '../client';
import type { RiderStatus } from '../types/RiderStatus';

/** Variations of the Rider part of the mock (`MockOptions.rider`). */
export interface RiderScenario {
  /** Rider isn't detected until a path is picked with Change. */
  notFound?: boolean;
}

type RiderClient = Pick<IpcClient, 'riderStatus' | 'riderPickExecutable' | 'fixWatch'>;

/** How long the mock's Rider takes to change the file (Author.dc.html's `fixRider` timer). */
export const MOCK_RIDER_EDIT_MS = 2200;

/** Settings.dc.html › Integrations. */
export const MOCK_RIDER: RiderStatus = {
  path: 'C:\\Program Files\\JetBrains\\JetBrains Rider 2026.2\\bin\\rider64.exe',
  version: '2026.2',
};

/** The Rider part of the mock backend (F-24.4); `savePath` stores `rider.path` like the core. */
export function createRiderBackend(
  scenario: RiderScenario,
  respond: <T>(value: T) => Promise<T>,
  savePath: (path: string) => void,
): RiderClient {
  let status: RiderStatus = scenario.notFound ? { path: null, version: null } : MOCK_RIDER;
  return {
    riderStatus: () => respond(status),
    riderPickExecutable: () => {
      status = MOCK_RIDER;
      savePath(MOCK_RIDER.path ?? '');
      return respond(status);
    },
    // F-26.3: "Rider" changes the watched file once, then the watch is over; not scaled by latency.
    fixWatch: (_file, onEvent) => {
      const timer = setTimeout(() => {
        onEvent({ kind: 'changed' });
      }, MOCK_RIDER_EDIT_MS);
      return Promise.resolve(() => {
        clearTimeout(timer);
      });
    },
  };
}
