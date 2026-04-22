/**
 * Proxy-aware fetch for the Jumia scraper.
 *
 * WHY THIS EXISTS
 * ---------------
 * Jumia's bot detection denies outbound requests from most cloud datacenters
 * (Render, Vercel, Fly, Oracle — all return HTTP 403 from Jumia's WAF).
 * Routing the scraper's fetches through a residential/datacenter proxy that
 * Jumia hasn't blocked fixes this without re-architecting the app.
 *
 * HOW IT'S CONFIGURED
 * -------------------
 * Set the PROXY_URL environment variable. It supports standard HTTP proxy
 * URL syntax:
 *
 *   http://username:password@host:port
 *
 * For Webshare specifically, you'll find ready-to-paste URLs in the
 * dashboard (Proxy -> List -> Download -> "Username:Password"). Example:
 *
 *   PROXY_URL=http://abc123-rotate:xyzsecret@p.webshare.io:80
 *
 * If PROXY_URL is unset (or empty), this module is a transparent passthrough
 * and behaves exactly like global fetch — so local development, unit tests,
 * and direct-fetch deployments keep working with zero changes.
 *
 * WHY undici.ProxyAgent
 * ---------------------
 * Node 22's built-in fetch is implemented on top of undici. Passing a
 * `dispatcher: ProxyAgent` on the fetch init is the officially supported way
 * to route a single fetch through an HTTP proxy. No new dependencies, no
 * monkey-patching of global fetch, and the existing RequestInit options
 * (headers, signal, redirect) keep working unchanged.
 */
import { ProxyAgent } from 'undici';

let cachedAgent: ProxyAgent | null = null;
let cachedAgentFor: string | null = null;

function getProxyUrl(): string | null {
  const raw = process.env.PROXY_URL;
  if (!raw || !raw.trim()) return null;
  return raw.trim();
}

function getProxyAgent(): ProxyAgent | null {
  const url = getProxyUrl();
  if (!url) return null;
  // Reuse the same ProxyAgent across requests so we get TCP connection
  // pooling. Rebuild only if the env var actually changed (useful in tests).
  if (!cachedAgent || cachedAgentFor !== url) {
    cachedAgent = new ProxyAgent(url);
    cachedAgentFor = url;
  }
  return cachedAgent;
}

/**
 * Drop-in replacement for global fetch. If PROXY_URL is set, the request
 * is routed through the configured HTTP proxy; otherwise it behaves like
 * normal fetch. The return value is a standard Response.
 */
export async function proxiedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const agent = getProxyAgent();
  if (!agent) {
    return fetch(input, init);
  }
  // undici's ProxyAgent hooks in via the non-standard `dispatcher` option
  // that Node's fetch forwards to the underlying undici client. TypeScript's
  // lib.dom types don't know about it, hence the cast.
  return fetch(input, { ...init, dispatcher: agent } as RequestInit);
}

/**
 * Whether a proxy is currently configured. The scraper uses this to decorate
 * its `debug` payload so the Network tab shows whether direct or proxied
 * egress is in use.
 */
export function isProxyConfigured(): boolean {
  return getProxyUrl() !== null;
}
