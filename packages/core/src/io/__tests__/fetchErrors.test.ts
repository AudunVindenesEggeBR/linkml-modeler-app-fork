import { describe, it, expect, vi } from 'vitest';
import { classifyFetchError, fetchTextWithRetry } from '../fetchErrors.js';

describe('classifyFetchError', () => {
  it('does not assert CORS as the cause for a generic "Failed to fetch"', () => {
    const message = classifyFetchError(new TypeError('Failed to fetch'));
    expect(message).not.toMatch(/the server may not allow cross-origin/i);
    expect(message.toLowerCase()).toContain('cors');
    expect(message.toLowerCase()).toContain('dns');
  });

  it('passes through an HTTP status error unchanged', () => {
    const message = classifyFetchError(new Error('HTTP 404 Not Found'));
    expect(message).toBe('HTTP 404 Not Found');
  });

  it('wraps any other Error message', () => {
    const message = classifyFetchError(new Error('boom'));
    expect(message).toBe('Network error: boom');
  });

  it('handles a non-Error thrown value', () => {
    const message = classifyFetchError('boom');
    expect(message).toBe('Network error: boom');
  });
});

describe('fetchTextWithRetry', () => {
  it('returns text on a successful first attempt without retrying', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => 'content' }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    try {
      const result = await fetchTextWithRetry('https://example.org/schema.yaml');
      expect(result).toBe('content');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('retries once after a transient failure and succeeds silently', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return { ok: true, text: async () => 'content' };
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    try {
      const result = await fetchTextWithRetry('https://example.org/schema.yaml', 1, 0);
      expect(result).toBe('content');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws the classified error when every attempt fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    try {
      await expect(fetchTextWithRetry('https://example.org/schema.yaml', 1, 0)).rejects.toThrow(
        /CORS restriction|DNS/i
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('retries on a non-2xx HTTP status and surfaces it if it persists', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    try {
      await expect(fetchTextWithRetry('https://example.org/schema.yaml', 1, 0)).rejects.toThrow(
        'HTTP 404 Not Found'
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('respects a retries count of 0 (no retry)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as never;
    try {
      await expect(fetchTextWithRetry('https://example.org/schema.yaml', 0, 0)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
