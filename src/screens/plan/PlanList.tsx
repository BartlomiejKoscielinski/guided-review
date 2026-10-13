import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Segmented } from '../../components/Segmented';
import type { PlanView } from '../../ipc/types/PlanView';
import type { Strategy } from '../../ipc/types/Strategy';
import { SkimRow } from './SkimRow';
import { restrictToVertical } from './restrictToVertical';
import { StepRow } from './StepRow';
import { STRATEGY_OPTIONS, strategyCaption } from './planText';
import styles from './PlanList.module.css';

export interface PlanListProps {
  view: PlanView;
  onStrategy: (strategy: Strategy) => void;
  onReorder: (stepIds: string[]) => void;
}

/**
 * "Plan · N steps" (F-06.3–F-06.6): the strategy toggle and its caption, the rows in the reader's
 * order (drag by the handle, Space and arrows with the keyboard), then the skim rows. The
 * fallback plan (Claude failed) only has File order and doesn't drag.
 */
export function PlanList({ view, onStrategy, onReorder }: PlanListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const { plan, order } = view;
  const fallback = view.fallback !== undefined;
  const byId = new Map(plan.steps.map((s, i) => [s.id, { step: s, stats: view.stepStats[i] }]));
  const rows = order.order.flatMap((id) => {
    const row = byId.get(id);
    return row?.stats ? [{ ...row, stats: row.stats }] : [];
  });
  const scale = Math.max(0, ...rows.map((r) => Math.max(r.stats.additions, r.stats.deletions)));
  const options = STRATEGY_OPTIONS.map((o) => ({
    ...o,
    disabled: fallback && o.value !== 'fileOrder',
  }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = order.order.indexOf(String(active.id));
    const to = order.order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(order.order, from, to));
  };

  return (
    <section className={styles.plan} aria-labelledby="plan-heading">
      <div className={styles.planHead}>
        <div className={styles.planTitle}>
          <h2 id="plan-heading" className={styles.heading}>
            Plan · {rows.length} {rows.length === 1 ? 'step' : 'steps'}
          </h2>
          <span className={styles.caption}>{strategyCaption(order.strategy, order.custom)}</span>
        </div>
        <Segmented<Strategy | 'custom'>
          label="Step order"
          size="section"
          options={options}
          value={order.custom ? 'custom' : order.strategy}
          onChange={(value) => {
            if (value !== 'custom') onStrategy(value);
          }}
        />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVertical]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order.order} strategy={verticalListSortingStrategy}>
          <ol className={styles.list}>
            {rows.map((row, i) => (
              <StepRow
                key={row.step.id}
                step={row.step}
                position={i + 1}
                stats={row.stats}
                scale={scale}
                sortable={!fallback}
              />
            ))}
            {plan.skim.map((group, i) => {
              const stats = view.skimStats[i];
              return stats ? (
                <SkimRow
                  key={group.hunkIds[0] ?? String(i)}
                  group={group}
                  stats={stats}
                  files={view.skimFiles[i] ?? []}
                />
              ) : null;
            })}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  );
}
