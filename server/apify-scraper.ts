/**
 * Apify-powered Jumia scraper.
 *
 * Instead of hitting Jumia directly (which 403s from cloud datacenter IPs),
 * this module calls the Apify-hosted Jumia scraper actor via REST API.
 * Apify handles proxy rotation / residential IPs on their side — for free
 * up to $5/month of platform credits (resets monthly, no credit card).
 *
 * Setup:
 *   1. Sign up at apify.com (email only, no card).
 *   2. Console → Settings → Integrations → copy your API token.
 *   3. Add APIFY_TOKEN env var on Render.
 *
 * Actor used: fatihtahta/jumia-scraper (ID: GkIVpSwrMH8O8DB5H)
 * Docs: https://apify.com/fatihtahta/jumia-scraper
 *
 * Exported functions match the original jumia-scraper.ts signatures exactly
 * so routers.ts needs zero changes.
 */

const ACTOR_ID = 'GkIVpSwrMH8O8DB5H'; // fatihtahta/jumia-scraper
const APIFY_BASE = 'https://api.apify.com/v2';

// Products per page — Apify actor returns up to `limit` results.
// 40 matches Jumia's native page size.
const PAGE_SIZE = 40;

// Timeout for the synchronous actor run (ms).
// Apify runs typically complete in 15–60 s depending on load.
const RUN_TIMEOUT_MS = 120_000;

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

export interface JumiaProduct {
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

// ---------------------------------------------------------------------------
// Core: call the Apify actor synchronously and return mapped products
// ---------------------------------------------------------------------------
async function runApifyActor(
  input: Record<string, unknown>,
  country: string,
): Promise<JumiaProduct[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error(
      'APIFY_TOKEN environment variable is not set. ' +
      'Sign up at apify.com (free, no card) and add your token to Render env vars.',
    );
  }

  const url =
    `${APIFY_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items` +
    `?token=${token}&timeout=${Math.floor(RUN_TIMEOUT_MS / 1000)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS + 5000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Apify API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const items: any[] = await response.json();
  return items.map(item => mapApifyItem(item, country)).filter(Boolean) as JumiaProduct[];
}

// ---------------------------------------------------------------------------
// Map one Apify result item → JumiaProduct
// ---------------------------------------------------------------------------
function mapApifyItem(item: any, country: string): JumiaProduct | null {
  if (!item) return null;

  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;

  // Normalise URL: Apify returns full URL already; keep it
  const url = item.url || (item.path ? `${domain}${item.path}` : '');

  // SKU from item or parse from URL
  const sku =
    item.sku ||
    item.id ||
    (url.match(/[A-Z0-9]{10,}(?:AFAMZ|NFAMZ|KEFAMZ|GHFAMZ|EGFAMZ)/)?.[0] ?? '');

  const name = item.title || item.name || item.displayName || '';
  if (!name) return null;

  const price =
    typeof item.priceNumeric === 'number'
      ? item.priceNumeric
      : parseFloat(String(item.priceText ?? '0').replace(/[^0-9.]/g, '')) || 0;

  const oldPrice =
    typeof item.oldPriceNumeric === 'number'
      ? item.oldPriceNumeric
      : item.oldPriceText
      ? parseFloat(String(item.oldPriceText).replace(/[^0-9.]/g, ''))
      : undefined;

  return {
    sku,
    name,
    brand: item.brand || 'Unknown',
    category: Array.isArray(item.categories) ? item.categories.join(' > ') : (item.category ?? ''),
    price,
    oldPrice: oldPrice && !isNaN(oldPrice) ? oldPrice : undefined,
    discount: item.discountText || item.discount || undefined,
    rating: typeof item.rating === 'number' ? item.rating : (item.rating?.average ?? 0),
    totalRatings:
      typeof item.totalRatings === 'number'
        ? item.totalRatings
        : (item.rating?.totalRatings ?? 0),
    image: item.imageUrl || item.image || '',
    url,
    seller: item.seller || item.sellerName || (item.sellerId ? `Seller ${item.sellerId}` : 'Jumia'),
    isJumiaExpress: !!(item.expressShipping || item.isJumiaExpress || item.isShopExpress),
    isShopGlobal: !!(item.isShopGlobal || item.isGlobal),
    stock: item.isBuyable === false ? 'Out of Stock' : 'In Stock',
    tags: [],
    country,
  };
}

// ---------------------------------------------------------------------------
// Public: keyword search (mirrors original fetchJumiaPage signature)
// ---------------------------------------------------------------------------
export async function fetchJumiaPage(
  query: string,
  page: number = 1,
  options: FetchOptions = {},
): Promise<{ products: JumiaProduct[]; hasMore: boolean; debug?: Record<string, any> }> {
  const country = options.country ?? 'NG';
  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;

  // Apify actor doesn't support native pagination; we request enough items to
  // cover the requested page and slice. Each "page" = PAGE_SIZE items.
  const limit = page * PAGE_SIZE;
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const all = await runApifyActor(
      {
        queries: [query],
        startUrls: [`${domain}/catalog/?q=${encodeURIComponent(query)}`],
        limit,
        proxyConfiguration: { useApifyProxy: true },
      },
      country,
    );

    const products = all.slice(offset, offset + PAGE_SIZE);
    const hasMore = all.length >= limit;

    return {
      products,
      hasMore,
      debug: { source: 'apify', actor: ACTOR_ID, totalFetched: all.length, page, country },
    };
  } catch (error: any) {
    console.error('[Apify Scraper] fetchJumiaPage failed:', error?.message || error);
    return {
      products: [],
      hasMore: false,
      debug: { source: 'apify', error: error?.message, country },
    };
  }
}

// ---------------------------------------------------------------------------
// Public: fetch by URL (mirrors original fetchJumiaByUrl signature)
// ---------------------------------------------------------------------------
export async function fetchJumiaByUrl(
  url: string,
  options: FetchOptions = {},
): Promise<{ products: JumiaProduct[]; hasMore: boolean; debug?: Record<string, any> }> {
  let country = options.country ?? 'NG';
  for (const [code, domain] of Object.entries(JUMIA_DOMAINS)) {
    if (url.startsWith(domain)) { country = code; break; }
  }

  try {
    const products = await runApifyActor(
      {
        startUrls: [url],
        limit: PAGE_SIZE,
        proxyConfiguration: { useApifyProxy: true },
      },
      country,
    );

    return {
      products,
      hasMore: false,
      debug: { source: 'apify', actor: ACTOR_ID, url, country },
    };
  } catch (error: any) {
    console.error('[Apify Scraper] fetchJumiaByUrl failed:', error?.message || error);
    return {
      products: [],
      hasMore: false,
      debug: { source: 'apify', error: error?.message, url, country },
    };
  }
}

// ---------------------------------------------------------------------------
// Public: fetch by SKU list (mirrors original fetchProductsBySkuList signature)
// ---------------------------------------------------------------------------
export async function fetchProductsBySkuList(
  skus: string[],
  options: FetchOptions = {},
): Promise<JumiaProduct[]> {
  const country = options.country ?? 'NG';
  const results: JumiaProduct[] = [];

  for (const sku of skus) {
    try {
      const { products } = await fetchJumiaPage(sku, 1, { country });
      const exact = products.find(p => p.sku === sku) ?? products[0];
      if (exact) results.push(exact);
    } catch (error) {
      console.error(`[Apify Scraper] SKU ${sku} failed:`, error);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Filter & option helpers — identical to original, kept here so this module
// is a complete drop-in replacement.
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
