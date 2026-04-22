import { describe, it, expect } from 'vitest';
import { extractStoreData, detectHasMore, extractProductsFromHTML } from './jumia-scraper';

/**
 * These tests cover the three regressions that Jumia's 2025 HTML update
 * exposed in the old `/window\.__STORE__\s*=\s*({[\s\S]*?});\s*<\/script>/`
 * regex:
 *
 *   1. Minified builds with no whitespace between `};` and `</script>`.
 *   2. JSON values that contain the literal string `</script>`.
 *   3. The object ends with `}</script>` with no semicolon.
 */

describe('extractStoreData (brace-depth parser)', () => {
  it('parses a simple minified assignment with no whitespace', () => {
    const html = `<script>window.__STORE__={"a":1,"b":"hello"};</script>`;
    const data = extractStoreData(html);
    expect(data).toEqual({ a: 1, b: 'hello' });
  });

  it('parses an assignment terminated by just } before </script> (no semicolon)', () => {
    const html = `<script>window.__STORE__={"a":1,"b":2}</script>`;
    const data = extractStoreData(html);
    expect(data).toEqual({ a: 1, b: 2 });
  });

  it('handles JSON string values containing the literal </script>', () => {
    // The old lazy regex would stop at the first `};</script>` and fail.
    // This one is embedded inside a string, which the brace-walker must ignore.
    const html =
      `<script>window.__STORE__={"review":"embedded </script> inside value","ok":true};` +
      `something();</script>`;
    const data = extractStoreData(html);
    expect(data).toEqual({ review: 'embedded </script> inside value', ok: true });
  });

  it('handles nested objects and arrays', () => {
    const html =
      `<script>window.__STORE__={"products":[{"sku":"X","nested":{"a":{"b":1}}}],"n":3};</script>`;
    const data = extractStoreData(html);
    expect(data.products[0].sku).toBe('X');
    expect(data.products[0].nested.a.b).toBe(1);
    expect(data.n).toBe(3);
  });

  it('handles escaped quotes inside string values', () => {
    const html = `<script>window.__STORE__={"q":"he said \\"hi\\" today","ok":1};</script>`;
    const data = extractStoreData(html);
    expect(data.q).toBe('he said "hi" today');
    expect(data.ok).toBe(1);
  });

  it('tolerates other statements between the closing brace and </script>', () => {
    const html =
      `<script>window.__STORE__={"sku":"ABC"};\n` +
      `  window.foo = 1;\n` +
      `  console.log('ready');\n</script>`;
    const data = extractStoreData(html);
    expect(data).toEqual({ sku: 'ABC' });
  });

  it('returns null when __STORE__ is absent', () => {
    expect(extractStoreData('<html><body>no store here</body></html>')).toBeNull();
  });

  it('returns null on malformed JSON (unmatched brace)', () => {
    const html = `<script>window.__STORE__={"a":1,</script>`;
    expect(extractStoreData(html)).toBeNull();
  });
});

describe('detectHasMore', () => {
  it('returns true for a <link rel="next"> tag', () => {
    expect(detectHasMore('<head><link rel="next" href="/p/2"></head>')).toBe(true);
  });

  it('returns true for an <a rel="next"> tag', () => {
    expect(detectHasMore('<a href="/p/2" rel="next">Next</a>')).toBe(true);
  });

  it('returns true regardless of quote style', () => {
    expect(detectHasMore(`<a rel='next' href='/p/2'>Next</a>`)).toBe(true);
  });

  it('returns false when the word "next" appears but not as rel=next', () => {
    // This is the exact false-positive the old heuristic produced.
    expect(detectHasMore('<a href="/next-page">Go to next page</a>')).toBe(false);
    expect(detectHasMore('<div>The next one is great</div>')).toBe(false);
    expect(detectHasMore('{"cursor":"next"}')).toBe(false);
  });

  it('returns false on an empty or unrelated page', () => {
    expect(detectHasMore('')).toBe(false);
    expect(detectHasMore('<html><body>hello</body></html>')).toBe(false);
  });
});

describe('extractProductsFromHTML (end-to-end with new parser)', () => {
  it('extracts a product from a minified __STORE__ block', async () => {
    const html =
      `<html><body><script>window.__STORE__={` +
      `"products":[{"sku":"ABC123","displayName":"Test Phone","brand":"Samsung",` +
      `"categories":["Electronics","Phones"],"prices":{"rawPrice":50000},` +
      `"image":"https://img.jumia.com/x.jpg","url":"/test-phone.html",` +
      `"sellerEntity":{"name":"TechStore"}}]};</script></body></html>`;

    const products = await extractProductsFromHTML(html, 'NG');
    expect(products).toHaveLength(1);
    expect(products[0]?.sku).toBe('ABC123');
    expect(products[0]?.name).toBe('Test Phone');
    expect(products[0]?.brand).toBe('Samsung');
    expect(products[0]?.price).toBe(50000);
    expect(products[0]?.seller).toBe('TechStore');
    expect(products[0]?.country).toBe('NG');
  });

  it('returns empty array when __STORE__ is missing', async () => {
    const products = await extractProductsFromHTML('<html></html>', 'NG');
    expect(products).toEqual([]);
  });

  it('survives a </script> substring inside a product field', async () => {
    // The exact case that killed the old lazy regex.
    const html =
      `<script>window.__STORE__={"products":[{"sku":"S1","displayName":"Odd Name </script> here",` +
      `"brand":"B","prices":{"rawPrice":100},"url":"/s1.html",` +
      `"sellerEntity":{"name":"Seller1"}}]};</script>`;
    const products = await extractProductsFromHTML(html, 'NG');
    expect(products).toHaveLength(1);
    expect(products[0]?.sku).toBe('S1');
    expect(products[0]?.name).toBe('Odd Name </script> here');
  });
});
