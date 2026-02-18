/**
 * Jumia Product Scraper with Anti-Blocking Measures
 * Handles data extraction from Jumia catalog pages
 */

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
  EG: 'https://www.jumia.eg',
  GH: 'https://www.jumia.com.gh',
  CI: 'https://www.jumia.ci',
  MA: 'https://www.jumia.ma',
  TN: 'https://www.jumia.com.tn',
  ZA: 'https://www.zando.co.za',
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
 * Fetch a Jumia catalog page with anti-blocking measures
 */
export async function fetchJumiaByUrl(
  url: string,
  options: FetchOptions = {}
): Promise<{ products: JumiaProduct[]; hasMore: boolean }> {
  const delayMs = options.delay || Math.random() * 2000 + 1000;
  const timeout = options.timeout || 30000;

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

    const response = await fetch(url, {
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
      if (response.status === 403 || response.status === 429) {
        console.warn(`[Jumia Scraper] Rate limited or blocked (${response.status}). Returning empty results.`);
        return { products: [], hasMore: false };
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const products = extractProductsFromHTML(html, country);
    const hasMore = html.includes('next') && products.length > 0;

    return { products, hasMore };
  } catch (error) {
    console.error(`[Jumia Scraper] Error fetching URL ${url}:`, error);
    return { products: [], hasMore: false };
  }
}

export async function fetchJumiaPage(
  query: string,
  page: number = 1,
  options: FetchOptions = {}
): Promise<{ products: JumiaProduct[]; hasMore: boolean }> {
  const country = options.country || 'NG';
  const domain = JUMIA_DOMAINS[country] || JUMIA_DOMAINS.NG;
  const catalogUrl = `${domain}/catalog/?q=${encodeURIComponent(query)}&page=${page}`;
  
  return fetchJumiaByUrl(catalogUrl, options);
}

/**
 * Extract products from Jumia HTML page
 * Looks for window.__STORE__ JSON object
 */
function extractProductsFromHTML(html: string, country: string): JumiaProduct[] {
  try {
    // Look for window.__STORE__ pattern
    const storeMatch = html.match(/window\.__STORE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
    
    if (!storeMatch) {
      console.warn('[Jumia Scraper] Could not find window.__STORE__ in HTML');
      return [];
    }

    const storeData = JSON.parse(storeMatch[1]);
    const products: JumiaProduct[] = [];

    // Navigate through the store structure to find products
    if (storeData.products && Array.isArray(storeData.products)) {
      for (const product of storeData.products) {
        const extracted = extractProductData(product, country);
        if (extracted) {
          products.push(extracted);
        }
      }
    }

    return products;
  } catch (error) {
    console.error('[Jumia Scraper] Error parsing HTML:', error);
    return [];
  }
}

/**
 * Extract individual product data from Jumia product object
 */
function extractProductData(product: any, country: string): JumiaProduct | null {
  try {
    if (!product.sku || !product.displayName) {
      return null;
    }

    const domain = JUMIA_DOMAINS[country] || JUMIA_DOMAINS.NG;

    return {
      sku: product.sku,
      name: product.displayName || '',
      brand: product.brand || 'Unknown',
      category: product.categories?.join(' > ') || '',
      price: product.prices?.rawPrice || (product.prices?.price ? parseFloat(product.prices.price.toString().replace(/[^0-9.]/g, '')) : 0),
      oldPrice: product.prices?.rawOldPrice || (product.prices?.oldPrice ? parseFloat(product.prices.oldPrice.toString().replace(/[^0-9.]/g, '')) : undefined),
      discount: product.prices?.discount || undefined,
      rating: product.rating?.average ? parseFloat(product.rating.average) : undefined,
      totalRatings: product.rating?.totalRatings || undefined,
      image: product.image || '',
      url: product.url ? `${domain}${product.url}` : '',
      seller: product.sellerEntity?.name || product.sellerName || 'Jumia',
      isJumiaExpress: product.isShopExpress === true,
      isShopGlobal: product.isShopGlobal === true,
      stock: product.stock?.text || undefined,
      tags: Array.isArray(product.tags) ? product.tags : [],
      country,
    };
  } catch (error) {
    console.error('[Jumia Scraper] Error extracting product data:', error);
    return null;
  }
}

/**
 * Fetch multiple products by SKU list
 */
export async function fetchProductsBySkuList(
  skus: string[],
  options: FetchOptions = {}
): Promise<JumiaProduct[]> {
  const country = options.country || 'NG';
  const allProducts: JumiaProduct[] = [];

  for (const sku of skus) {
    try {
      const { products } = await fetchJumiaPage(sku, 1, options);
      
      // Filter for exact SKU match or partial match
      const matching = products.filter(p => p.sku === sku || p.name.toLowerCase().includes(sku.toLowerCase()));
      allProducts.push(...matching);

      // Add delay between requests
      await delay(options.delay || Math.random() * 2000 + 1000);
    } catch (error) {
      console.error(`[Jumia Scraper] Error fetching SKU ${sku}:`, error);
      // Continue with next SKU on error
    }
  }

  return allProducts;
}

/**
 * Apply filters to products
 */
export function filterProducts(
  products: JumiaProduct[],
  filters: {
    brands?: string[];
    sellers?: string[];
    jumiaExpress?: boolean;
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    tags?: string[];
  }
): JumiaProduct[] {
  return products.filter(product => {
    if (filters.brands && filters.brands.length > 0) {
      if (!filters.brands.includes(product.brand)) return false;
    }

    if (filters.sellers && filters.sellers.length > 0) {
      if (!filters.sellers.includes(product.seller || '')) return false;
    }

    if (filters.jumiaExpress !== undefined) {
      if (product.isJumiaExpress !== filters.jumiaExpress) return false;
    }

    if (filters.minPrice !== undefined) {
      if (product.price < filters.minPrice) return false;
    }

    if (filters.maxPrice !== undefined) {
      if (product.price > filters.maxPrice) return false;
    }

    if (filters.minRating !== undefined && product.rating !== undefined) {
      if (product.rating < filters.minRating) return false;
    }

    if (filters.tags && filters.tags.length > 0) {
      const hasTag = filters.tags.some(tag => 
        product.tags?.includes(tag)
      );
      if (!hasTag) return false;
    }

    return true;
  });
}

/**
 * Get unique values for filter options
 */
export function getFilterOptions(products: JumiaProduct[]) {
  const brands = new Set<string>();
  const sellers = new Set<string>();
  const tags = new Set<string>();
  let minPrice = Infinity;
  let maxPrice = 0;

  for (const product of products) {
    if (product.brand) brands.add(product.brand);
    if (product.seller) sellers.add(product.seller);
    if (product.tags) product.tags.forEach(tag => tags.add(tag));
    minPrice = Math.min(minPrice, product.price);
    maxPrice = Math.max(maxPrice, product.price);
  }

  return {
    brands: Array.from(brands).sort(),
    sellers: Array.from(sellers).sort(),
    tags: Array.from(tags).sort(),
    priceRange: { min: minPrice === Infinity ? 0 : minPrice, max: maxPrice },
  };
}
