import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBurstGroupedHandleSet } from '../temporalHandleSet.js';

describe('createBurstGroupedHandleSet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses a burst of rapid calls into a single handleSet invocation', () => {
    const handleSet = vi.fn();
    const grouped = createBurstGroupedHandleSet<{ text: string }, { text: string }>(500).wrap(handleSet);

    grouped({ text: '' }, true, { text: 'H' }, undefined);
    vi.advanceTimersByTime(100);
    grouped({ text: 'H' }, true, { text: 'He' }, undefined);
    vi.advanceTimersByTime(100);
    grouped({ text: 'He' }, true, { text: 'Hel' }, undefined);
    vi.advanceTimersByTime(100);
    grouped({ text: 'Hel' }, true, { text: 'Hell' }, undefined);
    vi.advanceTimersByTime(100);
    grouped({ text: 'Hell' }, true, { text: 'Hello' }, undefined);

    expect(handleSet).not.toHaveBeenCalled(); // still within the quiet period

    vi.advanceTimersByTime(500);

    expect(handleSet).toHaveBeenCalledTimes(1);
    // pastState must be from the FIRST call of the burst ("" before "H"), not the last
    // ("Hell" before "o") — otherwise a single Undo would only remove the last character.
    expect(handleSet).toHaveBeenCalledWith({ text: '' }, true, { text: 'Hello' }, undefined);
  });

  it('starts a new burst — and a new pastState checkpoint — once a prior burst has settled', () => {
    const handleSet = vi.fn();
    const grouped = createBurstGroupedHandleSet<{ text: string }, { text: string }>(500).wrap(handleSet);

    grouped({ text: '' }, true, { text: 'Hello' }, undefined);
    vi.advanceTimersByTime(500);
    expect(handleSet).toHaveBeenCalledTimes(1);
    expect(handleSet).toHaveBeenNthCalledWith(1, { text: '' }, true, { text: 'Hello' }, undefined);

    grouped({ text: 'Hello' }, true, { text: 'Hello there' }, undefined);
    vi.advanceTimersByTime(500);
    expect(handleSet).toHaveBeenCalledTimes(2);
    expect(handleSet).toHaveBeenNthCalledWith(2, { text: 'Hello' }, true, { text: 'Hello there' }, undefined);
  });

  it('never fires while calls keep arriving inside the quiet window', () => {
    const handleSet = vi.fn();
    const grouped = createBurstGroupedHandleSet<{ n: number }, { n: number }>(500).wrap(handleSet);

    for (let i = 0; i < 20; i++) {
      grouped({ n: i }, true, { n: i + 1 }, undefined);
      vi.advanceTimersByTime(490); // always re-triggers before the 500ms window elapses
    }
    expect(handleSet).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(handleSet).toHaveBeenCalledTimes(1);
    expect(handleSet).toHaveBeenCalledWith({ n: 0 }, true, { n: 20 }, undefined);
  });

  it('reset() cancels a pending burst so it never fires', () => {
    const handleSet = vi.fn();
    const grouper = createBurstGroupedHandleSet<{ text: string }, { text: string }>(500);
    const grouped = grouper.wrap(handleSet);

    grouped({ text: '' }, true, { text: 'Hello' }, undefined);
    vi.advanceTimersByTime(100);
    grouper.reset();
    vi.advanceTimersByTime(1000);

    expect(handleSet).not.toHaveBeenCalled();
  });

  it('reset() does not affect a later, unrelated burst', () => {
    const handleSet = vi.fn();
    const grouper = createBurstGroupedHandleSet<{ text: string }, { text: string }>(500);
    const grouped = grouper.wrap(handleSet);

    grouped({ text: '' }, true, { text: 'Hello' }, undefined);
    grouper.reset();

    grouped({ text: 'reset-baseline' }, true, { text: 'next edit' }, undefined);
    vi.advanceTimersByTime(500);

    expect(handleSet).toHaveBeenCalledTimes(1);
    expect(handleSet).toHaveBeenCalledWith({ text: 'reset-baseline' }, true, { text: 'next edit' }, undefined);
  });

  it('flush() commits a pending burst immediately, without waiting out the window', () => {
    const handleSet = vi.fn();
    const grouper = createBurstGroupedHandleSet<{ text: string }, { text: string }>(500);
    const grouped = grouper.wrap(handleSet);

    grouped({ text: '' }, true, { text: 'Hello' }, undefined);
    vi.advanceTimersByTime(50); // nowhere near the 500ms window — would still be pending otherwise
    grouper.flush();

    expect(handleSet).toHaveBeenCalledTimes(1);
    expect(handleSet).toHaveBeenCalledWith({ text: '' }, true, { text: 'Hello' }, undefined);

    // the original timer must be cancelled — no second, duplicate call once it would have fired
    vi.advanceTimersByTime(500);
    expect(handleSet).toHaveBeenCalledTimes(1);
  });

  it('flush() is a no-op when nothing is pending', () => {
    const handleSet = vi.fn();
    const grouper = createBurstGroupedHandleSet<{ text: string }, { text: string }>(500);
    grouper.flush();
    expect(handleSet).not.toHaveBeenCalled();
  });
});
