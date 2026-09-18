import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create, type StoreApi } from 'zustand';
import { temporal } from 'zundo';
import { createProjectSlice, type ProjectSlice } from '../slices/projectSlice.js';
import { createBurstGroupedHandleSet } from '../temporalHandleSet.js';
import { guardProjectLifecycleFromTemporalHistory, flushBurstBeforeUndoRedo } from '../temporalProjectGuard.js';
import type { AppStore, AppTemporalState } from '../index.js';
import type { Project, SchemaFile } from '../../model/index.js';
import { emptyCanvasLayout, emptySchema, emptyClassDefinition } from '../../model/index.js';

/**
 * Regression coverage for: "trykker eg for mykje på undo kjem eg tilbake til 'Open from
 * URL'-skjermbildet" — opening/closing a project was itself being recorded as an undo
 * step, so Undo-ing past the last real edit took the user back to having no project
 * open at all. See specs/backlog/undo-redo-fix-and-edit-history-log.md.
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

function createGuardedStore() {
  const burstGrouper = createBurstGroupedHandleSet<AppStore, Pick<AppStore, 'activeProject' | 'activeSchemaId'>>(500);
  const store = create<ProjectSlice>()(
    temporal((...args) => createProjectSlice(...args), {
      partialize: (s) => ({ activeProject: s.activeProject, activeSchemaId: s.activeSchemaId }),
      equality: (a, b) => a.activeProject === b.activeProject,
      handleSet: burstGrouper.wrap,
      limit: 50,
    })
  );
  const temporalApi = (store as unknown as { temporal: StoreApi<AppTemporalState> }).temporal;
  guardProjectLifecycleFromTemporalHistory(
    store as unknown as Pick<StoreApi<AppStore>, 'getState' | 'setState'>,
    temporalApi,
    burstGrouper
  );
  flushBurstBeforeUndoRedo(temporalApi, burstGrouper);
  return { store, temporalApi };
}

describe('guardProjectLifecycleFromTemporalHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setProject (opening a project) creates no undo step', () => {
    const { store, temporalApi } = createGuardedStore();
    store.getState().setProject(makeProject('test', [makeSchemaFile('core')]));
    expect(temporalApi.getState().pastStates.length).toBe(0);
  });

  it('Undo right after an edit acts on it immediately, and never goes past it back to "no project open"', () => {
    const { store, temporalApi } = createGuardedStore();
    const sf = makeSchemaFile('core');
    store.getState().setProject(makeProject('test', [sf]));
    store.getState().addClass(sf.id, emptyClassDefinition('A'));

    expect(store.getState().activeProject!.schemas[0].schema.classes).toHaveProperty('A');
    // No time advanced — this exercises flushBurstBeforeUndoRedo: the edit is still
    // sitting in the debounce window, but Undo must still act on it right away.
    temporalApi.getState().undo();

    expect(store.getState().activeProject).not.toBeNull(); // still open — not back to the picker screen
    expect(store.getState().activeProject!.schemas[0].schema.classes).not.toHaveProperty('A');
    expect(temporalApi.getState().pastStates.length).toBe(0); // nothing left to undo — button should grey out
  });

  it('closeProject creates no undo step and wipes any prior edit history', () => {
    const { store, temporalApi } = createGuardedStore();
    const sf = makeSchemaFile('core');
    store.getState().setProject(makeProject('test', [sf]));
    store.getState().addClass(sf.id, emptyClassDefinition('A'));
    vi.advanceTimersByTime(500); // let the edit settle into history, as it would in real use
    expect(temporalApi.getState().pastStates.length).toBe(1);

    store.getState().closeProject();

    expect(store.getState().activeProject).toBeNull();
    expect(temporalApi.getState().pastStates.length).toBe(0);
    expect(temporalApi.getState().futureStates.length).toBe(0);
  });

  it('a second project opened after closing the first starts with a clean undo history', () => {
    const { store, temporalApi } = createGuardedStore();
    const sfA = makeSchemaFile('projectA');
    store.getState().setProject(makeProject('A', [sfA]));
    store.getState().addClass(sfA.id, emptyClassDefinition('FromA'));
    vi.advanceTimersByTime(500);
    expect(temporalApi.getState().pastStates.length).toBe(1);

    store.getState().closeProject();
    const sfB = makeSchemaFile('projectB');
    store.getState().setProject(makeProject('B', [sfB]));

    expect(temporalApi.getState().pastStates.length).toBe(0);
    temporalApi.getState().undo(); // must be a no-op — nothing from project A should be reachable
    expect(store.getState().activeProject?.name).toBe('B');
  });

  it('setActiveSchema (switching schema tabs) does not create an undo step', () => {
    const { store, temporalApi } = createGuardedStore();
    const sfA = makeSchemaFile('a');
    const sfB = makeSchemaFile('b');
    store.getState().setProject(makeProject('test', [sfA, sfB]));

    const before = temporalApi.getState().pastStates.length;
    store.getState().setActiveSchema(sfB.id);
    expect(temporalApi.getState().pastStates.length).toBe(before);
  });
});
