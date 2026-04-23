import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { fetchJumiaPage, fetchJumiaByUrl, fetchProductsBySkuList, filterProducts, getFilterOptions } from "./jumia-scraper";

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
          const { products, hasMore, debug } = await fetchJumiaPage(
            input.query,
            input.page,
            { country: input.country }
          );
          return { products, hasMore, error: null, debug: debug ?? null };
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
          const { products, hasMore, debug } = await fetchJumiaByUrl(input.url);
          return { products, hasMore, error: null, debug: debug ?? null };
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
