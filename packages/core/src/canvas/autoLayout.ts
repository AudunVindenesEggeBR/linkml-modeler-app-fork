/**
 * Auto-layout engine using elkjs (Eclipse Layout Kernel).
 *
 * Produces a CanvasLayout by running the ELK `layered` (Sugiyama-style)
 * algorithm over the schema's class/enum graph.
 *
 * Usage:
 *   const layout = await runAutoLayout(schema, {}, ghostEntities);
 *   store.setNodes(deriveGraph(schema, layout).nodes);
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api.js';
import type { LinkMLSchema, CanvasLayout, EdgeLayout, ClassDefinition, EnumDefinition } from '../model/index.js';
import type { ImportedEntity } from '../io/importResolver.js';

// Node dimensions used for layout calculations. ClassNode/EnumNode have no
// fixed height -- they grow with the number of attributes/values rendered
// (each row ~22-23px, see ClassNode.tsx's slotRow / EnumNode.tsx's valueRow
// minHeight). Feeding ELK a fixed height regardless of content caused real
// visual overlap for any class/enum with more than a handful of entries, so
// height is estimated from actual content below rather than held constant.
// Width: use each card's CSS `maxWidth` (ClassNode.tsx / EnumNode.tsx), not
// `minWidth` -- a class/enum with long attribute/value names renders wider
// than a small fixed guess, up to that cap (text never wraps, see below), so
// assuming anything less than the cap risks the same overlap bug the height
// fix addresses: ELK would place a neighbour based on a box smaller than
// what actually renders. This trades a little unused horizontal space for
// classes with short names against guaranteeing no width-driven overlap.
const CLASS_W = 320; // ClassNode.tsx wrapper maxWidth
const CLASS_H = 120; // floor only -- see estimateClassNodeSize
const ENUM_W = 280; // EnumNode.tsx wrapper maxWidth
const ENUM_H = 80; // floor only -- see estimateEnumNodeSize

// Measured from ClassNode.tsx / EnumNode.tsx style objects: header padding
// '6px 10px' + fontSize 13, body padding '4px 0', each row minHeight 22 + 1px
// border. Row text is ellipsis-truncated (never wraps), so row height stays
// constant regardless of content length -- these constants are safe to use
// as a fixed multiplier rather than needing real DOM measurement.
const HEADER_H = 34;
const ISA_ROW_H = 24; // ClassNode's extra is_a row, only present when classDef.isA is set
const BODY_PADDING = 8;
const ROW_H = 23;
const ENUM_VALUE_LIMIT = 12; // EnumNode caps visible rows and adds a "+N more" row beyond this

/**
 * Estimate a class node's rendered size from its actual attribute count,
 * rather than assuming a fixed box -- see the module-level comment on
 * CLASS_H for why a fixed height caused overlapping nodes.
 */
export function estimateClassNodeSize(classDef: ClassDefinition): { width: number; height: number } {
  const attrCount = Object.keys(classDef.attributes).length;
  const height = HEADER_H + (classDef.isA ? ISA_ROW_H : 0) + BODY_PADDING + attrCount * ROW_H;
  return { width: CLASS_W, height: Math.max(height, CLASS_H) };
}

/**
 * Estimate an enum node's rendered size from its actual permissible-value
 * count (capped the same way EnumNode itself caps visible rows).
 */
export function estimateEnumNodeSize(enumDef: EnumDefinition): { width: number; height: number } {
  const valueCount = Object.keys(enumDef.permissibleValues).length;
  const visibleRows = Math.min(valueCount, ENUM_VALUE_LIMIT) + (valueCount > ENUM_VALUE_LIMIT ? 1 : 0);
  const height = HEADER_H + BODY_PADDING + visibleRows * ROW_H;
  return { width: ENUM_W, height: Math.max(height, ENUM_H) };
}

const elk = new ELK();

export interface AutoLayoutOptions {
  /** ELK algorithm — defaults to layered (Sugiyama) */
  algorithm?: string;
  /**
   * Direction: TB | BT | LR | RL (conventional flowchart-library naming,
   * e.g. Mermaid/dagre). Translated to ELK's own `elk.direction` enum
   * (DOWN|UP|RIGHT|LEFT) via DIRECTION_TO_ELK below -- ELK does not
   * recognize "TB" etc. itself and silently ignores an unrecognized value
   * rather than erroring, which is why passing these strings straight
   * through here previously had no effect at all.
   */
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
  /**
   * ELK's `elk.layered.layering.strategy` value, passed through verbatim
   * (unlike `direction`, these ARE ELK's own real enum names already).
   * Limited to LAYERING_STRATEGIES below -- ELK's full enum also includes
   * BF_MODEL_ORDER/DF_MODEL_ORDER, which were verified (empirically, by
   * actually running elk.layout() with each candidate value against a test
   * graph -- see the retired debug test this was checked with) to throw
   * ("Cannot read properties of null") on a plain graph with no model-order
   * metadata, which this app never supplies. Do not add them to the picker
   * without also supplying whatever model-order data they need.
   */
  layeringStrategy?: typeof LAYERING_STRATEGIES[number];
  /**
   * ELK's `elk.edgeRouting` value, passed through verbatim. All three real
   * values (EDGE_ROUTINGS below) were verified (empirically, against the
   * bundled elkjs) to run without crashing and produce genuinely different
   * bend-point output -- none are silently ignored the way `direction`'s
   * old TB/BT/LR/RL strings were.
   */
  edgeRouting?: typeof EDGE_ROUTINGS[number];
  /**
   * ELK's `elk.layered.nodePlacement.strategy` value (x-position *within* a
   * layer -- distinct from layeringStrategy, which decides *which* layer a
   * node is in). All four values (NODE_PLACEMENT_STRATEGIES below) verified
   * empirically to run without crashing.
   */
  nodePlacementStrategy?: typeof NODE_PLACEMENT_STRATEGIES[number];
  /** Spacing between nodes */
  nodeNodeSpacing?: number;
  /** Spacing between hierarchy levels */
  layerSpacing?: number;
}

const DIRECTION_TO_ELK: Record<NonNullable<AutoLayoutOptions['direction']>, string> = {
  TB: 'DOWN',
  BT: 'UP',
  LR: 'RIGHT',
  RL: 'LEFT',
};

export const LAYERING_STRATEGIES = [
  'NETWORK_SIMPLEX',
  'LONGEST_PATH',
  'LONGEST_PATH_SOURCE',
  'COFFMAN_GRAHAM',
  'INTERACTIVE',
  'STRETCH_WIDTH',
  'MIN_WIDTH',
] as const;

/**
 * The subset of LAYERING_STRATEGIES actually offered in the UI picker.
 * Verified empirically (diamond test graph, throwaway debug test) that the
 * 7 strategies above collapse into just 3 distinct outcomes:
 *   {NETWORK_SIMPLEX, COFFMAN_GRAHAM}          -- y=292 for the diamond's
 *   {LONGEST_PATH, STRETCH_WIDTH, MIN_WIDTH}   -- y=432   shorter branch
 *   {LONGEST_PATH_SOURCE, INTERACTIVE}         -- y=152
 * A user found it confusing that differently-named options (INTERACTIVE,
 * NETWORK_SIMPLEX among them) produced pixel-identical or near-identical
 * layouts on their schema. The user explicitly asked to remove only
 * NETWORK_SIMPLEX and INTERACTIVE -- not the further reduction to 2 options
 * that was separately proposed (and briefly, mistakenly implemented before
 * being reverted -- see specs/backlog/canvas-layout-topdown.md, "Runde 9c").
 * COFFMAN_GRAHAM/STRETCH_WIDTH/MIN_WIDTH stay in the picker even though they
 * duplicate another option's cluster, since the user didn't ask for those
 * to be removed.
 */
export const LAYERING_STRATEGY_UI_OPTIONS = [
  'LONGEST_PATH',
  'LONGEST_PATH_SOURCE',
  'COFFMAN_GRAHAM',
  'STRETCH_WIDTH',
  'MIN_WIDTH',
] as const;

export const EDGE_ROUTINGS = ['ORTHOGONAL', 'POLYLINE', 'SPLINES'] as const;

export const NODE_PLACEMENT_STRATEGIES = [
  'BRANDES_KOEPF',
  'LINEAR_SEGMENTS',
  'NETWORK_SIMPLEX',
  'SIMPLE',
] as const;

// Named nodeNodeSpacing/layerSpacing pairs for the toolbar's spacing picker.
// "normal" is the pair widened from the original 40/80 (see below) once tight
// spacing was found to leave orthogonal edges no room to route around node
// boundaries, making them hard to trace even once overlap itself was fixed.
export const SPACING_PRESETS = {
  compact: { nodeNodeSpacing: 40, layerSpacing: 80 },
  normal: { nodeNodeSpacing: 70, layerSpacing: 140 },
  spacious: { nodeNodeSpacing: 110, layerSpacing: 220 },
  extraSpacious: { nodeNodeSpacing: 160, layerSpacing: 320 },
} as const;

const DEFAULT_OPTIONS: Required<AutoLayoutOptions> = {
  algorithm: 'layered',
  direction: 'TB',
  layeringStrategy: 'LONGEST_PATH',
  edgeRouting: 'ORTHOGONAL',
  nodePlacementStrategy: 'BRANDES_KOEPF',
  ...SPACING_PRESETS.normal,
};

export async function runAutoLayout(
  schema: LinkMLSchema,
  opts: AutoLayoutOptions = {},
  ghostEntities: ImportedEntity[] = [],
  hiddenEdgeTypes: ReadonlySet<string> = new Set(),
  hideTreeRootRangeEdges = false
): Promise<CanvasLayout> {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  const elkNodes: ElkNode[] = [];
  const elkEdges: ElkExtendedEdge[] = [];
  const edgeSeen = new Set<string>();

  // ── Add class nodes ────────────────────────────────────────────────────────
  for (const [className, classDef] of Object.entries(schema.classes)) {
    elkNodes.push({
      id: className,
      ...estimateClassNodeSize(classDef),
    });
  }

  // ── Add enum nodes ─────────────────────────────────────────────────────────
  for (const [enumName, enumDef] of Object.entries(schema.enums)) {
    elkNodes.push({
      id: enumName,
      ...estimateEnumNodeSize(enumDef),
    });
  }

  const localIds = new Set([
    ...Object.keys(schema.classes),
    ...Object.keys(schema.enums),
  ]);

  // ── Add imported entities as flat leaf nodes ──────────────────────────────
  const allImportedIds = new Set<string>();
  for (const entity of ghostEntities) {
    if (localIds.has(entity.name)) continue; // skip if local definition exists
    allImportedIds.add(entity.name);
    const size = entity.type === 'class'
      ? estimateClassNodeSize(entity.schema.classes[entity.name])
      : estimateEnumNodeSize(entity.schema.enums[entity.name]);
    elkNodes.push({ id: entity.name, ...size });
  }

  // All known IDs for edge validation
  const allIds = new Set([...localIds, ...allImportedIds]);

  // ── Add edges from class relationships ────────────────────────────────────
  for (const [className, classDef] of Object.entries(schema.classes)) {
    // is_a — feed ELK with parent as source so it lays the parent above the child
    if (!hiddenEdgeTypes.has('is_a') && classDef.isA && allIds.has(classDef.isA)) {
      addEdge(elkEdges, edgeSeen, `isa__${className}__${classDef.isA}`, classDef.isA, className);
    }

    // mixins — same reversal so mixin parents render above children
    if (!hiddenEdgeTypes.has('mixin')) {
      for (const m of classDef.mixins) {
        if (allIds.has(m)) {
          addEdge(elkEdges, edgeSeen, `mixin__${className}__${m}`, m, className);
        }
      }
    }

    // union_of
    if (!hiddenEdgeTypes.has('union_of') && classDef.unionOf) {
      for (const u of classDef.unionOf) {
        if (allIds.has(u)) {
          addEdge(elkEdges, edgeSeen, `union__${className}__${u}`, className, u);
        }
      }
    }

    // range edges always feed the layout, regardless of rangeEdgesMode --
    // that setting only controls whether they're drawn as edges vs. inline
    // chips on the canvas (see deriveGraph.ts). Without them in the layout
    // graph, classes connected only by range (not is_a/mixin) get no
    // hierarchical placement at all, which reads as scattered/undirected.
    if (!hiddenEdgeTypes.has('range') && !(hideTreeRootRangeEdges && classDef.treeRoot)) {
      for (const [slotName, slot] of Object.entries(classDef.attributes)) {
        if (!slot.range || !allIds.has(slot.range)) continue;
        addEdge(
          elkEdges,
          edgeSeen,
          `range__${className}__${slotName}__${slot.range}`,
          className,
          slot.range
        );
      }
    }
  }

  // ── Build ELK graph ────────────────────────────────────────────────────────
  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': options.algorithm,
      'elk.direction': DIRECTION_TO_ELK[options.direction],
      'elk.spacing.nodeNode': String(options.nodeNodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing),
      'elk.edgeRouting': options.edgeRouting,
      'elk.layered.nodePlacement.strategy': options.nodePlacementStrategy,
      // Crossing minimization is one of the three phases the layered
      // algorithm runs (layering, crossing minimization, node placement) --
      // it was already active at ELK's own default settings, just not
      // tuned. LAYER_SWEEP is ELK's default heuristic; explicit here so the
      // intent is documented rather than implicit. Crossing minimization is
      // NP-hard in general, so this reduces crossings, it doesn't guarantee
      // a crossing-free result for a densely cross-linked schema (e.g. many
      // range edges pointing across unrelated branches of the is_a tree).
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      // Raise thoroughness (default 7) so the heuristic spends more effort
      // searching for a lower-crossing layer ordering. Cost is more compute
      // per layout run, acceptable at the scale of a LinkML schema's class
      // count; revisit if Layout becomes noticeably slow on very large
      // schemas.
      'elk.layered.thoroughness': '30',
      // LONGEST_PATH (the default here) pushes each node to the deepest
      // layer its ancestors allow, maximizing vertical stacking -- ELK's own
      // default (NETWORK_SIMPLEX) instead favors a compact/wide result,
      // which reads as flatter and less clearly top-down. User-selectable
      // (see LAYERING_STRATEGIES) via SchemaCanvas.tsx's toolbar.
      'elk.layered.layering.strategy': options.layeringStrategy,
      // Extra breathing room around edges specifically (distinct from
      // node-node spacing above) -- without this, orthogonal edges route
      // right up against node boundaries and each other, making them hard
      // to trace visually even when nodes themselves don't overlap.
      'elk.spacing.edgeNode': '20',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.spacing.edgeEdge': '15',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '15',
    },
    children: elkNodes,
    edges: elkEdges,
  };

  try {
    const result = await elk.layout(elkGraph);
    return elkResultToLayout(result);
  } catch (err) {
    // Fallback: return empty layout so grid positions are used
    console.warn('[AutoLayout] ELK layout failed, falling back to grid:', err);
    return { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } };
  }
}

function addEdge(
  edges: ElkExtendedEdge[],
  seen: Set<string>,
  id: string,
  source: string,
  target: string
) {
  if (seen.has(id)) return;
  seen.add(id);
  edges.push({ id, sources: [source], targets: [target] });
}

/**
 * Extract absolute positions from ELK result. Also captures per-edge bend points.
 */
function elkResultToLayout(elkNode: ElkNode): CanvasLayout {
  const layout: CanvasLayout = {
    nodes: {},
    edges: {},
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  function extractPositions(node: ElkNode, offsetX: number, offsetY: number) {
    for (const child of node.children ?? []) {
      const absX = (child.x ?? 0) + offsetX;
      const absY = (child.y ?? 0) + offsetY;
      layout.nodes[child.id] = { x: absX, y: absY };
      if (child.children?.length) {
        extractPositions(child, absX, absY);
      }
    }
  }

  extractPositions(elkNode, 0, 0);

  // Extract bend points from routed edges (only intermediate points; start/end
  // are discarded in favour of ReactFlow's live handle coordinates).
  for (const edge of elkNode.edges ?? []) {
    const section = (edge as ElkExtendedEdge & { sections?: Array<{ bendPoints?: Array<{ x: number; y: number }> }> }).sections?.[0];
    const bendPoints = section?.bendPoints;
    if (bendPoints && bendPoints.length > 0) {
      const edgeLayout: EdgeLayout = { bendPoints };
      layout.edges![edge.id] = edgeLayout;
    }
  }

  return layout;
}

/**
 * Merge a computed layout with user-adjusted positions stored in a sidecar.
 * User positions take precedence over auto-layout positions.
 */
export function mergeLayouts(
  autoLayout: CanvasLayout,
  sidecar: CanvasLayout
): CanvasLayout {
  return {
    nodes: { ...autoLayout.nodes, ...sidecar.nodes },
    viewport: sidecar.viewport ?? autoLayout.viewport,
  };
}
