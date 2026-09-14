/**
 * Shared row-count limits between rendering (ClassNode.tsx / EnumNode.tsx)
 * and layout size estimation (autoLayout.ts). Kept in one place after a bug
 * where autoLayout.ts's estimateClassNodeSize had no cap at all while
 * ClassNode.tsx capped rendering at 20 visible rows, silently over-estimating
 * height by over 1800px for a 100-attribute class -- see
 * specs/done/layout-calculation-audit-2026-09-14.md.
 */

/** ClassNode.tsx renders at most this many slot rows before a "+N more" row. */
export const CLASS_SLOT_LIMIT = 20;

/** EnumNode.tsx renders at most this many value rows before a "+N more" row. */
export const ENUM_VALUE_LIMIT = 12;
