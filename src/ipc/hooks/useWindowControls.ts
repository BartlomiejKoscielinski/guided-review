import { useCallback, useEffect, useState } from 'react';
import { useIpc } from '../IpcContext';

export interface WindowControls {
  maximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  startDragging: () => void;
}

function report(action: string) {
  return (error: unknown) => {
    // Window actions only fail when a capability is missing; that is a build error to fix.
    console.error(`Window ${action} failed.`, error);
  };
}

/** Window actions for the custom title bar, through the IPC client (F-30.1). */
export function useWindowControls(): WindowControls {
  const ipc = useIpc();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    ipc
      .windowIsMaximized()
      .then((value) => {
        if (active) setMaximized(value);
      })
      .catch(report('state'));
    ipc
      .onWindowMaximizedChange((value) => {
        if (active) setMaximized(value);
      })
      .then((off) => {
        if (active) unsubscribe = off;
        else off();
      })
      .catch(report('state'));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [ipc]);

  return {
    maximized,
    minimize: useCallback(() => {
      ipc.windowMinimize().catch(report('minimize'));
    }, [ipc]),
    toggleMaximize: useCallback(() => {
      ipc.windowToggleMaximize().catch(report('maximize'));
    }, [ipc]),
    close: useCallback(() => {
      ipc.windowClose().catch(report('close'));
    }, [ipc]),
    startDragging: useCallback(() => {
      ipc.windowStartDragging().catch(report('drag'));
    }, [ipc]),
  };
}
