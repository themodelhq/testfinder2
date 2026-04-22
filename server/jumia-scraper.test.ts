import { describe, it, expect, beforeEach } from 'vitest';
import { filterProducts, getFilterOptions } from './jumia-scraper';

describe('Jumia Scraper', () => {
  describe('filterProducts', () => {
    let mockProducts: any[];

    beforeEach(() => {
      mockProducts = [
      {
        sku: 'SKU001',
        name: 'Laptop Pro',
        brand: 'Dell',
        category: 'Electronics',
        price: 1500,
        oldPrice: 2000,
        rating: 4.5,
        totalRatings: 100,
        image: 'image1.jpg',
        url: 'https://jumia.com/product1',
        seller: 'Jumia Official',
        isJumiaExpress: true,
        isShopGlobal: false,
        stock: 'In Stock',
        tags: ['electronics', 'computers'],
        country: 'NG',
      },
      {
        sku: 'SKU002',
        name: 'Phone X',
        brand: 'Apple',
        category: 'Phones',
        price: 800,
        oldPrice: 1000,
        rating: 4.8,
        totalRatings: 200,
        image: 'image2.jpg',
        url: 'https://jumia.com/product2',
        seller: 'Tech Store',
        isJumiaExpress: false,
        isShopGlobal: true,
        stock: 'In Stock',
        tags: ['phones', 'mobile'],
        country: 'NG',
      },
      {
        sku: 'SKU003',
        name: 'Headphones',
        brand: 'Sony',
        category: 'Audio',
        price: 150,
        oldPrice: 200,
        rating: 4.2,
        totalRatings: 50,
        image: 'image3.jpg',
        url: 'https://jumia.com/product3',
        seller: 'Audio World',
        isJumiaExpress: true,
        isShopGlobal: false,
        stock: 'In Stock',
        tags: ['audio', 'accessories'],
        country: 'NG',
      },
      ];
    });

    it('should filter products by brand', () => {
      const filtered = filterProducts(mockProducts, { brands: ['Dell'] });
      expect(filtered.length).toBe(1);
      if (filtered[0]) {
        expect(filtered[0].brand).toBe('Dell');
      }
    });

    it('should filter products by multiple brands', () => {
      const filtered = filterProducts(mockProducts, { brands: ['Dell', 'Apple'] });
      expect(filtered.length).toBeGreaterThan(0);
    });

    it('should filter products by seller', () => {
      const filtered = filterProducts(mockProducts, { sellers: ['Jumia Official'] });
      expect(filtered.length).toBe(1);
      if (filtered[0]) {
        expect(filtered[0].seller).toBe('Jumia Official');
      }
    });

    it('should filter products by Jumia Express', () => {
      const filtered = filterProducts(mockProducts, { jumiaExpress: true });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(p => p.isJumiaExpress)).toBe(true);
    });

    it('should filter products by price range', () => {
      const filtered = filterProducts(mockProducts, { minPrice: 150, maxPrice: 1000 });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(p => p.price >= 150 && p.price <= 1000)).toBe(true);
    });

    it('should filter products by minimum rating', () => {
      const filtered = filterProducts(mockProducts, { minRating: 4.5 });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(p => (p.rating || 0) >= 4.5)).toBe(true);
    });

    it('should apply multiple filters', () => {
      const filtered = filterProducts(mockProducts, {
        brands: ['Dell', 'Sony'],
        jumiaExpress: true,
        minPrice: 100,
      });
      expect(filtered.length).toBeGreaterThan(0);
    });

    it('should return all products when no filters applied', () => {
      const filtered = filterProducts(mockProducts, {});
      expect(filtered.length).toBe(mockProducts.length);
    });
  });

  describe('getFilterOptions', () => {
    let mockProducts: any[];

    beforeEach(() => {
      mockProducts = [
      {
        sku: 'SKU001',
        name: 'Laptop Pro',
        brand: 'Dell',
        category: 'Electronics',
        price: 1500,
        oldPrice: 2000,
        rating: 4.5,
        totalRatings: 100,
        image: 'image1.jpg',
        url: 'https://jumia.com/product1',
        seller: 'Jumia Official',
        isJumiaExpress: true,
        isShopGlobal: false,
        stock: 'In Stock',
        tags: ['electronics', 'computers'],
        country: 'NG',
      },
      {
        sku: 'SKU002',
        name: 'Phone X',
        brand: 'Apple',
        category: 'Phones',
        price: 800,
        oldPrice: 1000,
        rating: 4.8,
        totalRatings: 200,
        image: 'image2.jpg',
        url: 'https://jumia.com/product2',
        seller: 'Tech Store',
        isJumiaExpress: false,
        isShopGlobal: true,
        stock: 'In Stock',
        tags: ['phones', 'mobile'],
        country: 'NG',
      },
      ];
    });

    it('should extract unique brands', () => {
      const options = getFilterOptions(mockProducts);
      expect(options.brands.includes('Apple')).toBe(true);
      expect(options.brands.includes('Dell')).toBe(true);
    });

    it('should extract unique sellers', () => {
      const options = getFilterOptions(mockProducts);
      expect(options.sellers.includes('Jumia Official')).toBe(true);
      expect(options.sellers.includes('Tech Store')).toBe(true);
    });

    it('should extract price range', () => {
      const options = getFilterOptions(mockProducts);
      expect(options.priceRange.min).toBeLessThanOrEqual(options.priceRange.max);
      expect(options.priceRange.max).toBeGreaterThan(0);
    });

    it('should extract unique tags', () => {
      const options = getFilterOptions(mockProducts);
      expect(options.tags.includes('electronics')).toBe(true);
      expect(options.tags.includes('computers')).toBe(true);
      expect(options.tags.includes('phones')).toBe(true);
      expect(options.tags.includes('mobile')).toBe(true);
    });

    it('should return sorted arrays', () => {
      const options = getFilterOptions(mockProducts);
      const isSorted = (arr: string[]) => arr.length === 0 || arr.every((v, i, a) => i === 0 || a[i - 1] <= v);
      expect(isSorted(options.brands)).toBe(true);
      expect(isSorted(options.sellers)).toBe(true);
      expect(isSorted(options.tags)).toBe(true);
    });

    it('should handle empty products array', () => {
      const options = getFilterOptions([]);
      expect(options.brands.length).toBe(0);
      expect(options.sellers.length).toBe(0);
      expect(options.tags.length).toBe(0);
    });
  });
});
