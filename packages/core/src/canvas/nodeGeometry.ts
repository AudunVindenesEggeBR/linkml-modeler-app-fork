/**
 * Shared layout constants for ClassNode geometry.
 *
 * These values must stay in sync with the CSS-in-JS styles in ClassNode.tsx.
 * Both the node renderer (handle placement) and the auto-layout engine (ELK port
 * positions) import from here so the two never drift apart.
 */

/** Height of the class name header row (flex row with 6px top/bottom padding). */
export const CLASS_HEADER_H = 32;

/** Height of the is_a row when present (3px padding + ~15px text + 3px padding + 1px border). */
export const CLASS_ISA_H = 22;

/** Top padding of the slot body section. */
export const CLASS_BODY_PAD_T = 4;

/** Height of one slot row including its 1px bottom border (minHeight 22 + 1px = 23). */
export const CLASS_SLOT_H = 23;

/**
 * Returns the y-coordinate of the vertical midpoint of slot row at zero-based
 * index `slotIndex` inside an expanded ClassNode.  The coordinate is relative
 * to the top-left corner of the node's root element.
 */
export function classSlotMidY(slotIndex: number, hasIsA: boolean): number {
  return (
    CLASS_HEADER_H +
    (hasIsA ? CLASS_ISA_H : 0) +
    CLASS_BODY_PAD_T +
    slotIndex * CLASS_SLOT_H +
    CLASS_SLOT_H / 2
  );
}

/**
 * One incoming range edge's dedicated connection point on a target node
 * (class or enum) -- see specs/done/range-edge-collision-and-label-visibility.md.
 * Replaces the old shared `side-east`/`side-west` target handle (a single
 * fixed point every incoming range edge converged on, guaranteeing overlap
 * whenever more than one class referenced the same target) with one handle
 * per (source, slotName) pair, spread along the target's east/west side.
 */
export interface IncomingRangeHandle {
  /** Handle id to render on the target node and reference as the edge's targetHandle. */
  id: string;
  /** Which side of the target node this handle sits on. */
  side: 'east' | 'west';
  source: string;
  slotName: string;
}

/**
 * Evenly distributes `count` incoming-handle dots along a node's vertical
 * extent as a CSS percentage `top` value, inset from the very top/bottom
 * edge so none sit under the header or right at the card boundary.
 */
export function incomingHandleTopPercent(index: number, count: number): string {
  const pct = 10 + ((index + 1) / (count + 1)) * 80;
  return `${pct}%`;
}
