/**
 * Jumia Product Scraper with Anti-Blocking Measures
 * Handles data extraction from Jumia catalog pages
 */

import { load } from 'cheerio';
import { proxiedFetch, isProxyConfigured } from './proxy-fetch';

/**
 * Robustly extract the `window.__STORE__ = {...}` JSON object from a Jumia HTML page.
 *
 * The old regex `window\.__STORE__\s*=\s*({[\s\S]*?});\s*<\/script>` is too strict:
 *   - it uses a lazy match that gets confused by large minified JSON blobs,
 *   - it requires the object to end with `};` immediately followed by `</script>`,
 *     which stopped being true after Jumia's HTML update.
 *
 * This helper locates the assignment, then walks the string character-by-character
 * respecting strings and escapes to find the matching closing brace. That way we
 * don't care what (if anything) comes after the object before `</script>`.
 *
 * Returns the parsed JSON object, or `null` if the assignment cannot be found /
 * the JSON fails to parse.
 */
export function extractStoreData(html: string): any | null {
  // Allow any whitespace / var|let|const prefix and any assignment form.
  const anchor = html.search(/window\.__STORE__\s*=\s*\{/);
  if (anchor === -1) return null;

  // Position the cursor on the opening `{` of the object.
  const braceStart = html.indexOf('{', anchor);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let escaped = false;
  let end = -1;

  for (let i = braceStart; i < html.length; i++) {
    const c = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else if (c === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (c === '"' || c === '\'') {
      inString = true;
      stringQuote = c;
      continue;
    }

    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return null;

  const jsonText = html.slice(braceStart, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

/**
 * Detect whether a Jumia catalog / search page has a "next page" available.
 *
 * The previous heuristic (`html.includes('next')`) matched thousands of
 * unrelated tokens — any product named "Next", any script reference, etc. —
 * and gave false positives that caused the paginator to request empty pages.
 *
 * Current Jumia pagination markup emits a `<link rel="next">` in <head> and/or
 * `<a rel="next">` at the bottom of the listing. We match on that attribute
 * only, which is both specific and stable.
 */
export function detectHasMore(html: string): boolean {
  return /<(?:link|a)[^>]+rel=["']next["']/i.test(html);
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
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

/**
 * Get a random user agent to avoid detection
 */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Add random delay to avoid rate limiting
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch seller name from product details page
 */
async function fetchSellerFromProductPage(productUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await proxiedFetch(productUrl, {
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
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Try to extract seller from window.__STORE__ first (robust brace-matching
    // parser — handles Jumia's updated HTML where the old lazy regex fails).
    const storeData = extractStoreData(html);
    if (storeData) {
      try {
        // Check for specific seller info in storeData.viewData.seller.name (common for MA and EG)
        if (storeData.viewData?.seller?.name) {
          const name = storeData.viewData.seller.name;
          if (name && !['العربية', 'Appliances', 'Sign In'].includes(name)) return name;
        }

        // Check for googleAds targeting seller (very reliable for MA and EG)
        if (storeData.googleAds?.targeting?.seller?.[0]) {
          const name = storeData.googleAds.targeting.seller[0];
          if (name && !['العربية', 'Appliances', 'Sign In'].includes(name)) return name;
        }

        // Look for seller info in the store data products array
        if (storeData.products && Array.isArray(storeData.products) && storeData.products.length > 0) {
          const product = storeData.products[0];
          if (product.sellerEntity?.name && !['العربية', 'Appliances', 'Sign In'].includes(product.sellerEntity.name)) {
            return product.sellerEntity.name;
          }
          if (product.sellerName && product.sellerName !== 'العربية') {
            return product.sellerName;
          }
        }
      } catch (e) {
        // Continue to HTML parsing if JSON parsing fails
      }
    }

    // Fallback: Parse HTML using Cheerio to find seller information
    const $ = load(html);
    
    // Look for seller information in the page
    // Common patterns: "Seller Information" section with seller name
    const sellerSection = $('h2:contains("Seller Information"), h2:contains("Informations sur le vendeur")').closest('.card, section');
    if (sellerSection.length > 0) {
      // Look for seller name in common elements
      const nameInLink = sellerSection.find('a[href*="/"]').first().text().trim();
      if (nameInLink && !['Seller Information', 'Informations sur le vendeur', 'العربية', 'Appliances', 'Sign In', 'Jumia'].includes(nameInLink)) {
        return nameInLink;
      }
      
      const sellerText = sellerSection.text();
      // Extract seller name from the section
      const nameMatch = sellerText.match(/(?:Seller Information|Informations sur le vendeur)\s*([^\n]+)/i);
      if (nameMatch && nameMatch[1]) {
        const sellerName = nameMatch[1].trim().split('\n')[0];
        if (sellerName && !['Seller Information', 'Informations sur le vendeur', 'العربية', 'Appliances', 'Sign In'].includes(sellerName)) {
          return sellerName;
        }
      }
    }

    // Alternative: Look for seller link or name in product details
    const sellerLink = $('a[href*="/"]').filter((i, el) => {
      const text = $(el).text().trim();
      return !!(text && !text.toLowerCase().includes('jumia') && text !== 'العربية' && text.length > 2 && text.length < 100);
    }).first();

    if (sellerLink.length > 0) {
      const text = sellerLink.text().trim();
      if (text && text.toLowerCase() !== 'jumia' && !['العربية', 'Appliances', 'Sign In'].includes(text) && text.length > 2) {
        return text;
      }
    }

    // Last resort: Look for any seller-related text in meta tags or structured data
    const jsonLd = $('script[type="application/ld+json"]').html();
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd);
        if (data.seller?.name && !['العربية', 'Appliances', 'Sign In'].includes(data.seller.name)) {
          return data.seller.name;
        }
      } catch (e) {
        // Continue
      }
    }

    return null;
  } catch (error) {
    console.error(`[Jumia Scraper] Error fetching seller from product page ${productUrl}:`, error);
    return null;
  }
}

interface FetchResult {
  products: JumiaProduct[];
  hasMore: boolean;
  /** If the fetch failed or was blocked, a short machine-readable reason. */
  error?: 'blocked' | 'rate_limited' | 'http_error' | 'network_error' | 'parse_failed' | 'timeout';
  /** Optional diagnostic details for debugging — safe to show in the UI. */
  debug?: {
    httpStatus?: number;
    fetchedBytes?: number;
    storeBlockFound?: boolean;
    rawProductCount?: number;
    url?: string;
    /** True when this request went through PROXY_URL; false means direct. */
    proxied?: boolean;
  };
}

/**
 * Fetch a Jumia catalog page with anti-blocking measures
 */
export async function fetchJumiaByUrl(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const delayMs = options.delay || Math.random() * 2000 + 1000;
  const timeout = options.timeout || 30000;
  const proxied = isProxyConfigured();

  await delay(delayMs);

  // Determine country from URL
  let country = options.country || 'NG';
  for (const [code, domain] of Object.entries(JUMIA_DOMAINS)) {
    if (url.startsWith(domain)) {
      country = code;
      break;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Pick a User-Agent and send the matching Sec-CH-UA client hints alongside
    // it. Modern Jumia bot detection (PerimeterX / HUMAN) flags requests that
    // present a Chrome UA without the corresponding client-hint headers.
    const ua = getRandomUserAgent();
    const chromeMatch = ua.match(/Chrome\/(\d+)/);
    const isChrome = !!chromeMatch && !ua.includes('Firefox');
    const chromeMajor = chromeMatch ? chromeMatch[1] : '120';
    const platform = /Windows/.test(ua)
      ? '"Windows"'
      : /Macintosh/.test(ua)
      ? '"macOS"'
      : '"Linux"';

    const headers: Record<string, string> = {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      // NOTE: intentionally NOT requesting brotli — Node's fetch does not
      // decode br on older runtimes and Jumia will happily serve it, yielding
      // a garbled body that our parser can't match.
      'Accept-Encoding': 'gzip, deflate',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    };
    if (isChrome) {
      headers['sec-ch-ua'] = `"Not_A Brand";v="8", "Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}"`;
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = platform;
    }

    const response = await proxiedFetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const reason: FetchResult['error'] =
        response.status === 403 ? 'blocked'
        : response.status === 429 ? 'rate_limited'
        : 'http_error';
      console.warn(`[Jumia Scraper] ${reason} (HTTP ${response.status}) for ${url}`);
      return {
        products: [],
        hasMore: false,
        error: reason,
        debug: { httpStatus: response.status, url, proxied },
      };
    }

    const html = await response.text();
    const bytes = html.length;

    // Defensive: if Jumia served us a short HTML body or an interstitial
    // (captcha, "Access denied", Cloudflare/PX challenge page), surface that
    // explicitly instead of silently returning an empty product list.
    const looksBlocked =
      bytes < 5000 ||
      /access denied|captcha|are you a human|px-captcha|just a moment|cf-challenge/i.test(html.slice(0, 20000));
    if (looksBlocked) {
      console.warn(`[Jumia Scraper] Response looks like a block page (${bytes} bytes) for ${url}`);
      return {
        products: [],
        hasMore: false,
        error: 'blocked',
        debug: { httpStatus: response.status, fetchedBytes: bytes, url, proxied },
      };
    }

    // Inspect the window.__STORE__ block directly so we can tell the
    // difference between "parse failed" and "Jumia returned a genuinely
    // empty product list".
    const storeData = extractStoreData(html);
    const storeBlockFound = storeData !== null;
    const rawProductCount = Array.isArray(storeData?.products) ? storeData.products.length : 0;

    const products = await extractProductsFromHTML(html, country);
    const hasMore = detectHasMore(html) && products.length > 0;

    const result: FetchResult = {
      products,
      hasMore,
      debug: { httpStatus: response.status, fetchedBytes: bytes, storeBlockFound, rawProductCount, url, proxied },
    };
    if (!storeBlockFound) {
      result.error = 'parse_failed';
    }
    return result;
  } catch (error: any) {
    const isTimeout = error?.name === 'AbortError';
    console.error(`[Jumia Scraper] ${isTimeout ? 'Timeout' : 'Network error'} fetching ${url}:`, error?.message || error);
    return {
      products: [],
      hasMore: false,
      error: isTimeout ? 'timeout' : 'network_error',
      debug: { url, proxied },
    };
  }
}

export async function fetchJumiaPage(
  query: string,
  page: number = 1,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const country = options.country || 'NG';
  const domain = JUMIA_DOMAINS[country] || JUMIA_DOMAINS.NG;
  // Jumia expects the #catalog-listing anchor on search URLs — without it, some
  // markets redirect or return a non-catalog landing page.
  const catalogUrl = `${domain}/catalog/?q=${encodeURIComponent(query)}&page=${page}#catalog-listing`;

  return fetchJumiaByUrl(catalogUrl, options);
}

/**
 * Fetch products by SKU list
 */
export async function fetchProductsBySkuList(
  skus: string[],
  options: FetchOptions = {}
): Promise<JumiaProduct[]> {
  const country = options.country || 'NG';
  const domain = JUMIA_DOMAINS[country] || JUMIA_DOMAINS.NG;
  const products: JumiaProduct[] = [];

  for (const sku of skus) {
    try {
      // On Jumia, we can search by SKU directly. The #catalog-listing anchor is
      // required on current Jumia pages to land on the listing (see fetchJumiaPage).
      const searchUrl = `${domain}/catalog/?q=${encodeURIComponent(sku)}#catalog-listing`;
      const { products: foundProducts } = await fetchJumiaByUrl(searchUrl, { ...options, delay: 500 });
      
      if (foundProducts.length > 0) {
        // Find the exact SKU match if possible
        const exactMatch = foundProducts.find(p => p.sku === sku);
        if (exactMatch) {
          products.push(exactMatch);
        } else {
          products.push(foundProducts[0]);
        }
      }
    } catch (error) {
      console.error(`[Jumia Scraper] Error fetching SKU ${sku}:`, error);
    }
  }

  return products;
}

/**
 * Extract products from Jumia HTML page
 * Looks for window.__STORE__ JSON object
 */
export async function extractProductsFromHTML(html: string, country: string): Promise<JumiaProduct[]> {
  try {
    // Robust brace-matching parser — handles Jumia's updated minified HTML where
    // the previous lazy regex `({[\s\S]*?});\s*<\/script>` no longer matches.
    const storeData = extractStoreData(html);

    if (!storeData) {
      console.warn('[Jumia Scraper] Could not find window.__STORE__ in HTML');
      return [];
    }

    if (!storeData.products || !Array.isArray(storeData.products)) {
      return [];
    }

    // Per-page cache so that if the same `sellerId` appears on multiple rows
    // we only hit its PDP once. Values are the in-flight Promises so that
    // concurrent workers resolving the same sellerId coalesce on a single
    // fetch (rather than each starting a duplicate one).
    const sellerNameCache = new Map<string, Promise<string | null>>();

    // Concurrency cap. Catalog pages carry up to 40 products; each one that
    // needs a seller name triggers a PDP fetch. We run these in parallel but
    // cap the in-flight count so we don't hammer Jumia. Six is conservative
    // and mirrors what a real browser does when loading inline resources.
    const CONCURRENCY = 6;
    const sourceProducts = storeData.products;
    const results: (JumiaProduct | null)[] = new Array(sourceProducts.length).fill(null);
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= sourceProducts.length) return;
        try {
          results[idx] = await extractProductData(
            sourceProducts[idx],
            country,
            storeData,
            sellerNameCache,
          );
        } catch (err) {
          console.error('[Jumia Scraper] Error extracting product at index', idx, err);
          results[idx] = null;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, sourceProducts.length) }, () => worker()),
    );

    return results.filter((p): p is JumiaProduct => p !== null);
  } catch (error) {
    console.error('[Jumia Scraper] Error parsing HTML:', error);
    return [];
  }
}

/**
 * Extract individual product data from Jumia product object
 */
async function extractProductData(
  product: any,
  country: string,
  storeData?: any,
  sellerNameCache?: Map<string, Promise<string | null>>,
): Promise<JumiaProduct | null> {
  try {
    if (!product.sku || !product.displayName) {
      return null;
    }

    const domain = JUMIA_DOMAINS[country] || JUMIA_DOMAINS.NG;
    
    // Improved seller extraction logic
    let seller = null;
    
    // 1. Check product object itself
    if (product.sellerEntity?.name && !['العربية', 'Appliances', 'Sign In'].includes(product.sellerEntity.name)) {
      seller = product.sellerEntity.name;
    } else if (product.sellerName && !['العربية', 'Appliances', 'Sign In'].includes(product.sellerName)) {
      seller = product.sellerName;
    } else if (product.seller && !['العربية', 'Appliances', 'Sign In'].includes(product.seller)) {
      seller = product.seller;
    }
    
    // 2. Check storeData googleAds targeting if available (often contains correct seller for catalog)
    if ((!seller || ['Jumia', 'العربية', 'Appliances', 'Sign In'].includes(seller)) && storeData?.googleAds?.targeting?.seller?.[0]) {
      const adsSeller = storeData.googleAds.targeting.seller[0];
      if (adsSeller && !['العربية', 'Appliances', 'Sign In'].includes(adsSeller)) {
        seller = adsSeller;
      }
    }

    // If seller is still not found or is 'Jumia'/'العربية', try to fetch from
    // product details page.
    //
    // Jumia's current catalog payload carries `sellerId` (numeric) on every
    // product but does NOT embed the seller *name* inline — the front-end
    // resolves names lazily client-side. We have to hit the PDP to get the
    // real name. To keep the catalog response fast we rely on two callers
    // (extractProductsFromHTML, caller provided `sellerNameCache`) to
    // (a) run these PDP fetches in parallel with a concurrency cap and
    // (b) dedupe by sellerId, so the same seller isn't fetched twice per page.
    if (!seller || seller === 'Jumia' || seller === 'العربية') {
      const productUrl = product.url ? `${domain}${product.url}` : null;
      if (productUrl) {
        const cacheKey = product.sellerId != null ? String(product.sellerId) : productUrl;
        let pending = sellerNameCache?.get(cacheKey);
        if (!pending) {
          pending = fetchSellerFromProductPage(productUrl);
          sellerNameCache?.set(cacheKey, pending);
        }
        const fetchedSeller = await pending;
        if (fetchedSeller && fetchedSeller !== 'Jumia' && !['العربية', 'Appliances', 'Sign In'].includes(fetchedSeller)) {
          seller = fetchedSeller;
        } else if (!seller || ['العربية', 'Appliances', 'Sign In'].includes(seller)) {
          seller = 'Jumia';
        }
      } else if (!seller || ['العربية', 'Appliances', 'Sign In'].includes(seller)) {
        seller = 'Jumia';
      }
    }

    return {
      sku: product.sku,
      name: product.displayName || '',
      brand: product.brand || 'Unknown',
      category: product.categories?.join(' > ') || '',
      price: product.prices?.rawPrice || (product.prices?.price ? parseFloat(product.prices.price.toString().replace(/[^0-9.]/g, '')) : 0),
      oldPrice: product.prices?.rawOldPrice || (product.prices?.oldPrice ? parseFloat(product.prices.oldPrice.toString().replace(/[^0-9.]/g, '')) : undefined),
      discount: product.prices?.discount || undefined,
      rating: product.rating?.average || 0,
      totalRatings: product.rating?.totalRatings || 0,
      image: product.image || '',
      url: product.url ? `${domain}${product.url}` : '',
      seller: seller,
      isJumiaExpress: !!(product.isJumiaExpress || product.isShopExpress || product.shopExpress),
      isShopGlobal: !!product.isShopGlobal,
      stock: product.stockInfo?.text || 'In Stock',
      tags: product.tags ? product.tags.split('|') : [],
      country: country,
    };
  } catch (error) {
    console.error('[Jumia Scraper] Error extracting product data:', error);
    return null;
  }
}

/**
 * Filter products based on filter criteria
 */
export function filterProducts(products: JumiaProduct[], filters: any): JumiaProduct[] {
  return products.filter(product => {
    if (filters.brands && filters.brands.length > 0 && !filters.brands.includes(product.brand)) {
      return false;
    }
    if (filters.sellers && filters.sellers.length > 0 && !filters.sellers.includes(product.seller)) {
      return false;
    }
    if (filters.minPrice !== undefined && product.price < filters.minPrice) {
      return false;
    }
    if (filters.maxPrice !== undefined && product.price > filters.maxPrice) {
      return false;
    }
    if (filters.minRating !== undefined && (product.rating || 0) < filters.minRating) {
      return false;
    }
    if (filters.jumiaExpress !== undefined && product.isJumiaExpress !== filters.jumiaExpress) {
      return false;
    }
    if (filters.shopGlobal !== undefined && product.isShopGlobal !== filters.shopGlobal) {
      return false;
    }
    if (filters.tags && filters.tags.length > 0) {
      if (!product.tags || !filters.tags.some((tag: string) => product.tags?.includes(tag))) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Get available filter options from a list of products
 */
export function getFilterOptions(products: JumiaProduct[]) {
  const brands = Array.from(new Set(products.map(p => p.brand))).filter(Boolean).sort();
  const sellers = Array.from(new Set(products.map(p => p.seller))).filter(Boolean).sort();
  const tags = Array.from(new Set(products.flatMap(p => p.tags || []))).filter(Boolean).sort();
  
  const prices = products.map(p => p.price);
  const priceRange = {
    min: Math.floor(Math.min(...(prices.length ? prices : [0]))),
    max: Math.ceil(Math.max(...(prices.length ? prices : [0]))),
  };

  return {
    brands,
    sellers,
    tags,
    priceRange,
  };
}
