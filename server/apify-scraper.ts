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
 * Actor used: stealth_mode/jumia-product-search-scraper (ID: tuztasQdcfHmG4WIJ)
 * Docs: https://apify.com/stealth_mode/jumia-product-search-scraper
 *
 * Exported functions match the original jumia-scraper.ts signatures exactly
 * so routers.ts needs zero changes.
 */

const ACTOR_ID = 'tuztasQdcfHmG4WIJ'; // stealth_mode/jumia-product-search-scraper
const APIFY_BASE = 'https://api.apify.com/v2';
const PAGE_SIZE = 40;

// How long to wait for the actor to complete (ms). Apify free tier runs can
// take 2–5 minutes. We poll every 5 s and give up after 8 minutes total.
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 480_000; // 8 minutes

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
// Core: call the Apify actor asynchronously and return mapped products.
// We start the run, poll until it finishes, then fetch the dataset items.
// This avoids the synchronous endpoint's hard timeout.
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

  // Step 1: Start the actor run (async)
  const startRes = await fetch(
    `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!startRes.ok) {
    const body = await startRes.text().catch(() => '');
    throw new Error(`Apify start error ${startRes.status}: ${body.slice(0, 300)}`);
  }
  const startData: any = await startRes.json();
  const runId: string = startData?.data?.id;
  const datasetId: string = startData?.data?.defaultDatasetId;
  if (!runId) throw new Error('Apify did not return a run ID');

  // Step 2: Poll until the run finishes or we time out
  const deadline = Date.now() + MAX_WAIT_MS;
  let status = 'RUNNING';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const statusRes = await fetch(
      `${APIFY_BASE}/actor-runs/${runId}?token=${token}`,
    );
    if (!statusRes.ok) continue;
    const statusData: any = await statusRes.json();
    status = statusData?.data?.status ?? 'RUNNING';

    if (status === 'SUCCEEDED') break;
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${runId} ended with status: ${status}`);
    }
    // RUNNING or READY — keep polling
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify run ${runId} did not complete within ${MAX_WAIT_MS / 1000}s (status: ${status})`);
  }

  // Step 3: Fetch dataset items
  const dataRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json&limit=${PAGE_SIZE}`,
  );
  if (!dataRes.ok) {
    throw new Error(`Apify dataset fetch error ${dataRes.status}`);
  }
  const items: any[] = await dataRes.json();
  return items.map(item => mapApifyItem(item, country)).filter(Boolean) as JumiaProduct[];
}

// ---------------------------------------------------------------------------
// Map one Apify result item → JumiaProduct
// Actor output uses snake_case fields:
//   sku, name, display_name, brand, seller_id, prices.raw_price,
//   prices.old_price, prices.discount, rating.average, rating.total_ratings,
//   image, url, is_shop_express, categories, is_buyable, tags
// ---------------------------------------------------------------------------
function mapApifyItem(item: any, country: string): JumiaProduct | null {
  if (!item) return null;

  const domain = JUMIA_DOMAINS[country] ?? JUMIA_DOMAINS.NG;

  // URL: actor returns relative path like "/product-slug.html"
  const rawUrl = item.url || item.URL || '';
  const url = rawUrl.startsWith('http') ? rawUrl : `${domain}${rawUrl}`;

  const name = item.display_name || item.name || item.displayName || '';
  if (!name) return null;

  const sku = item.sku || item.SKU || '';

  // Prices: actor uses snake_case prices object
  const prices = item.prices || {};
  const price =
    typeof prices.raw_price === 'string'
      ? parseFloat(prices.raw_price) || 0
      : typeof item.priceNumeric === 'number'
      ? item.priceNumeric
      : 0;

  const oldPrice =
    typeof prices.old_price === 'string' && prices.old_price
      ? parseFloat(prices.old_price.replace(/[^0-9.]/g, '')) || undefined
      : undefined;

  const discount = prices.discount || item.discountText || undefined;

  // Rating: actor returns rating.average and rating.total_ratings
  const ratingObj = item.rating || {};
  const rating =
    typeof ratingObj.average === 'number'
      ? ratingObj.average
      : typeof item.rating === 'number'
      ? item.rating
      : 0;
  const totalRatings =
    typeof ratingObj.total_ratings === 'number'
      ? ratingObj.total_ratings
      : 0;

  // Tags: actor returns pipe-separated string e.g. "BLF_04|BLF_12"
  const tags =
    typeof item.tags === 'string'
      ? item.tags.split('|').filter(Boolean)
      : Array.isArray(item.tags)
      ? item.tags
      : [];

  const isShopExpress = !!(item.is_shop_express || item.isShopExpress || item.expressShipping);

  return {
    sku,
    name,
    brand: item.brand || 'Unknown',
    category: Array.isArray(item.categories) ? item.categories.join(' > ') : '',
    price,
    oldPrice,
    discount,
    rating,
    totalRatings,
    image: item.image || item.imageUrl || '',
    url,
    seller: item.seller || item.sellerName || (item.seller_id ? `Seller ${item.seller_id}` : 'Jumia'),
    isJumiaExpress: isShopExpress,
    isShopGlobal: !!(item.isShopGlobal || item.is_shop_global),
    stock: item.is_buyable === false ? 'Out of Stock' : 'In Stock',
    tags,
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

  // Build the catalog URL with page number and the #catalog-listing anchor
  // which the stealth_mode actor expects (shown in its example)
  const searchUrl = `${domain}/catalog/?q=${encodeURIComponent(query)}&page=${page}#catalog-listing/`;

  try {
    const products = await runApifyActor(
      {
        proxy: { useApifyProxy: true },
        max_items_per_url: PAGE_SIZE,
        ignore_url_failures: true,
        urls: [searchUrl],
      },
      country,
    );

    // hasMore: if we got a full page, there's likely a next page
    const hasMore = products.length >= PAGE_SIZE;

    return {
      products,
      hasMore,
      debug: { source: 'apify', actor: ACTOR_ID, totalFetched: products.length, page, country, url: searchUrl },
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
        proxy: { useApifyProxy: true },
        max_items_per_url: PAGE_SIZE,
        ignore_url_failures: true,
        urls: [url],
      },
      country,
    );

    return {
      products,
      hasMore: false,
      debug: { source: 'apify', actor: ACTOR_ID, totalFetched: products.length, url, country },
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
// Filter & option helpers — identical to original
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
