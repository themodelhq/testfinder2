/**
 * Verifies the proxy-aware fetch helper:
 *   - when PROXY_URL is unset, it calls plain global fetch (no dispatcher);
 *   - when PROXY_URL is set, it forwards the request with a `dispatcher`
 *     option that maps to an undici ProxyAgent.
 *
 * We don't actually open a network connection. Instead we stub global fetch
 * and assert on the options it received.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('proxiedFetch', () => {
  const originalFetch = globalThis.fetch;
  const originalProxyUrl = process.env.PROXY_URL;

  beforeEach(() => {
    // Reset env between tests so state from a previous case doesn't leak.
    delete process.env.PROXY_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalProxyUrl === undefined) delete process.env.PROXY_URL;
    else process.env.PROXY_URL = originalProxyUrl;
    vi.resetModules();
  });

  it('bypasses the proxy when PROXY_URL is unset', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy as any;

    // Import AFTER env is configured — the module caches nothing at import
    // time, but this keeps semantics clear.
    const mod = await import('./proxy-fetch');
    await mod.proxiedFetch('https://example.com/unit');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [any, any];
    // With no proxy configured, no dispatcher should be forwarded.
    expect(init?.dispatcher).toBeUndefined();
    expect(mod.isProxyConfigured()).toBe(false);
  });

  it('forwards a dispatcher when PROXY_URL is set', async () => {
    process.env.PROXY_URL = 'http://user:pass@proxy.example.com:8080';

    const fetchSpy = vi.fn(async () => new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy as any;

    // Re-import so the module picks up the freshly-set env var for the
    // cache rebuild check.
    vi.resetModules();
    const mod = await import('./proxy-fetch');
    await mod.proxiedFetch('https://example.com/proxied');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [any, any];
    // The dispatcher is an undici ProxyAgent instance — we don't assert on
    // its exact constructor (the import chain is an implementation detail),
    // only that one was attached.
    expect(init?.dispatcher).toBeDefined();
    expect(mod.isProxyConfigured()).toBe(true);
  });

  it('preserves caller-provided fetch options (headers, signal, method)', async () => {
    process.env.PROXY_URL = 'http://u:p@proxy.example.com:8080';

    const fetchSpy = vi.fn(async () => new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy as any;

    vi.resetModules();
    const mod = await import('./proxy-fetch');

    const controller = new AbortController();
    await mod.proxiedFetch('https://example.com/x', {
      method: 'GET',
      headers: { 'User-Agent': 'UnitTest/1.0' },
      signal: controller.signal,
    });

    const [, init] = fetchSpy.mock.calls[0] as [any, any];
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'User-Agent': 'UnitTest/1.0' });
    expect(init.signal).toBe(controller.signal);
    expect(init.dispatcher).toBeDefined();
  });
});
