import type { StoreApi } from 'zustand';
import type { AppStore, AppTemporalState } from './index.js';

/**
 * Opening or closing a project is a context switch, not a schema edit, so it must
 * never become its own undo step — otherwise Undo-ing enough times takes the user back
 * to the "Open from URL"/project-picker screen, and any undo history from a
 * previously open project must not leak into the newly opened one.
 *
 * Wraps `setProject`/`closeProject` on `store` so each call: pauses temporal tracking
 * (so the project-switching set() itself is never recorded), runs the real action,
 * cancels any debounced edit-burst push still pending from just before the switch
 * (`burstGrouper.reset()` — see temporalHandleSet.ts), clears pastStates/futureStates
 * outright, then resumes tracking.
 */
export function guardProjectLifecycleFromTemporalHistory(
  store: Pick<StoreApi<AppStore>, 'getState' | 'setState'>,
  temporalApi: StoreApi<AppTemporalState>,
  burstGrouper: { reset: () => void }
): void {
  function withoutTemporalTracking<T>(run: () => T): T {
    temporalApi.getState().pause();
    const result = run();
    burstGrouper.reset();
    temporalApi.getState().clear();
    temporalApi.getState().resume();
    return result;
  }

  const rawSetProject = store.getState().setProject;
  const rawCloseProject = store.getState().closeProject;
  store.setState({
    setProject: (...args: Parameters<typeof rawSetProject>) => withoutTemporalTracking(() => rawSetProject(...args)),
    closeProject: (...args: Parameters<typeof rawCloseProject>) => withoutTemporalTracking(() => rawCloseProject(...args)),
  });
}

/**
 * Without this, clicking Undo (or Redo) while a burst-grouped edit is still pending
 * (see temporalHandleSet.ts — up to `waitMs`, e.g. right after a one-shot action like
 * "Add Class", not just mid-typing) silently does nothing: the edit already happened in
 * the UI, but hasn't been written to `pastStates` yet. Wraps `undo`/`redo` on the
 * temporal store so each call first flushes any pending burst into history (committing
 * it), then proceeds — so Undo always acts on the edit the user just saw happen.
 */
export function flushBurstBeforeUndoRedo(
  temporalApi: Pick<StoreApi<AppTemporalState>, 'getState' | 'setState'>,
  burstGrouper: { flush: () => void }
): void {
  const rawUndo = temporalApi.getState().undo;
  const rawRedo = temporalApi.getState().redo;
  temporalApi.setState({
    undo: (steps?: number) => {
      burstGrouper.flush();
      rawUndo(steps);
    },
    redo: (steps?: number) => {
      burstGrouper.flush();
      rawRedo(steps);
    },
  });
}
