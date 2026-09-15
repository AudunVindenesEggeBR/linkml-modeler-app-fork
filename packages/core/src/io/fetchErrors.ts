/**
 * fetchErrors.ts — shared fetch-with-retry and honest error messaging for
 * schema URL fetches (Open from URL, Import Schema from URL).
 *
 * See specs/done/url-fetch-cors-error-mislabeling.md and CLAUDE.md's
 * "Application Error Handling" section for why this exists: the Fetch API's
 * `TypeError: Failed to fetch` is thrown for many distinct causes (DNS
 * failure, a reset connection, being offline, a browser extension blocking
 * the request, a cold TLS handshake to a not-yet-contacted host, and an
 * actual CORS rejection all look identical to JS -- the browser withholds
 * the real reason by design). Guessing "CORS" from that message alone is a
 * diagnosis the code cannot actually verify.
 */

/**
 * Turns a caught fetch() error into an honest, non-diagnostic message. Does
 * NOT assert a specific cause (e.g. "CORS") that the code cannot verify --
 * see module doc comment above.
 */
export function classifyFetchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.startsWith('HTTP ')) {
      return err.message;
    }
    if (err.message === 'Failed to fetch') {
      return 'Network request failed. This can happen due to a CORS restriction, a DNS/connectivity issue, or a browser extension blocking the request. Try again, or check the browser console for the exact failure.';
    }
    return `Network error: ${err.message}`;
  }
  return `Network error: ${String(err)}`;
}

/**
 * Fetches a URL as text, retrying once after a short delay if the first
 * attempt throws or returns a non-2xx status. Transient hiccups on first
 * contact with a host are common and typically resolve on their own -- see
 * the spec referenced in the module doc comment for the observed pattern
 * (a schema URL failed once, then succeeded on an unmodified retry).
 *
 * Throws an Error with the classified, honest message (see
 * classifyFetchError) if every attempt fails.
 */
export async function fetchTextWithRetry(url: string, retries = 1, delayMs = 400): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error(classifyFetchError(lastErr));
}
