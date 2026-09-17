import { create, useStore, type StoreApi } from 'zustand';
import { devtools } from 'zustand/middleware';
import { temporal } from 'zundo';
import type { TemporalState } from 'zundo';
import { createProjectSlice, type ProjectSlice } from './slices/projectSlice.js';
import { createCanvasSlice, type CanvasSlice } from './slices/canvasSlice.js';
import { createEditorSlice, type EditorSlice } from './slices/editorSlice.js';
import { createGitSlice, type GitSlice } from './slices/gitSlice.js';
import { createUISlice, type UISlice } from './slices/uiSlice.js';
import { createValidationSlice, type ValidationSlice } from './slices/validationSlice.js';
import { createViewsSlice, type ViewsSlice } from './slices/viewsSlice.js';
import { createBurstGroupedHandleSet } from './temporalHandleSet.js';
import { guardProjectLifecycleFromTemporalHistory, flushBurstBeforeUndoRedo } from './temporalProjectGuard.js';

export type AppStore = ProjectSlice & CanvasSlice & EditorSlice & GitSlice & UISlice & ValidationSlice & ViewsSlice;

// The slice of AppStore that undo/redo actually tracks — see `partialize` below.
export type TemporalPartialState = Pick<AppStore, 'activeProject' | 'activeSchemaId'>;
export type AppTemporalState = TemporalState<TemporalPartialState>;

const burstGroupedHandleSet = createBurstGroupedHandleSet<AppStore, TemporalPartialState>(500);

export const useAppStore = create<AppStore>()(
  devtools(
    temporal(
      (...args) => ({
        ...createProjectSlice(...args),
        ...createCanvasSlice(...args),
        ...createEditorSlice(...args),
        ...createGitSlice(...args),
        ...createUISlice(...args),
        ...createValidationSlice(...args),
        ...createViewsSlice(...args),
      }),
      {
        // Only track schema-mutating state; skip canvas/UI ephemeral state
        partialize: (state) => ({
          activeProject: state.activeProject,
          activeSchemaId: state.activeSchemaId,
        }),
        // Without this, every set() anywhere in the store (canvas pan/zoom, node
        // selection, panel toggles, validation runs, ...) pushes a history entry even
        // when activeProject didn't change — flooding the ring buffer with no-ops that
        // make Undo look like it does nothing. Real schema mutators always produce a
        // new activeProject reference (see patchSchema in projectSlice.ts), and no
        // other slice ever touches activeProject, so reference equality is sufficient.
        // Deliberately ignores activeSchemaId here — switching which schema file is
        // active (setActiveSchema) is navigation, not an edit, and must not create its
        // own undo step. activeSchemaId still travels along inside each real snapshot
        // (see partialize above), so undoing a genuine edit also restores whichever
        // schema was active when that edit happened.
        equality: (a, b) => a.activeProject === b.activeProject,
        // Groups a burst of rapid edits (e.g. every keystroke while typing in a text
        // field) into a single history entry per pause, instead of one entry per
        // keystroke. See temporalHandleSet.ts for why a plain throttle/debounce isn't
        // enough on its own.
        handleSet: burstGroupedHandleSet.wrap,
        limit: 50,
      }
    ),
    { name: 'LinkMLEditorStore' }
  )
);

// ── Typed selectors ────────────────────────────────────────────────────────────
export const useProject = () => useAppStore((s) => s.activeProject);
export const useActiveSchema = () => useAppStore((s) => s.getActiveSchema());
export const useIsDirty = () => useAppStore((s) => s.getIsDirty());
export const useGitAvailable = () => useAppStore((s) => s.gitAvailable);
export const useFocusMode = () => useAppStore((s) => s.focusMode);

// ── Temporal (undo/redo) accessor ─────────────────────────────────────────────
const temporalStoreApi = (useAppStore as unknown as { temporal: StoreApi<AppTemporalState> }).temporal;

// See temporalProjectGuard.ts: opening/closing a project must not become its own undo
// step, and must not leave a previous project's history lying around either.
guardProjectLifecycleFromTemporalHistory(useAppStore, temporalStoreApi, burstGroupedHandleSet);

// See temporalProjectGuard.ts: Undo/Redo must first commit any edit still waiting out
// the burst-grouping window, so clicking Undo right after an action always acts on it.
flushBurstBeforeUndoRedo(temporalStoreApi, burstGroupedHandleSet);

// Reactive by default — subscribes the calling component to temporalStoreApi, so
// pastStates/futureStates (and therefore any disabled-state derived from them) stay
// current without waiting for an unrelated re-render. Pass a selector to subscribe to
// just one field (e.g. `useTemporalStore((s) => s.pastStates.length)`).
export function useTemporalStore(): AppTemporalState;
export function useTemporalStore<T>(selector: (state: AppTemporalState) => T): T;
export function useTemporalStore<T = AppTemporalState>(
  selector: (state: AppTemporalState) => T = (s) => s as unknown as T
): T {
  return useStore(temporalStoreApi, selector);
}

export * from './slices/projectSlice.js';
export * from './slices/canvasSlice.js';
export * from './slices/editorSlice.js';
export * from './slices/gitSlice.js';
export * from './slices/uiSlice.js';
export * from './slices/validationSlice.js';
export * from './slices/viewsSlice.js';
