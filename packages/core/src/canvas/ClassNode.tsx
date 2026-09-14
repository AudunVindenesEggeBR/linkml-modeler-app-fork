import React, { memo, useEffect } from 'react';
import { Handle, Position, NodeProps, useUpdateNodeInternals } from 'reactflow';
import type { CanvasNodeData } from '../store/slices/canvasSlice.js';
import type { ClassDefinition, SlotDefinition } from '../model/index.js';
import type { RangeEdgesMode } from '../store/slices/uiSlice.js';
import { useAppStore } from '../store/index.js';
import { ArrowUp, Hexagon, Plus } from '../ui/icons/index.js';
import { classSlotMidY, incomingHandleTopPercent, type IncomingRangeHandle } from './nodeGeometry.js';
import { CLASS_SLOT_LIMIT } from './nodeLimits.js';

export interface ResolvedSlot {
  slot: SlotDefinition;
  kind: 'attribute' | 'schema'; // A = inline attribute, S = schema-level slot reference
  hasUsageOverride?: boolean;   // true when slot_usage overrides exist for this slot
  inherited?: boolean;          // true when slot comes from is_a / mixin ancestor
  inheritedFrom?: string;       // name of the immediate ancestor that contributes this slot
  rangeIsEntity?: boolean;      // true when range is a class or enum in the schema
}

export interface ClassNodeData extends CanvasNodeData {
  entityType: 'class';
  classDef: ClassDefinition;
  collapsed: boolean;
  imported?: boolean; // True for read-only imported classes
  importSourceFile?: string; // Source file path — set when imported: true
  resolvedSlots?: ResolvedSlot[]; // Pre-merged, alphabetically sorted for display
  rangeEdgesMode?: RangeEdgesMode; // Controls range rendering: show as edges, inline chips, or auto
  /** One dedicated handle per incoming range edge -- see nodeGeometry.ts's IncomingRangeHandle doc comment. */
  incomingRangeHandles?: IncomingRangeHandle[];
}

const SLOT_LIMIT_EXPANDED = CLASS_SLOT_LIMIT;

function SlotRow({
  resolved,
  isSelfRef,
  showInlineRange,
  onFocusRange,
}: {
  resolved: ResolvedSlot;
  isSelfRef?: boolean;
  showInlineRange?: boolean;
  onFocusRange?: (rangeName: string) => void;
}) {
  const { slot, kind, hasUsageOverride, inherited, inheritedFrom, rangeIsEntity } = resolved;
  const badges: string[] = [];
  if (slot.required) badges.push('R');
  if (slot.multivalued) badges.push('M');
  if (slot.identifier) badges.push('id');

  const kindBadgeStyle: React.CSSProperties = {
    ...styles.badge,
    background: inherited
      ? 'var(--color-bg-surface)'
      : kind === 'schema' ? 'var(--color-state-info-bg)' : 'var(--color-bg-surface)',
    color: inherited
      ? 'var(--color-fg-muted)'
      : kind === 'schema' ? 'var(--color-state-info-fg)' : 'var(--color-fg-secondary)',
  };

  const rowStyle = inherited
    ? { ...styles.slotRow, opacity: 0.55 }
    : styles.slotRow;

  const renderRangeChip = showInlineRange && rangeIsEntity && slot.range && !isSelfRef;

  return (
    <div style={rowStyle} title={inherited && inheritedFrom ? `Inherited from ${inheritedFrom}` : undefined}>
      <span style={styles.slotPlus}><Plus size={10} /></span>
      <span style={inherited ? styles.slotNameInherited : styles.slotName}>{slot.name}</span>
      {slot.range && (
        <>
          <span style={styles.slotColon}> : </span>
          {renderRangeChip ? (
            <button
              style={inherited ? styles.rangeChipInherited : styles.rangeChip}
              title={`Focus ${slot.range}`}
              onClick={(e) => { e.stopPropagation(); onFocusRange?.(slot.range!); }}
            >
              {slot.range} →
            </button>
          ) : (
            <span style={inherited ? styles.slotRangeInherited : styles.slotRange}>{slot.range}</span>
          )}
        </>
      )}
      <span style={styles.badgeGroup}>
        {inherited && (
          <span style={{ ...styles.badge, background: 'var(--color-bg-surface)', color: 'var(--color-fg-muted)' }} title={inheritedFrom ? `from ${inheritedFrom}` : 'inherited'}><ArrowUp size={10} /></span>
        )}
        <span style={kindBadgeStyle}>{kind === 'schema' ? 'S' : 'A'}</span>
        {hasUsageOverride && <span style={{ ...styles.badge, color: 'var(--color-state-warning)' }}>~</span>}
        {badges.map((b) => (
          <span key={b} style={styles.badge}>{b}</span>
        ))}
        {isSelfRef && (
          <span
            style={{ ...styles.badge, color: 'var(--color-state-warning)', cursor: 'help' }}
            title={`Self-reference: range=${slot.range}${slot.multivalued ? ', multivalued' : ''}${slot.required ? ', required' : ''}`}
          >↻</span>
        )}
      </span>
    </div>
  );
}

function ClassNode({ id, data, selected }: NodeProps<ClassNodeData>) {
  const { classDef, collapsed, imported, resolvedSlots: resolvedSlotsProp, rangeEdgesMode } = data;
  const requestFocusNode = useAppStore((s) => s.requestFocusNode);

  const showInlineRange = rangeEdgesMode === 'inline' || rangeEdgesMode === 'auto';

  const isAbstract = classDef.abstract === true;
  const isMixin = classDef.mixin === true;

  const headerBg = imported
    ? 'var(--color-class-ghost)'
    : isMixin
    ? 'var(--color-class-mixin)'
    : isAbstract
    ? 'var(--color-class-abstract)'
    : 'var(--color-class-concrete)';

  const typeLabel = imported ? 'imported' : isMixin ? 'mixin' : isAbstract ? 'abstract' : null;

  // Fall back to plain attributes if resolvedSlots not provided (e.g. ghost nodes)
  const resolvedSlots: ResolvedSlot[] = resolvedSlotsProp ??
    Object.values(classDef.attributes).map((s) => ({ slot: s, kind: 'attribute' as const }));
  const visibleSlots = collapsed ? [] : resolvedSlots.slice(0, SLOT_LIMIT_EXPANDED);
  const hiddenCount = collapsed ? 0 : Math.max(0, resolvedSlots.length - SLOT_LIMIT_EXPANDED);

  // Whether the is_a row is rendered (affects slot y-offsets for handle placement).
  const hasIsA = !collapsed && !!classDef.isA;

  // Incoming range-edge handles, split into east/west groups and evenly
  // spread along each side -- see nodeGeometry.ts's IncomingRangeHandle doc.
  const incomingRangeHandles = data.incomingRangeHandles ?? [];
  const incomingEast = incomingRangeHandles.filter((h) => h.side === 'east');
  const incomingWest = incomingRangeHandles.filter((h) => h.side === 'west');
  const incomingHandleKey = incomingRangeHandles.map((h) => h.id).join('|');

  // ReactFlow caches each node's handle positions from its initial DOM
  // measurement. Unlike the old, always-identical side-east/side-west
  // handles, this node's actual set of incoming-edge handles now changes
  // as classes get dragged around (an edge's target side flips between
  // east/west depending on relative x position -- see rangeTargetEntrySide
  // in deriveGraph.ts) -- without telling ReactFlow to re-measure, it keeps
  // using stale bounds, and any edge referencing a handle id that didn't
  // exist at last measurement silently fails to render. Confirmed: this
  // exactly reproduced as "edges to a lower-x target disappear until you
  // drag it to x >= source, RL layout showing almost no edges at all" --
  // see specs/done/range-edge-collision-and-label-visibility.md.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, incomingHandleKey, updateNodeInternals]);

  return (
    <div
      style={{
        ...styles.wrapper,
        ...(imported ? styles.importedWrapper : {}),
        outline: selected ? '2px solid var(--color-accent-hover)' : '1px solid var(--color-border-default)',
      }}
    >
      {/* Target handle (top) — for is_a / mixin / union_of edges pointing into this node */}
      <Handle
        type="target"
        position={Position.Top}
        style={styles.handle}
      />

      {/* Generic side handles — source only now: used for outgoing range
          edges when this node is collapsed (falls back to a single shared
          point per side, same as before). No longer used as a range-edge
          TARGET -- see the dedicated per-incoming-edge handles below, which
          replace the old shared side-east/side-west target point that every
          incoming range edge converged on regardless of how many there were. */}
      <Handle
        type="source"
        id="side-east"
        position={Position.Right}
        style={styles.sideHandle}
      />
      <Handle
        type="source"
        id="side-west"
        position={Position.Left}
        style={styles.sideHandle}
      />

      {/* One dedicated target handle per incoming range edge, spread evenly
          along each side -- see specs/done/range-edge-collision-and-label-visibility.md. */}
      {incomingEast.map((h, i) => (
        <Handle
          key={h.id}
          type="target"
          id={h.id}
          position={Position.Right}
          style={{ ...styles.sideHandle, top: incomingHandleTopPercent(i, incomingEast.length) }}
        />
      ))}
      {incomingWest.map((h, i) => (
        <Handle
          key={h.id}
          type="target"
          id={h.id}
          position={Position.Left}
          style={{ ...styles.sideHandle, top: incomingHandleTopPercent(i, incomingWest.length) }}
        />
      ))}

      {/* Header */}
      <div style={{ ...styles.header, background: headerBg }}>
        <span style={styles.nodeIcon}><Hexagon size={14} /></span>
        <span style={isAbstract ? { ...styles.headerTitle, fontStyle: 'italic' } : styles.headerTitle}>
          {classDef.name}
        </span>
        {typeLabel && <span style={styles.typeBadge}>[{typeLabel}]</span>}
      </div>

      {/* is_a */}
      {classDef.isA && !collapsed && (
        <div style={styles.isaRow}>
          <span style={styles.isaLabel}>is_a: </span>
          <span style={styles.isaValue}>{classDef.isA}</span>
        </div>
      )}

      {/* Slots */}
      {!collapsed && (
        <div style={styles.body}>
          {visibleSlots.map((r) => (
            <SlotRow
              key={r.slot.name}
              resolved={r}
              isSelfRef={r.slot.range === data.entityId}
              showInlineRange={showInlineRange}
              onFocusRange={requestFocusNode}
            />
          ))}
          {hiddenCount > 0 && (
            <div style={styles.moreRow}>+{hiddenCount} more…</div>
          )}
          {visibleSlots.length === 0 && resolvedSlots.length === 0 && (
            <div style={styles.emptyRow}>no slots</div>
          )}
        </div>
      )}

      {/* Per-slot side handles for range edges — only when expanded and not inlined.
          Added for each own (non-inherited) slot that declares a range.
          Both east and west handles exist; deriveGraph picks the side facing the target. */}
      {!collapsed && visibleSlots.map((r, i) => {
        if (r.inherited || !r.slot.range) return null;
        if (showInlineRange && r.rangeIsEntity) return null; // handle suppressed when rendered inline
        const y = classSlotMidY(i, hasIsA);
        return (
          <React.Fragment key={r.slot.name}>
            <Handle
              type="source"
              id={`slot-east-${r.slot.name}`}
              position={Position.Right}
              style={{ ...styles.slotHandle, top: y }}
            />
            <Handle
              type="source"
              id={`slot-west-${r.slot.name}`}
              position={Position.Left}
              style={{ ...styles.slotHandle, top: y }}
            />
          </React.Fragment>
        );
      })}

      {/* Source handle (bottom) — for outgoing is_a / mixin edges when this node is parent */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={styles.handle}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: 'var(--color-bg-surface)',
    borderRadius: 6,
    minWidth: 200,
    maxWidth: 320,
    boxShadow: 'var(--shadow-md)',
    fontFamily: 'var(--font-family-mono)',
    fontSize: 12,
    color: 'var(--color-fg-primary)',
    overflow: 'hidden',
  },
  importedWrapper: {
    background: 'var(--color-class-ghost)',
    /* No opacity — token bg color provides distinction in both themes */
  },
  handle: {
    background: 'var(--color-accent-hover)',
    width: 8,
    height: 8,
    border: '2px solid var(--color-border-subtle)',
  },
  /** Subtle dot on the side of the node; always rendered for range-edge routing. */
  sideHandle: {
    background: 'var(--color-fg-muted)',
    width: 5,
    height: 5,
    border: '1px solid var(--color-border-subtle)',
    opacity: 0.5,
  },
  /** Tiny dot at each slot row's right/left edge — marks a specific connection point. */
  slotHandle: {
    background: 'var(--color-state-success)',
    width: 5,
    height: 5,
    border: '1px solid var(--color-border-subtle)',
    opacity: 0.6,
    // `top` is set inline per-slot via classSlotMidY; `transform: translateY(-50%)` from
    // ReactFlow's class centers the dot on that y coordinate.
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    color: 'var(--color-fg-on-accent)',
    fontWeight: 600,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  nodeIcon: {
    opacity: 0.8,
    display: 'flex',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  typeBadge: {
    fontSize: 10,
    background: 'rgba(255,255,255,0.2)',
    borderRadius: 3,
    padding: '1px 4px',
    flexShrink: 0,
  },
  isaRow: {
    padding: '3px 10px',
    borderBottom: '1px solid var(--color-border-default)',
    fontSize: 11,
    color: 'var(--color-fg-secondary)',
    background: 'var(--color-bg-surface-raised)',
  },
  isaLabel: {
    color: 'var(--color-fg-muted)',
  },
  isaValue: {
    color: 'var(--color-state-info-fg)',
  },
  body: {
    padding: '4px 0',
  },
  slotRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '2px 10px',
    gap: 2,
    borderBottom: '1px solid var(--color-border-subtle)',
    minHeight: 22,
  },
  slotPlus: {
    color: 'var(--color-fg-muted)',
    marginRight: 2,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
  },
  slotName: {
    color: 'var(--color-fg-primary)',
    flex: '0 1 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  slotNameInherited: {
    color: 'var(--color-fg-muted)',
    flex: '0 1 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  slotColon: {
    color: 'var(--color-fg-muted)',
    flexShrink: 0,
  },
  slotRange: {
    color: 'var(--color-state-success-fg)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  slotRangeInherited: {
    color: 'var(--color-fg-muted)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rangeChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 11,
    fontFamily: 'inherit',
    background: 'var(--color-state-success-bg, rgba(34,197,94,0.12))',
    color: 'var(--color-state-success-fg)',
    border: '1px solid var(--color-state-success-fg)',
    borderRadius: 3,
    padding: '0 4px',
    cursor: 'pointer',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    textAlign: 'left',
  },
  rangeChipInherited: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 11,
    fontFamily: 'inherit',
    background: 'var(--color-bg-surface)',
    color: 'var(--color-fg-muted)',
    border: '1px solid var(--color-border-default)',
    borderRadius: 3,
    padding: '0 4px',
    cursor: 'pointer',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    textAlign: 'left',
  },
  badgeGroup: {
    display: 'flex',
    gap: 2,
    flexShrink: 0,
    marginLeft: 4,
  },
  badge: {
    fontSize: 9,
    background: 'var(--color-border-default)',
    borderRadius: 3,
    padding: '0 3px',
    color: 'var(--color-fg-secondary)',
  },
  moreRow: {
    padding: '3px 10px',
    color: 'var(--color-fg-muted)',
    fontStyle: 'italic',
    fontSize: 11,
  },
  emptyRow: {
    padding: '4px 10px',
    color: 'var(--color-border-strong)',
    fontStyle: 'italic',
  },
};

export default memo(ClassNode);
