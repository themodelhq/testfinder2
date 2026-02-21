/**
 * Jumia Product Scraper with Anti-Blocking Measures
 * Handles data extraction from Jumia catalog pages
 */

import { load } from 'cheerio';

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
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    
    // Try to extract seller from window.__STORE__ first
    const storeMatch = html.match(/window\.__STORE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
    if (storeMatch) {
      try {
        const storeData = JSON.parse(storeMatch[1]);
        
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
    const products = await extractProductsFromHTML(html, country);
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
      // On Jumia, we can search by SKU directly
      const searchUrl = `${domain}/catalog/?q=${encodeURIComponent(sku)}`;
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
        const extracted = await extractProductData(product, country, storeData);
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
async function extractProductData(product: any, country: string, storeData?: any): Promise<JumiaProduct | null> {
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

    // If seller is still not found or is 'Jumia'/'العربية', try to fetch from product details page
    if (!seller || seller === 'Jumia' || seller === 'العربية') {
      const productUrl = product.url ? `${domain}${product.url}` : null;
      if (productUrl) {
        // Add a small delay before fetching the product page
        await delay(500);
        const fetchedSeller = await fetchSellerFromProductPage(productUrl);
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
      isJumiaExpress: !!product.isJumiaExpress,
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
