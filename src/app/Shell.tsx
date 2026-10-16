import { Outlet, useMatches } from 'react-router';
import { Dock } from './dock/Dock';
import { useGlobalShortcuts } from './keyboard';
import { routeFor, screenInfo, type ScreenId } from './routes';
import { ScreenTitleBar } from './titlebar/ScreenTitleBar';
import { useDiffColors } from './useDiffColors';
import { useLastRouteSaver } from './useLastRouteSaver';
import { useShortcutOverrides } from './useShortcutOverrides';
import styles from './Shell.module.css';

/** Route `handle` of a screen: which S-xx it is. */
export interface ScreenHandle {
  screen: ScreenId;
}

function isScreenHandle(value: unknown): value is ScreenHandle {
  return typeof value === 'object' && value !== null && 'screen' in value;
}

/** Title bar, dock and the current screen (docs/02 › Shell, F-30). */
export function Shell() {
  const matches = useMatches();
  const match = matches[matches.length - 1];
  const screen = isScreenHandle(match?.handle) ? match.handle.screen : 'S-01';
  useGlobalShortcuts();
  useLastRouteSaver(routeFor(screen, match?.params ?? {}));
  useDiffColors();
  useShortcutOverrides();

  return (
    <div className={styles.shell}>
      <ScreenTitleBar screen={screen} />
      <div className={styles.body}>
        <Dock active={screenInfo(screen).dock} />
        <main className={styles.content} aria-label={screenInfo(screen).name}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
