import { cx } from '../../components/cx';
import { Segmented } from '../../components/Segmented';
import { Switch } from '../../components/Switch';
import { useSettings, useUpdateSettings } from '../../ipc/hooks/useSettings';
import type { DiffColors } from '../../ipc/types/DiffColors';
import type { Layout } from '../../ipc/types/Layout';
import type { Mode } from '../../ipc/types/Mode';
import styles from './Settings.module.css';

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'focus', label: 'Focus' },
  { value: 'detailed', label: 'Detailed' },
];

const LAYOUTS: readonly { value: Layout; label: string }[] = [
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
];

const COLORS: readonly { value: DiffColors; label: string }[] = [
  { value: 'blue-orange', label: 'Blue · orange' },
  { value: 'green-red', label: 'Green · red' },
];

/**
 * Settings › General (F-19.1, Settings.dc.html `{"section":"general"}`). Changes save
 * immediately. Start with Windows is saved now and applied by M10's autostart (M4 decision 1);
 * the tray row comes with its behaviour in M10 (M4 decision 2).
 */
export function GeneralSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const data = settings.data;
  return (
    <div className={cx(styles.content, styles.contentGeneral)}>
      <h1 className={styles.h1}>General</h1>
      {settings.error && !data && (
        <p role="alert" className={styles.error}>
          {settings.error.message}
        </p>
      )}
      {data && (
        <div className={cx(styles.grid, styles.gridGeneral)}>
          <span className={styles.label}>Start in</span>
          <Segmented
            label="Start in"
            options={MODES}
            value={data.ui.startIn}
            onChange={(startIn) => {
              update.mutate({ ui: { startIn } });
            }}
          />
          <span className={styles.label}>Focus layout</span>
          <Segmented
            label="Focus layout"
            options={LAYOUTS}
            value={data.ui.focusLayout}
            onChange={(focusLayout) => {
              update.mutate({ ui: { focusLayout } });
            }}
          />
          <span className={styles.label}>Diff colors</span>
          <Segmented
            label="Diff colors"
            options={COLORS}
            value={data.ui.diffColors}
            onChange={(diffColors) => {
              update.mutate({ ui: { diffColors } });
            }}
          />
          <span id="gen-autostart-l" className={styles.label}>
            Start with Windows
          </span>
          <Switch
            labelledBy="gen-autostart-l"
            checked={data.os.startWithWindows}
            onChange={(startWithWindows) => {
              update.mutate({ os: { startWithWindows } });
            }}
          />
        </div>
      )}
      {update.error && (
        <p role="alert" className={styles.error}>
          {update.error.message}
        </p>
      )}
    </div>
  );
}
