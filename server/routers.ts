import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { fetchJumiaPage, fetchJumiaByUrl, fetchProductsBySkuList, filterProducts, getFilterOptions } from "./jumia-scraper";

/**
 * Turn a scraper error code into a UI-friendly message. The `debug` payload
 * is also forwarded to the client so the Network tab reveals exactly what
 * happened on the Render side (HTTP status, response size, whether the
 * window.__STORE__ block was found, etc.).
 */
function humanizeScrapeError(
  code: NonNullable<Awaited<ReturnType<typeof fetchJumiaByUrl>>['error']>,
  debug?: Awaited<ReturnType<typeof fetchJumiaByUrl>>['debug'],
): string {
  const status = debug?.httpStatus != null ? ` (HTTP ${debug.httpStatus})` : '';
  const viaProxy = debug?.proxied ? ' via the configured proxy' : '';
  switch (code) {
    case 'blocked':
      return debug?.proxied
        ? `Jumia blocked the request${status} even when routed through the proxy. The proxy's IPs are also on Jumia's blocklist — try a residential/rotating proxy tier.`
        : `Jumia blocked the request${status}. The hosting provider's IP is on their blocklist. Set PROXY_URL to route through a proxy (e.g. Webshare).`;
    case 'rate_limited':
      return `Jumia rate-limited the request${status}${viaProxy}. Wait a moment and try again.`;
    case 'http_error':
      return `Jumia returned an unexpected HTTP status${status}${viaProxy}.`;
    case 'network_error':
      return debug?.proxied
        ? 'Network error reaching the proxy or Jumia. Check the PROXY_URL credentials and outbound connectivity.'
        : 'Network error reaching Jumia. Check outbound connectivity from the server.';
    case 'timeout':
      return `The Jumia request timed out before completing${viaProxy}.`;
    case 'parse_failed':
      return 'The Jumia response did not contain the expected window.__STORE__ product data. The page structure may have changed.';
    default:
      return 'Unknown scraper error.';
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  jumia: router({
    search: publicProcedure
      .input(z.object({
        query: z.string(),
        country: z.string().default('NG'),
        page: z.number().default(1),
      }))
      .query(async ({ input }) => {
        try {
          const result = await fetchJumiaPage(
            input.query,
            input.page,
            { country: input.country }
          );
          return {
            products: result.products,
            hasMore: result.hasMore,
            error: result.error ? humanizeScrapeError(result.error, result.debug) : null,
            debug: result.debug ?? null,
          };
        } catch (error) {
          return {
            products: [],
            hasMore: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            debug: null,
          };
        }
      }),

    searchByUrl: publicProcedure
      .input(z.object({
        url: z.string().url(),
      }))
      .query(async ({ input }) => {
        try {
          const result = await fetchJumiaByUrl(input.url);
          return {
            products: result.products,
            hasMore: result.hasMore,
            error: result.error ? humanizeScrapeError(result.error, result.debug) : null,
            debug: result.debug ?? null,
          };
        } catch (error) {
          return {
            products: [],
            hasMore: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            debug: null,
          };
        }
      }),

    searchBySkuList: publicProcedure
      .input(z.object({
        skus: z.array(z.string()),
        country: z.string().default('NG'),
      }))
      .query(async ({ input }) => {
        try {
          const products = await fetchProductsBySkuList(input.skus, {
            country: input.country,
          });
          return { products, error: null };
        } catch (error) {
          return {
            products: [],
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),

    filter: publicProcedure
      .input(z.object({
        products: z.array(z.any()),
        filters: z.object({
          brands: z.array(z.string()).optional(),
          sellers: z.array(z.string()).optional(),
          jumiaExpress: z.boolean().optional(),
          minPrice: z.number().optional(),
          maxPrice: z.number().optional(),
          minRating: z.number().optional(),
          tags: z.array(z.string()).optional(),
        }).optional(),
      }))
      .query(({ input }) => {
        const filtered = filterProducts(input.products, input.filters || {});
        const options = getFilterOptions(filtered);
        return { products: filtered, filterOptions: options };
      }),

    getFilterOptions: publicProcedure
      .input(z.object({
        products: z.array(z.any()),
      }))
      .query(({ input }) => {
        return getFilterOptions(input.products);
      }),

    exportCsv: publicProcedure
      .input(z.object({
        products: z.array(z.any()),
      }))
      .query(({ input }) => {
        const csv = generateCsv(input.products);
        return { csv };
      }),
  }),
});

function generateCsv(products: any[]): string {
  if (products.length === 0) {
    return 'No products to export';
  }

  const headers = [
    'SKU',
    'Name',
    'Brand',
    'Category',
    'Price',
    'Old Price',
    'Discount',
    'Rating',
    'Total Ratings',
    'Seller',
    'Jumia Express',
    'Shop Global',
    'Image URL',
    'Product URL',
    'Stock',
    'Tags',
  ];

  const rows = products.map(product => [
    escapeCSV(product.sku),
    escapeCSV(product.name),
    escapeCSV(product.brand),
    escapeCSV(product.category),
    product.price || '',
    product.oldPrice || '',
    escapeCSV(product.discount || ''),
    product.rating || '',
    product.totalRatings || '',
    escapeCSV(product.seller || ''),
    product.isJumiaExpress ? 'Yes' : 'No',
    product.isShopGlobal ? 'Yes' : 'No',
    escapeCSV(product.image),
    escapeCSV(product.url),
    escapeCSV(product.stock || ''),
    product.tags ? product.tags.join('; ') : '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\n');

  return csvContent;
}

function escapeCSV(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export type AppRouter = typeof appRouter;
