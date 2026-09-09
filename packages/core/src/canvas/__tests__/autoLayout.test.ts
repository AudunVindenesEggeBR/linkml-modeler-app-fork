import { describe, it, expect } from 'vitest';
import { runAutoLayout, estimateClassNodeSize, estimateEnumNodeSize, LAYERING_STRATEGIES, EDGE_ROUTINGS, NODE_PLACEMENT_STRATEGIES } from '../autoLayout.js';
import {
  emptySchema,
  emptyClassDefinition,
  emptySlotDefinition,
  emptyEnumDefinition,
} from '../../model/index.js';
import type { LinkMLSchema } from '../../model/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function classWithAttributes(name: string, attrCount: number, isA?: string) {
  const classDef = emptyClassDefinition(name);
  if (isA) classDef.isA = isA;
  for (let i = 0; i < attrCount; i++) {
    classDef.attributes[`attr_${i}`] = emptySlotDefinition(`attr_${i}`);
  }
  return classDef;
}

interface Box { x1: number; y1: number; x2: number; y2: number; }

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

// ── estimateClassNodeSize ────────────────────────────────────────────────────

describe('estimateClassNodeSize', () => {
  it('grows height with attribute count', () => {
    const small = estimateClassNodeSize(classWithAttributes('Small', 2));
    const large = estimateClassNodeSize(classWithAttributes('Large', 15));
    expect(large.height).toBeGreaterThan(small.height);
  });

  it('adds extra height when the class has an is_a parent', () => {
    const withoutParent = estimateClassNodeSize(classWithAttributes('Child', 3));
    const withParent = estimateClassNodeSize(classWithAttributes('Child', 3, 'Parent'));
    expect(withParent.height).toBeGreaterThan(withoutParent.height);
  });

  it('never returns a height below the historical fixed minimum (120px)', () => {
    const empty = estimateClassNodeSize(classWithAttributes('Empty', 0));
    expect(empty.height).toBeGreaterThanOrEqual(120);
  });

  it('uses a fixed width regardless of attribute count', () => {
    const small = estimateClassNodeSize(classWithAttributes('Small', 1));
    const large = estimateClassNodeSize(classWithAttributes('Large', 20));
    expect(large.width).toBe(small.width);
  });

  it('uses ClassNode.tsx\'s CSS maxWidth (320), not minWidth, as the assumed width', () => {
    // Regression guard: using minWidth (200) here previously let a
    // long-attribute-name class render wider than ELK assumed, overlapping
    // its neighbour.
    const { width } = estimateClassNodeSize(classWithAttributes('Whatever', 5));
    expect(width).toBe(320);
  });
});

// ── estimateEnumNodeSize ─────────────────────────────────────────────────────

describe('estimateEnumNodeSize', () => {
  function enumWithValues(name: string, count: number) {
    const enumDef = emptyEnumDefinition(name);
    for (let i = 0; i < count; i++) {
      enumDef.permissibleValues[`value_${i}`] = { text: `value_${i}` };
    }
    return enumDef;
  }

  it('grows height with permissible-value count', () => {
    const small = estimateEnumNodeSize(enumWithValues('Small', 2));
    const large = estimateEnumNodeSize(enumWithValues('Large', 10));
    expect(large.height).toBeGreaterThan(small.height);
  });

  it('caps growth beyond the EnumNode UI value limit (12 visible + "N more" row)', () => {
    const atLimit = estimateEnumNodeSize(enumWithValues('AtLimit', 12));
    const wayOverLimit = estimateEnumNodeSize(enumWithValues('WayOver', 50));
    // Beyond the limit, EnumNode always renders the same 12 rows plus one
    // "+N more" row, regardless of how many more there are.
    expect(wayOverLimit.height).toBe(atLimit.height + 23);
  });

  it('uses EnumNode.tsx\'s CSS maxWidth (280), not minWidth, as the assumed width', () => {
    const { width } = estimateEnumNodeSize(enumWithValues('Whatever', 3));
    expect(width).toBe(280);
  });
});

// ── runAutoLayout: direction actually takes effect ───────────────────────────

describe('runAutoLayout direction', () => {
  function parentChildSchema(): LinkMLSchema {
    const schema = emptySchema('TestSchema', 'https://example.org/test', 'test');
    schema.classes['Root'] = classWithAttributes('Root', 2);
    schema.classes['Child'] = classWithAttributes('Child', 2, 'Root');
    return schema;
  }

  // Regression test: AutoLayoutOptions.direction used the conventional
  // TB|BT|LR|RL naming, but that was passed straight through to ELK's
  // `elk.direction` option, which only recognizes DOWN|UP|LEFT|RIGHT and
  // silently ignores anything else -- so every direction produced the exact
  // same (ELK-default) layout, and the direction picker in SchemaCanvas.tsx
  // appeared to do nothing at all when changed.
  it('TB places the child below the parent (not just non-overlapping)', async () => {
    const layout = await runAutoLayout(parentChildSchema(), { direction: 'TB' }, [], new Set());
    expect(layout.nodes['Child'].y).toBeGreaterThan(layout.nodes['Root'].y);
  });

  it('BT places the child above the parent', async () => {
    const layout = await runAutoLayout(parentChildSchema(), { direction: 'BT' }, [], new Set());
    expect(layout.nodes['Child'].y).toBeLessThan(layout.nodes['Root'].y);
  });

  it('LR places the child to the right of the parent', async () => {
    const layout = await runAutoLayout(parentChildSchema(), { direction: 'LR' }, [], new Set());
    expect(layout.nodes['Child'].x).toBeGreaterThan(layout.nodes['Root'].x);
  });

  it('RL places the child to the left of the parent', async () => {
    const layout = await runAutoLayout(parentChildSchema(), { direction: 'RL' }, [], new Set());
    expect(layout.nodes['Child'].x).toBeLessThan(layout.nodes['Root'].x);
  });

  it('TB and LR do not produce the same layout (sanity check that direction is not simply ignored)', async () => {
    const tb = await runAutoLayout(parentChildSchema(), { direction: 'TB' }, [], new Set());
    const lr = await runAutoLayout(parentChildSchema(), { direction: 'LR' }, [], new Set());
    expect(tb.nodes['Child']).not.toEqual(lr.nodes['Child']);
  });
});

// ── runAutoLayout: layeringStrategy actually takes effect ────────────────────

describe('runAutoLayout layeringStrategy', () => {
  // Diamond with uneven path lengths (Root->B->D is short, Root->C->E->F->D
  // is long, via mixins since is_a alone is single-parent) -- layering
  // strategies genuinely disagree on how to place nodes for this shape,
  // verified empirically against raw elkjs before writing this test.
  function diamondSchema(): LinkMLSchema {
    const schema = emptySchema('TestSchema', 'https://example.org/test', 'test');
    schema.classes['Root'] = emptyClassDefinition('Root');
    schema.classes['B'] = { ...emptyClassDefinition('B'), isA: 'Root' };
    schema.classes['C'] = { ...emptyClassDefinition('C'), isA: 'Root' };
    schema.classes['E'] = { ...emptyClassDefinition('E'), isA: 'C' };
    schema.classes['F'] = { ...emptyClassDefinition('F'), isA: 'E' };
    schema.classes['D'] = { ...emptyClassDefinition('D'), isA: 'B', mixins: ['F'] };
    return schema;
  }

  // Regression test: LAYERING_STRATEGIES values are ELK's own real enum
  // names (unlike `direction`), but it would be easy for a future edit to
  // this file to accidentally stop forwarding the option (e.g. dropping it
  // from elkGraph.layoutOptions during a refactor) without anything erroring
  // -- ELK silently ignores a missing/unrecognized option the same way it
  // did for the direction bug this mirrors.
  it('LONGEST_PATH and NETWORK_SIMPLEX do not produce the same layout for a diamond shape', async () => {
    const longestPath = await runAutoLayout(diamondSchema(), { layeringStrategy: 'LONGEST_PATH' }, [], new Set());
    const networkSimplex = await runAutoLayout(diamondSchema(), { layeringStrategy: 'NETWORK_SIMPLEX' }, [], new Set());
    expect(longestPath.nodes['B']).not.toEqual(networkSimplex.nodes['B']);
  });

  it('LONGEST_PATH_SOURCE differs from both LONGEST_PATH and NETWORK_SIMPLEX for a diamond shape', async () => {
    const longestPath = await runAutoLayout(diamondSchema(), { layeringStrategy: 'LONGEST_PATH' }, [], new Set());
    const networkSimplex = await runAutoLayout(diamondSchema(), { layeringStrategy: 'NETWORK_SIMPLEX' }, [], new Set());
    const longestPathSource = await runAutoLayout(diamondSchema(), { layeringStrategy: 'LONGEST_PATH_SOURCE' }, [], new Set());
    expect(longestPathSource.nodes['B']).not.toEqual(longestPath.nodes['B']);
    expect(longestPathSource.nodes['B']).not.toEqual(networkSimplex.nodes['B']);
  });

  // A user reported NETWORK_SIMPLEX/LONGEST_PATH/LONGEST_PATH_SOURCE
  // producing pixel-identical layouts on their real schema (11 classes, a
  // shallow is_a forest -- Skoleeier/Person each with one level of
  // children, three classes with no is_a at all -- plus range edges
  // radiating from one container class with no node reachable by multiple
  // unequal-length paths). Loaded and ran that actual schema through all
  // three strategies: confirmed genuinely identical, including x, not a
  // rendering illusion.
  //
  // The natural theory is that a graph with no "diamond" (a node reachable
  // by paths of different lengths) leaves these layer-assignment algorithms
  // no ambiguity to resolve differently -- diamondSchema() above proves the
  // converse (a diamond => they DO diverge). But two attempts at a small
  // synthetic reproduction of "no diamond => always identical" (a plain
  // tree, and a tree plus a star-shaped range-referencing class,
  // deliberately shaped like the real schema) both FAILED when actually run
  // -- they showed real y and/or x differences between strategies despite
  // having no diamond. So the full explanation for why the real schema
  // agrees exactly is more specific than "no diamond" alone; not fully
  // pinned down. Documented here rather than asserted as a synthetic test,
  // since the two synthetic attempts turned out to be empirically false and
  // encoding a plausible-but-wrong rule as a passing test would be worse
  // than not having one -- see CLAUDE.md's "verify empirically" note, which
  // this investigation is itself an instance of.
  it('every non-crashing LAYERING_STRATEGIES value runs to completion', async () => {
    // BF_MODEL_ORDER/DF_MODEL_ORDER are deliberately excluded from
    // LAYERING_STRATEGIES (they throw on a plain graph). Only 2 of these 7
    // are shown in the UI picker (see LAYERING_STRATEGY_UI_OPTIONS and the
    // clustering test below) -- this proves all 7 stay safe to run even
    // though most aren't user-facing, since AutoLayoutOptions.layeringStrategy
    // itself still accepts any of them.
    for (const strategy of LAYERING_STRATEGIES) {
      const layout = await runAutoLayout(diamondSchema(), { layeringStrategy: strategy }, [], new Set());
      expect(Object.keys(layout.nodes).length).toBe(6);
    }
  });

  // A user found it confusing that INTERACTIVE looked pixel-identical to
  // LONGEST_PATH_SOURCE despite the different name/position in the picker.
  // Investigated: of the 7 LAYERING_STRATEGIES, only 3 distinct results
  // exist for a diamond graph -- {NETWORK_SIMPLEX, COFFMAN_GRAHAM},
  // {LONGEST_PATH, STRETCH_WIDTH, MIN_WIDTH}, {LONGEST_PATH_SOURCE,
  // INTERACTIVE}. Reduced the UI picker to LAYERING_STRATEGY_UI_OPTIONS
  // (just LONGEST_PATH and LONGEST_PATH_SOURCE -- the two cluster
  // representatives at the extremes of the observed range). This test locks
  // in that clustering as a regression guard: if a future elkjs version
  // changes it (e.g. INTERACTIVE stops matching LONGEST_PATH_SOURCE), that's
  // a signal the hidden strategies may be worth re-exposing, not just noise
  // to silence by loosening the assertions.
  it('the 3-way clustering behind hiding 5 of 7 layering strategies from the UI still holds', async () => {
    const results = Object.fromEntries(
      await Promise.all(
        LAYERING_STRATEGIES.map(async (strategy) => [
          strategy,
          (await runAutoLayout(diamondSchema(), { layeringStrategy: strategy }, [], new Set())).nodes,
        ])
      )
    );
    expect(results['COFFMAN_GRAHAM']).toEqual(results['NETWORK_SIMPLEX']);
    expect(results['STRETCH_WIDTH']).toEqual(results['LONGEST_PATH']);
    expect(results['MIN_WIDTH']).toEqual(results['LONGEST_PATH']);
    expect(results['INTERACTIVE']).toEqual(results['LONGEST_PATH_SOURCE']);
    // And the two that ARE shown must still differ from each other and from
    // the hidden middle cluster, or the picker would be pointless.
    expect(results['LONGEST_PATH']).not.toEqual(results['LONGEST_PATH_SOURCE']);
    expect(results['NETWORK_SIMPLEX']).not.toEqual(results['LONGEST_PATH']);
    expect(results['NETWORK_SIMPLEX']).not.toEqual(results['LONGEST_PATH_SOURCE']);
  });
});

// ── runAutoLayout: edgeRouting and nodePlacementStrategy are wired through ───

describe('runAutoLayout edgeRouting / nodePlacementStrategy', () => {
  function diamondSchema(): LinkMLSchema {
    const schema = emptySchema('TestSchema', 'https://example.org/test', 'test');
    schema.classes['Root'] = emptyClassDefinition('Root');
    schema.classes['B'] = { ...emptyClassDefinition('B'), isA: 'Root' };
    schema.classes['C'] = { ...emptyClassDefinition('C'), isA: 'Root' };
    schema.classes['E'] = { ...emptyClassDefinition('E'), isA: 'C' };
    schema.classes['F'] = { ...emptyClassDefinition('F'), isA: 'E' };
    schema.classes['D'] = { ...emptyClassDefinition('D'), isA: 'B', mixins: ['F'] };
    return schema;
  }

  // Regression tests mirroring the layeringStrategy ones above: both options
  // are ELK's own real enum names forwarded verbatim, but it would be just
  // as easy for a future refactor to silently stop forwarding one of them
  // (as literally happened to `direction`) without anything erroring.
  it('ORTHOGONAL and SPLINES produce different edge bend-point counts', async () => {
    const orthogonal = await runAutoLayout(diamondSchema(), { edgeRouting: 'ORTHOGONAL' }, [], new Set());
    const splines = await runAutoLayout(diamondSchema(), { edgeRouting: 'SPLINES' }, [], new Set());
    const bendCount = (layout: typeof orthogonal) =>
      Object.values(layout.edges ?? {}).reduce((sum, e) => sum + e.bendPoints.length, 0);
    expect(bendCount(splines)).not.toBe(bendCount(orthogonal));
  });

  it('every EDGE_ROUTINGS value runs to completion', async () => {
    for (const edgeRouting of EDGE_ROUTINGS) {
      const layout = await runAutoLayout(diamondSchema(), { edgeRouting }, [], new Set());
      expect(Object.keys(layout.nodes).length).toBe(6);
    }
  });

  it('BRANDES_KOEPF and SIMPLE do not produce the same layout', async () => {
    const brandesKoepf = await runAutoLayout(diamondSchema(), { nodePlacementStrategy: 'BRANDES_KOEPF' }, [], new Set());
    const simple = await runAutoLayout(diamondSchema(), { nodePlacementStrategy: 'SIMPLE' }, [], new Set());
    expect(simple.nodes).not.toEqual(brandesKoepf.nodes);
  });

  it('every NODE_PLACEMENT_STRATEGIES value runs to completion', async () => {
    for (const nodePlacementStrategy of NODE_PLACEMENT_STRATEGIES) {
      const layout = await runAutoLayout(diamondSchema(), { nodePlacementStrategy }, [], new Set());
      expect(Object.keys(layout.nodes).length).toBe(6);
    }
  });
});

// ── runAutoLayout: no-overlap regression ─────────────────────────────────────

describe('runAutoLayout', () => {
  it('does not overlap a class with many attributes against its siblings/children', async () => {
    const schema: LinkMLSchema = emptySchema('TestSchema', 'https://example.org/test', 'test');
    schema.classes['Root'] = classWithAttributes('Root', 3);
    // Historically this class (many attributes) would render far taller than
    // the fixed 120px ELK assumed, causing it to overlap whatever ELK placed
    // in the next layer.
    schema.classes['WideClass'] = classWithAttributes('WideClass', 20, 'Root');
    schema.classes['Sibling'] = classWithAttributes('Sibling', 2, 'Root');
    schema.classes['Child'] = classWithAttributes('Child', 4, 'WideClass');

    const layout = await runAutoLayout(schema, {}, [], new Set());

    const boxes: Box[] = Object.entries(schema.classes).map(([name, classDef]) => {
      const pos = layout.nodes[name];
      const { width, height } = estimateClassNodeSize(classDef);
      return { x1: pos.x, y1: pos.y, x2: pos.x + width, y2: pos.y + height };
    });

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(boxesOverlap(boxes[i], boxes[j])).toBe(false);
      }
    }
  });

  it('does not overlap classes and enums when an enum has many permissible values', async () => {
    const schema: LinkMLSchema = emptySchema('TestSchema', 'https://example.org/test', 'test');
    schema.classes['Item'] = emptyClassDefinition('Item');
    schema.classes['Item'].attributes['status'] = { ...emptySlotDefinition('status'), range: 'StatusEnum' };
    schema.enums['StatusEnum'] = emptyEnumDefinition('StatusEnum');
    for (let i = 0; i < 15; i++) {
      schema.enums['StatusEnum'].permissibleValues[`v${i}`] = { text: `v${i}` };
    }

    const layout = await runAutoLayout(schema, {}, [], new Set());

    const itemPos = layout.nodes['Item'];
    const enumPos = layout.nodes['StatusEnum'];
    const itemSize = estimateClassNodeSize(schema.classes['Item']);
    const enumSize = estimateEnumNodeSize(schema.enums['StatusEnum']);

    const itemBox: Box = { x1: itemPos.x, y1: itemPos.y, x2: itemPos.x + itemSize.width, y2: itemPos.y + itemSize.height };
    const enumBox: Box = { x1: enumPos.x, y1: enumPos.y, x2: enumPos.x + enumSize.width, y2: enumPos.y + enumSize.height };

    expect(boxesOverlap(itemBox, enumBox)).toBe(false);
  });
});
