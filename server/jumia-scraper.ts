/**
 * Jumia Product Scraper with Anti-Blocking Measures
 * Handles data extraction from Jumia catalog pages
 *
 * FIXES (2025):
 * - Replaced fragile regex for window.__STORE__ with a robust brace-depth extractor
 *   that handles minified JSON, nested </script> text, and varying whitespace.
 * - Updated HTML cheerio CSS selectors to match Jumia's current markup:
 *     article cards: article.prd or article[data-sku]
 *     name:          h3.name
 *     price:         .prc
 *     old price:     .old
 *     image:         img.img or img[data-src]
 *     rating:        ._s{N} class encoding
 * - Added #catalog-listing anchor to search/SKU URLs (required by Jumia).
 * - Fixed hasMore detection to use rel="next" link tag instead of loose string match.
 * - Added DZ and IC country codes to align with urlScraper.
 */

import { load } from 'cheerio';
import { proxyFetchOptions } from './webshare-proxy.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

const JUMIA_DOMAINS: Record<string, string> = {
  NG: 'https://www.jumia.com.ng',
  KE: 'https://www.jumia.co.ke',
  UG: 'https://www.jumia.ug',
  EG: 'https://www.jumia.com.eg',
  GH: 'https://www.jumia.com.gh',
  CI: 'https://www.jumia.ci',
  MA: 'https://www.jumia.ma',
  TN: 'https://www.jumia.com.tn',
  ZA: 'https://www.zando.co.za',
  SN: 'https://www.jumia.sn',
  DZ: 'https://www.jumia.com.dz',
  IC: 'https://www.jumia.is',
};

interface JumiaProduct {
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  oldPrice?: number;
  discount?: string;
  rating?: number;
  totalRatings?: number;
  image: string;
  url: string;
  seller?: string;
  isJumiaExpress: boolean;
  isShopGlobal: boolean;
  stock?: string;
  tags?: string[];
  country: string;
}

interface FetchOptions {
  country?: string;
  delay?: number;
  timeout?: number;
}

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Robust window.__STORE__ extractor
// ---------------------------------------------------------------------------
// The old single-regex /{[\s\S]*?};\s*<\/script>/ fails when:
//   1. The JSON contains "</script>" inside string values (escaped or not).
//   2. The script block is minified so there's no whitespace before </script>.
//   3. The closing pattern is `};</script>` with no space.
//
// Fix: locate the opening `{`, then walk character-by-character counting
// brace depth while respecting JSON string escaping to find the exact end.
// ---------------------------------------------------------------------------
function extractStoreData(html: string): any | null {
  const marker = 'window.__STORE__=';
  const markerAlt = 'window.__STORE__ =';
  let markerIdx = html.indexOf(marker);
  if (markerIdx === -1) markerIdx = html.indexOf(markerAlt);
  if (markerIdx === -1) return null;

  const jsonStart = html.indexOf('{', markerIdx);
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let jsonEnd = -1;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { jsonEnd = i; break; }
    }
  }

  if (jsonEnd === -1) return null;

  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd + 1));
  } catch {
    // Legacy regex fallback in case brace-walker edge case
    const m = html.match(/window\.__STORE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (m) { try { return JSON.parse(m[1]); } catch { /* ignore */ } }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seller fetch from product detail page
// ---------------------------------------------------------------------------
async function fetchSellerFromProductPage(productUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(productUrl, {
      method: 'GET',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
      signal: controller.signal,
      ...proxyFetchOptions(),
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const html = await response.text();
    const JUNK = ['العربية', 'Appliances', 'Sign In', 'Jumia'];

    // 1. __STORE__ (robust)
    const storeData = extractStoreData(html);
    if (storeData) {
      const candidates = [
        storeData.viewData?.seller?.name,
        storeData.googleAds?.targeting?.seller?.[0],
        storeData.products?.[0]?.sellerEntity?.name,
        storeData.products?.[0]?.sellerName,
        storeData.product?.sellerEntity?.name,
        storeData.product?.sellerName,
      ];
      for (const c of candidates) {
        if (c && !JUNK.includes(c)) return c;
      }
    }

    // 2. Cheerio HTML fallback — current Jumia seller section
    const $ = load(html);
    const sellerText = $('[data-qa="seller-name"], .-plxs.-pbxs .-b, .sold-by a, .-seller a').first().text().trim();
    if (sellerText && !JUNK.includes(sellerText) && sellerText.length > 1) return sellerText;

    const sellerSection = $('h2:contains("Seller Information"), h2:contains("Informations sur le vendeur")').closest('.card, section');
    if (sellerSection.length > 0) {
      const nameInLink = sellerSection.find('a[href*="/"]').first().text().trim();
      if (nameInLink && !JUNK.includes(nameInLink) && nameInLink.length > 2) return nameInLink;
    }

    // 3. JSON-LD
    const jsonLd = $('script[type="application/ld+json"]').html();
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd);
        if (data.seller?.name && !JUNK.includes(data.seller.name)) return data.seller.name;
      } catch { /* ignore */ }
    }

    return null;
  } catch (error) {
    console.error(`[Jumia Scraper] Error fetching seller from ${productUrl}:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core HTTP fetch
// ---------------------------------------------------------------------------
async function fetchPage(url: string, timeout = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
      signal: controller.signal,
      ...proxyFetchOptions(),
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public: fetch by URL
// ---------------------------------------------------------------------------
export async function fetchJumiaByUrl(
  url: string,
  options: FetchOptions = {}
): Promise<{ products: JumiaProduct[]; hasMore: boolean; debug?: Record<string, any> }> {
  const delayMs = options.delay ?? Math.random() * 2000 + 1000;
  const timeout = options.timeout ?? 30000;

  await delay(delayMs);

  let country = options.country ?? 'NG';
  for (const [code, domain] of Object.entries(JUMIA_DOMAINS)) {
    if (url.startsWith(domain)) { country = code; break; }
  }

  const proxied = !!(process.env.WEBSHARE_PROXY_USERNAME && process.env.WEBSHARE_PROXY_PASSWORD);

  try {
    const response = await fetchPage(url, timeout);

    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        console.warn(`[Jumia Scraper] Rate limited (${response.status}). Returning empty.`);
        return { products: [], hasMore: false, debug: { httpStatus: response.status, proxied, url } };
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const responseBytes = html.length;

    // Check if this looks like a bot-challenge page (HTTP 200 but not a real catalog)
    const looksBlocked = responseBytes < 5000 ||
      /access denied|captcha|are you a human|px-captcha|just a moment|cf-challenge/i.test(html.slice(0, 20000));

    // Run extraction and capture intermediate state for diagnostics
    const storeData = (() => {
      const marker = 'window.__STORE__=';
      const markerAlt = 'window.__STORE__ =';
      return html.includes(marker) || html.includes(markerAlt);
    })();

    const products = looksBlocked ? [] : await extractProductsFromHTML(html, country);
    const hasMore = (
      html.includes('rel="next"') || html.includes("rel='next'")
    ) && products.length > 0;

    const debug = {
      httpStatus: response.status,
      responseBytes,
      storeBlockFound: storeData,
      looksBlocked,
      proxied,
      url,
    };

    if (looksBlocked) {
      console.warn(`[Jumia Scraper] Response looks like a challenge page (${responseBytes} bytes)`);
    }

    return { products, hasMore, debug };
  } catch (error) {
    console.error(`[Jumia Scraper] Error fetching ${url}:`, error);
    return { products: [], hasMore: false, debug: { error: String(error), proxied, url } };
  }
}

// ---------------------------------------------------------------------------
// Public: keyword search — appends #catalog-listing required by Jumia
// ---------------------------------------------------------------------------
export async function fetchJumiaPage(
  query: string,
  page: number = 1,
  options: FetchOptions = {}
): Promise<{ products: JumiaProduct[]; hasMore: boolean; debug?: Record<string, any> }> {
  const country = options.country ?? 'NG';
  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;
  const catalogUrl = `${domain}/catalog/?q=${encodeURIComponent(query)}&page=${page}#catalog-listing`;
  return fetchJumiaByUrl(catalogUrl, options);
}

// ---------------------------------------------------------------------------
// Public: SKU list search
// ---------------------------------------------------------------------------
export async function fetchProductsBySkuList(
  skus: string[],
  options: FetchOptions = {}
): Promise<JumiaProduct[]> {
  const country = options.country ?? 'NG';
  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;
  const products: JumiaProduct[] = [];

  for (const sku of skus) {
    try {
      const searchUrl = `${domain}/catalog/?q=${encodeURIComponent(sku)}#catalog-listing`;
      const { products: found } = await fetchJumiaByUrl(searchUrl, { ...options, delay: 500 });
      if (found.length > 0) {
        const exact = found.find(p => p.sku === sku);
        products.push(exact ?? found[0]);
      }
    } catch (error) {
      console.error(`[Jumia Scraper] Error fetching SKU ${sku}:`, error);
    }
  }

  return products;
}

// ---------------------------------------------------------------------------
// Core: extract products from HTML
// Primary:  window.__STORE__.products[]
// Fallback: Cheerio parsing of article cards
// ---------------------------------------------------------------------------
export async function extractProductsFromHTML(html: string, country: string): Promise<JumiaProduct[]> {
  try {
    const storeData = extractStoreData(html);

    if (storeData?.products && Array.isArray(storeData.products) && storeData.products.length > 0) {
      const results: JumiaProduct[] = [];
      const needsSeller: number[] = [];

      for (const product of storeData.products) {
        const extracted = buildProductFromStore(product, country, storeData);
        if (extracted) {
          if (!extracted.seller || extracted.seller === 'Jumia') needsSeller.push(results.length);
          results.push(extracted);
        }
      }

      // Concurrent seller resolution (max 8, 8 s timeout)
      if (needsSeller.length > 0) {
        const CONCURRENCY = 8;
        const JUNK = ['العربية', 'Appliances', 'Sign In'];
        for (let i = 0; i < needsSeller.length; i += CONCURRENCY) {
          const batch = needsSeller.slice(i, i + CONCURRENCY);
          const fetched = await Promise.all(
            batch.map(async idx => {
              const u = results[idx]?.url;
              if (!u) return 'Jumia';
              try {
                const result = await Promise.race([
                  fetchSellerFromProductPage(u),
                  new Promise<null>(r => setTimeout(() => r(null), 8000)),
                ]);
                return (result && !JUNK.includes(result) && result !== 'Jumia') ? result : 'Jumia';
              } catch { return 'Jumia'; }
            })
          );
          fetched.forEach((seller, j) => {
            const idx = batch[j];
            if (idx !== undefined && results[idx]) results[idx].seller = seller;
          });
        }
      }

      return results;
    }

    // __STORE__ absent or empty — fall back to Cheerio
    console.warn('[Jumia Scraper] __STORE__ not found or empty — falling back to HTML parsing');
    return extractProductsCheerio(html, country);

  } catch (error) {
    console.error('[Jumia Scraper] Error parsing HTML:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Build a JumiaProduct from a __STORE__ product object
// ---------------------------------------------------------------------------
function buildProductFromStore(product: any, country: string, storeData: any): JumiaProduct | null {
  if (!product.sku || !product.displayName) return null;

  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;
  const JUNK = ['العربية', 'Appliances', 'Sign In'];

  let seller: string =
    (!JUNK.includes(product.sellerEntity?.name) && product.sellerEntity?.name) ||
    (!JUNK.includes(product.sellerName) && product.sellerName) ||
    (!JUNK.includes(product.seller) && product.seller) ||
    (!JUNK.includes(storeData?.googleAds?.targeting?.seller?.[0]) &&
      storeData?.googleAds?.targeting?.seller?.[0]) ||
    'Jumia';

  if (JUNK.includes(seller)) seller = 'Jumia';

  return {
    sku: product.sku,
    name: product.displayName || '',
    brand: product.brand || 'Unknown',
    category: Array.isArray(product.categories) ? product.categories.join(' > ') : '',
    price:
      product.prices?.rawPrice ??
      (product.prices?.price ? parseFloat(String(product.prices.price).replace(/[^0-9.]/g, '')) : 0),
    oldPrice: product.prices?.rawOldPrice ?? undefined,
    discount: product.prices?.discount ?? undefined,
    rating: product.rating?.average ?? 0,
    totalRatings: product.rating?.totalRatings ?? 0,
    image: product.image || '',
    url: product.url ? `${domain}${product.url}` : '',
    seller,
    isJumiaExpress: !!(product.isJumiaExpress || product.isShopExpress || product.shopExpress),
    isShopGlobal: !!product.isShopGlobal,
    stock: product.stockInfo?.text ?? 'In Stock',
    tags: product.tags ? String(product.tags).split('|').filter(Boolean) : [],
    country,
  };
}

// ---------------------------------------------------------------------------
// Cheerio fallback: parse catalog article cards
//
// Jumia's current catalog HTML (2025):
//   <article class="prd _si col4" data-sku="XXXX">
//     <a class="core" href="/product-slug/.../">
//       <div class="img-c"><img class="img" data-src="https://...jpg" /></div>
//       <div class="info">
//         <h3 class="name">Product Name</h3>
//         <div class="prc">₦1,234</div>
//         <div class="old">₦2,000</div>          (optional)
//         <div class="bdg _expr">Jumia Express</div>
//         <div class="rev"><div class="stars _s4"></div><span>123</span></div>
//       </div>
//     </a>
//   </article>
// ---------------------------------------------------------------------------
function extractProductsCheerio(html: string, country: string): JumiaProduct[] {
  const $ = load(html);
  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;
  const products: JumiaProduct[] = [];

  $('article.prd, article[data-sku], article.c-prd').each((_, el) => {
    const $el = $(el);

    const sku = ($el.attr('data-sku') || $el.find('[data-sku]').first().attr('data-sku') || '') as string;

    const anchor = $el.find('a.core, a[href]').first();
    const relUrl = anchor.attr('href') || '';
    const url = relUrl.startsWith('http') ? relUrl : relUrl ? `${domain}${relUrl}` : '';

    const name =
      $el.find('h3.name, h3[class*="name"], .info h3').first().text().trim() ||
      $el.find('h3').first().text().trim();

    if (!name) return;

    const rawPrice = $el.find('.prc').first().text().replace(/[^0-9.]/g, '');
    const price = rawPrice ? parseFloat(rawPrice) : 0;

    const rawOld = $el.find('.old').first().text().replace(/[^0-9.]/g, '');
    const oldPrice = rawOld ? parseFloat(rawOld) : undefined;

    const discount = $el.find('.bdg._dsc, .-dsc').first().text().trim() || undefined;

    // Rating encoded as class _s{N} on stars element
    const starsClass = $el.find('[class*="_s"]').first().attr('class') || '';
    const starsMatch = starsClass.match(/_s(\d)/);
    const rating = starsMatch ? parseInt(starsMatch[1], 10) : 0;

    const ratingsText = $el.find('.rev span, .-rev span').first().text().replace(/[^0-9]/g, '');
    const totalRatings = ratingsText ? parseInt(ratingsText, 10) : 0;

    const imgEl = $el.find('img.img, img[data-src], img[src]').first();
    const image = imgEl.attr('data-src') || imgEl.attr('src') || '';

    const isJumiaExpress = $el.find('.bdg._expr, .-expr, [class*="express"]').length > 0;
    const isShopGlobal = $el.find('.bdg._glbl, [class*="global"]').length > 0;
    const isOutOfStock = $el.find('.-stockout, [class*="stockout"]').length > 0;

    if (!sku && !url) return;

    products.push({
      sku,
      name,
      brand: ($el.attr('data-brand') as string) || 'Unknown',
      category: '',
      price,
      oldPrice,
      discount,
      rating,
      totalRatings,
      image,
      url,
      seller: 'Jumia',
      isJumiaExpress,
      isShopGlobal,
      stock: isOutOfStock ? 'Out of Stock' : 'In Stock',
      tags: [],
      country,
    });
  });

  return products;
}

// ---------------------------------------------------------------------------
// Filter & option helpers (unchanged)
// ---------------------------------------------------------------------------
export function filterProducts(products: JumiaProduct[], filters: any): JumiaProduct[] {
  return products.filter(product => {
    if (filters.brands?.length > 0 && !filters.brands.includes(product.brand)) return false;
    if (filters.sellers?.length > 0 && !filters.sellers.includes(product.seller)) return false;
    if (filters.minPrice !== undefined && product.price < filters.minPrice) return false;
    if (filters.maxPrice !== undefined && product.price > filters.maxPrice) return false;
    if (filters.minRating !== undefined && (product.rating ?? 0) < filters.minRating) return false;
    if (filters.jumiaExpress !== undefined && product.isJumiaExpress !== filters.jumiaExpress) return false;
    if (filters.shopGlobal !== undefined && product.isShopGlobal !== filters.shopGlobal) return false;
    if (filters.tags?.length > 0) {
      if (!product.tags || !filters.tags.some((tag: string) => product.tags?.includes(tag))) return false;
    }
    return true;
  });
}

export function getFilterOptions(products: JumiaProduct[]) {
  const brands = Array.from(new Set(products.map(p => p.brand))).filter(Boolean).sort();
  const sellers = Array.from(new Set(products.map(p => p.seller))).filter(Boolean).sort();
  const tags = Array.from(new Set(products.flatMap(p => p.tags ?? []))).filter(Boolean).sort();
  const prices = products.map(p => p.price);
  return {
    brands,
    sellers,
    tags,
    priceRange: {
      min: Math.floor(Math.min(...(prices.length ? prices : [0]))),
      max: Math.ceil(Math.max(...(prices.length ? prices : [0]))),
    },
  };
}
