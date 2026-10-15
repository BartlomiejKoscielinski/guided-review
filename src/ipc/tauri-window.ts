import { getCurrentWindow } from '@tauri-apps/api/window';
import type { IpcClient } from './client';
import { toIpcError } from './errors';

type WindowControls = Pick<
  IpcClient,
  | 'windowMinimize'
  | 'windowToggleMaximize'
  | 'windowClose'
  | 'windowStartDragging'
  | 'windowIsMaximized'
  | 'onWindowMaximizedChange'
>;

async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    throw toIpcError(error);
  }
}

/**
 * Window controls through the Tauri window API. Needs the capabilities
 * core:window:allow-minimize, -toggle-maximize, -close and -start-dragging
 * (is-maximized is in core:window:default, the resize event in core:event:default).
 */
export function createTauriWindowControls(): WindowControls {
  const win = () => getCurrentWindow();
  return {
    windowMinimize: () => run(() => win().minimize()),
    windowToggleMaximize: () => run(() => win().toggleMaximize()),
    windowClose: () => run(() => win().close()),
    windowStartDragging: () => run(() => win().startDragging()),
    windowIsMaximized: () => run(() => win().isMaximized()),
    onWindowMaximizedChange: (listener) =>
      run(async () => {
        let last: boolean | undefined;
        return win().onResized(() => {
          void win()
            .isMaximized()
            .then((maximized) => {
              if (maximized !== last) {
                last = maximized;
                listener(maximized);
              }
            })
            // A failed query during a resize changes nothing; the next resize event asks again.
            .catch(() => undefined);
        });
      }),
  };
}
