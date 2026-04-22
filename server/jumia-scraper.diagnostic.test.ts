/**
 * Diagnostic reproduction of the user's "no results" report, updated to
 * validate that seller names are fetched from the PDP (not synthesized from
 * sellerId), that the PDP fetches run concurrently, and that the sellerId
 * cache deduplicates repeated sellers within a page.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { extractProductsFromHTML, extractStoreData } from './jumia-scraper';
import { CATALOG_HTML } from './__fixtures__/jumia-catalog-shoe';

// Minimal HTML that mimics a Jumia PDP carrying a seller name in
// window.__STORE__.viewData.seller.name — matches the real PDP JSON shape.
function makePdpHtml(sellerName: string): string {
  return `<html><body><main>PDP body</main><script>window.__STORE__={"view":"Product","viewData":{"seller":{"name":${JSON.stringify(sellerName)}}}};</script></body></html>`;
}

// Map product URL path (as shipped in the fixture) to the seller name we want
// to appear in its simulated PDP response.
const PDP_SELLER_BY_PATH: Record<string, string> = {
  '/aidailu-mens-leather-shoes-237800562.html': 'AIDAILU Official Store',
  '/mens-new-simple-220493750.html': 'Fashion Hub NG',
  '/aidailu-mens-formal-173382955.html': 'AIDAILU Official Store', // same sellerId as product 1 -> cache hit
};

describe('catalog extraction with PDP-based seller enrichment', () => {
  let fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      fetchCalls.push(u);

      // Match the path against the fixture product URLs.
      for (const [path, sellerName] of Object.entries(PDP_SELLER_BY_PATH)) {
        if (u.endsWith(path)) {
          // Simulate a realistic PDP response time so we can see whether the
          // parallelism is working. 300 ms * 3 products sequentially would
          // be 900 ms; in parallel (concurrency 6) it should be ~300 ms.
          await new Promise((r) => setTimeout(r, 300));
          return new Response(makePdpHtml(sellerName), { status: 200 });
        }
      }
      return new Response('', { status: 404 });
    }) as any;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('extractStoreData finds the STORE block in the catalog HTML', () => {
    const store = extractStoreData(CATALOG_HTML);
    expect(store).not.toBeNull();
    expect(store.view).toBe('Catalog');
    expect(store.products.length).toBe(3);
  });

  it('returns products with real seller names fetched from PDPs', async () => {
    const t0 = Date.now();
    const products = await extractProductsFromHTML(CATALOG_HTML, 'NG');
    const elapsed = Date.now() - t0;

    console.log(`[diag] elapsed=${elapsed}ms products=${products.length} pdp-fetches=${fetchCalls.length}`);

    expect(products.length).toBe(3);

    // Real seller names from the PDPs — not "Seller <id>", not "Jumia".
    const sellers = products.map((p) => p.seller);
    expect(sellers).toContain('AIDAILU Official Store');
    expect(sellers).toContain('Fashion Hub NG');
    expect(sellers.filter((s) => s === 'AIDAILU Official Store').length).toBe(2);

    // Cache sanity check: products 1 and 3 share sellerId 201792. The cache
    // should have coalesced their PDP fetches so we make only 2 PDP fetches,
    // not 3.
    expect(fetchCalls.length).toBe(2);

    // Parallelism sanity check: with concurrency 6 and two 300 ms simulated
    // fetches, wall time should be well under 1 s. Sequentially it would be
    // 600 ms + the old 500 ms delays per product = >1.5 s.
    expect(elapsed).toBeLessThan(1000);
  }, 30000);
});
