import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { temporal } from 'zundo';
import { createProjectSlice, type ProjectSlice } from '../slices/projectSlice.js';
import { createCanvasSlice, type CanvasSlice } from '../slices/canvasSlice.js';
import type { Project, SchemaFile } from '../../model/index.js';
import { emptyCanvasLayout, emptySchema, emptyClassDefinition } from '../../model/index.js';

/**
 * Regression coverage for the "Undo does nothing" bug: without an `equality` function,
 * zundo pushes a history entry on *every* set() call anywhere in the store — including
 * canvas-only actions that never touch activeProject/activeSchemaId — which floods the
 * ring buffer with no-ops and makes a real edit's Undo entry get consumed by (or evicted
 * by) unrelated UI noise. See specs/backlog/undo-redo-fix-and-edit-history-log.md.
 */

function makeSchemaFile(name: string): SchemaFile {
  return {
    id: crypto.randomUUID(),
    filePath: `${name}.yaml`,
    schema: emptySchema(name, `https://example.org/${name}`, name),
    isDirty: false,
    canvasLayout: emptyCanvasLayout(),
  };
}

function makeProject(name: string, schemas: SchemaFile[] = []): Project {
  return {
    id: crypto.randomUUID(),
    name,
    rootPath: `/tmp/${name}`,
    schemas,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createRealisticStore() {
  return create<ProjectSlice & CanvasSlice>()(
    temporal(
      (...args) => ({
        ...createProjectSlice(...args),
        ...createCanvasSlice(...args),
      }),
      {
        partialize: (s) => ({ activeProject: s.activeProject, activeSchemaId: s.activeSchemaId }),
        equality: (a, b) => a.activeProject === b.activeProject && a.activeSchemaId === b.activeSchemaId,
        limit: 50,
      }
    )
  );
}

function getTemporal(store: ReturnType<typeof createRealisticStore>) {
  return (
    store as unknown as {
      temporal: { getState: () => { pastStates: unknown[]; futureStates: unknown[]; undo: () => void } };
    }
  ).temporal.getState();
}

describe('temporal equality — canvas/UI-only actions must not pollute undo history', () => {
  it('setViewport (canvas pan/zoom) does not push a history entry', () => {
    const store = createRealisticStore();
    const sf = makeSchemaFile('core');
    store.getState().setProject(makeProject('test', [sf]));
    store.getState().addClass(sf.id, emptyClassDefinition('A'));

    const before = getTemporal(store).pastStates.length;
    for (let i = 0; i < 10; i++) {
      store.getState().setViewport({ x: i, y: i, zoom: 1 });
    }
    expect(getTemporal(store).pastStates.length).toBe(before);
  });

  it('setSelection (node/edge selection) does not push a history entry', () => {
    const store = createRealisticStore();
    const sf = makeSchemaFile('core');
    store.getState().setProject(makeProject('test', [sf]));
    store.getState().addClass(sf.id, emptyClassDefinition('A'));

    const before = getTemporal(store).pastStates.length;
    store.getState().setSelection(['node-1'], []);
    store.getState().clearSelection();
    expect(getTemporal(store).pastStates.length).toBe(before);
  });

  it('undo after panning the canvas still reverts the most recent real schema edit', () => {
    const store = createRealisticStore();
    const sf = makeSchemaFile('core');
    store.getState().setProject(makeProject('test', [sf]));
    store.getState().addClass(sf.id, emptyClassDefinition('A'));

    // A user very commonly pans/zooms right after making an edit to look at it.
    store.getState().setViewport({ x: 5, y: 5, zoom: 1 });

    expect(store.getState().activeProject!.schemas[0].schema.classes).toHaveProperty('A');
    getTemporal(store).undo();
    expect(store.getState().activeProject!.schemas[0].schema.classes).not.toHaveProperty('A');
  });

  it('real schema edits still push exactly one history entry each', () => {
    const store = createRealisticStore();
    const sf = makeSchemaFile('core');
    store.getState().setProject(makeProject('test', [sf]));

    const before = getTemporal(store).pastStates.length;
    store.getState().addClass(sf.id, emptyClassDefinition('A'));
    store.getState().addClass(sf.id, emptyClassDefinition('B'));
    expect(getTemporal(store).pastStates.length).toBe(before + 2);
  });
});
