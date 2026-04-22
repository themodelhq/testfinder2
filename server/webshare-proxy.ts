/**
 * Webshare.io Rotating Residential Proxy Helper
 *
 * Webshare provides a single rotating proxy endpoint:
 *   Host: p.webshare.io
 *   Port: 80  (or 10000 for SSL)
 *   Auth: username:password  (set via env vars)
 *
 * The proxy rotates IPs automatically on every request (or every N seconds
 * depending on the plan), so Jumia sees a different residential IP each time.
 *
 * Required environment variables (set in Render dashboard):
 *   WEBSHARE_PROXY_USERNAME  — your Webshare proxy username
 *   WEBSHARE_PROXY_PASSWORD  — your Webshare proxy password
 *
 * Optional:
 *   WEBSHARE_PROXY_HOST      — defaults to p.webshare.io
 *   WEBSHARE_PROXY_PORT      — defaults to 80
 *
 * Usage:
 *   import { buildProxyAgent } from './webshare-proxy.js';
 *   const agent = buildProxyAgent();
 *   if (agent) fetchOptions.agent = agent;   // node-fetch / undici
 *   // OR pass dispatcher to native fetch:
 *   if (agent) fetchOptions.dispatcher = agent;
 */

import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface ProxyConfig {
  proxyUrl: string;
  httpAgent: HttpProxyAgent<string>;
  httpsAgent: HttpsProxyAgent<string>;
}

let _proxyConfig: ProxyConfig | null | undefined = undefined; // undefined = not yet initialised

/**
 * Returns a ProxyConfig if WEBSHARE credentials are configured, null otherwise.
 * Result is cached after the first call.
 */
export function getProxyConfig(): ProxyConfig | null {
  if (_proxyConfig !== undefined) return _proxyConfig;

  const username = process.env.WEBSHARE_PROXY_USERNAME;
  const password = process.env.WEBSHARE_PROXY_PASSWORD;

  if (!username || !password) {
    console.warn('[Proxy] WEBSHARE_PROXY_USERNAME / WEBSHARE_PROXY_PASSWORD not set — direct connection will be used.');
    _proxyConfig = null;
    return null;
  }

  const host = process.env.WEBSHARE_PROXY_HOST ?? 'p.webshare.io';
  const port = process.env.WEBSHARE_PROXY_PORT ?? '80';
  const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;

  _proxyConfig = {
    proxyUrl,
    httpAgent: new HttpProxyAgent(proxyUrl),
    httpsAgent: new HttpsProxyAgent(proxyUrl),
  };

  console.log(`[Proxy] Webshare proxy configured → ${host}:${port}`);
  return _proxyConfig;
}

/**
 * Returns fetch() RequestInit options pre-populated with the proxy agent.
 * Pass the returned object (spread or assign) into your fetch() call.
 *
 * Works with Node 18+ native fetch (via the undici-compatible "dispatcher")
 * and also with node-fetch v3 (via "agent").
 */
export function proxyFetchOptions(): Record<string, any> {
  const cfg = getProxyConfig();
  if (!cfg) return {};
  // Node native fetch (undici under the hood) uses `dispatcher`
  // node-fetch uses `agent`
  // We set both so it works regardless of which fetch implementation is active.
  return {
    agent: cfg.httpsAgent,          // node-fetch compat
    // dispatcher is undici-specific; only attach if undici is available
    ...getDispatcherOption(cfg.proxyUrl),
  };
}

function getDispatcherOption(proxyUrl: string): Record<string, any> {
  try {
    // undici ProxyAgent works with Node 18+ native fetch
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProxyAgent } = require('undici');
    return { dispatcher: new ProxyAgent(proxyUrl) };
  } catch {
    return {};
  }
}
