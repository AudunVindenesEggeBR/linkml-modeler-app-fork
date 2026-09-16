import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { createUISlice, TOAST_HISTORY_CAP, type UISlice } from '../slices/uiSlice.js';

function createStore() {
  return create<UISlice>()((...args) => createUISlice(...args));
}

describe('toast history (specs/backlog/cross-repo-import-resolution-gaps.md, runde 2)', () => {
  it('pushToast adds the same entry to both toastQueue and toastHistory', () => {
    const store = createStore();
    store.getState().pushToast({ message: 'hello', severity: 'info' });
    expect(store.getState().toastQueue).toHaveLength(1);
    expect(store.getState().toastHistory).toHaveLength(1);
    expect(store.getState().toastQueue[0].message).toBe('hello');
    expect(store.getState().toastHistory[0].message).toBe('hello');
  });

  it('pushToast stamps a createdAt timestamp', () => {
    const store = createStore();
    store.getState().pushToast({ message: 'hello', severity: 'info' });
    expect(typeof store.getState().toastHistory[0].createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(store.getState().toastHistory[0].createdAt))).toBe(false);
  });

  it('dismissToast removes from toastQueue but NOT from toastHistory', () => {
    const store = createStore();
    store.getState().pushToast({ message: 'dismiss me', severity: 'warning' });
    const id = store.getState().toastQueue[0].id;
    store.getState().dismissToast(id);
    expect(store.getState().toastQueue).toHaveLength(0);
    expect(store.getState().toastHistory).toHaveLength(1);
    expect(store.getState().toastHistory[0].message).toBe('dismiss me');
  });

  it('caps toastHistory at TOAST_HISTORY_CAP, evicting the oldest first (FIFO)', () => {
    const store = createStore();
    for (let i = 0; i < TOAST_HISTORY_CAP + 10; i++) {
      store.getState().pushToast({ message: `toast-${i}`, severity: 'info' });
    }
    const history = store.getState().toastHistory;
    expect(history).toHaveLength(TOAST_HISTORY_CAP);
    // Oldest 10 (toast-0..toast-9) should have been evicted; newest should remain.
    expect(history[0].message).toBe('toast-10');
    expect(history[history.length - 1].message).toBe(`toast-${TOAST_HISTORY_CAP + 9}`);
  });

  it('clearToastHistory empties toastHistory without touching toastQueue', () => {
    const store = createStore();
    store.getState().pushToast({ message: 'still visible', severity: 'info' });
    store.getState().clearToastHistory();
    expect(store.getState().toastHistory).toHaveLength(0);
    expect(store.getState().toastQueue).toHaveLength(1);
  });
});
