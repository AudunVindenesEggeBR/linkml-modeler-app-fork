/**
 * zundo's own documented debounce/throttle recipe (`handleSet: (h) => throttle(h, ms)`)
 * captures `pastState` per individual `set()` call, not per edit burst — wrapping it in an
 * off-the-shelf throttle/debounce still records the state right before the *last* call in a
 * burst, so undoing a freshly-typed sentence only removes its last character first. This
 * wrapper instead remembers the `pastState` from the *start* of a burst and pairs it with the
 * `currentState`/`deltaState` from whichever call is still pending when the burst settles, so
 * one quiet period produces exactly one history entry spanning the whole burst.
 *
 * `TFull`/`TPartial` mirror zundo's own `ZundoOptions<TState, PartialTState>` generics — we
 * only ever store and forward `pastState`/`replace` opaquely (never read their fields), so the
 * exact (and, for `pastState`/`replace`, slightly imprecise relative to zundo's own runtime
 * behavior — see `store/index.ts`) declared types are enough to stay type-safe here.
 *
 * Returns `{ wrap, reset, flush }`:
 * - `reset()` cancels any burst still pending, discarding it. Without it, a project being
 *   closed/opened right after the user was typing could still push a stale history entry
 *   ~500ms later, from a burst timer scheduled before the switch (see temporalProjectGuard.ts).
 * - `flush()` commits any burst still pending *immediately*, instead of discarding it. Without
 *   it, clicking Undo/Redo within the debounce window (e.g. right after a one-shot action like
 *   "Add Class", not just mid-typing) would silently do nothing — the edit already happened in
 *   the UI, but hadn't been written to `pastStates` yet (see temporalProjectGuard.ts's
 *   `flushBurstBeforeUndoRedo`, wired into `undo`/`redo` in store/index.ts).
 */
type SetStateArg<TFull> = TFull | ((state: TFull) => TFull);

export function createBurstGroupedHandleSet<TFull, TPartial>(waitMs: number) {
  type HandleSetFn = (
    pastState: SetStateArg<TFull>,
    replace: true,
    currentState: TPartial,
    deltaState?: Partial<TPartial> | null
  ) => void;

  let burstStart: SetStateArg<TFull> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending:
    | { handleSet: HandleSetFn; replace: true; currentState: TPartial; deltaState?: Partial<TPartial> | null }
    | undefined;

  function fireNow() {
    if (pending === undefined) {
      return;
    }
    const { handleSet, replace, currentState, deltaState } = pending;
    const start = burstStart as SetStateArg<TFull>;
    pending = undefined;
    burstStart = undefined;
    timer = undefined;
    handleSet(start, replace, currentState, deltaState);
  }

  function reset() {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = undefined;
    burstStart = undefined;
    pending = undefined;
  }

  function flush() {
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    fireNow();
  }

  function wrap(handleSet: HandleSetFn) {
    return (pastState: SetStateArg<TFull>, replace: true, currentState: TPartial, deltaState?: Partial<TPartial> | null) => {
      if (burstStart === undefined) {
        burstStart = pastState;
      }
      pending = { handleSet, replace, currentState, deltaState };
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(fireNow, waitMs);
    };
  }

  return { wrap, reset, flush };
}
