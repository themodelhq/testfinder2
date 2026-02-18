import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Search, Filter, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';

const COUNTRIES = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'EG', name: 'Egypt' },
  { code: 'GH', name: 'Ghana' },
  { code: 'CI', name: 'Ivory Coast' },
  { code: 'MA', name: 'Morocco' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'ZA', name: 'South Africa' },
];

interface Product {
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

interface FilterState {
  brands: string[];
  sellers: string[];
  jumiaExpress?: boolean;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  tags: string[];
}

export default function Home() {
  const [searchMode, setSearchMode] = useState<'keyword' | 'sku' | 'url'>('keyword');
  const [searchQuery, setSearchQuery] = useState('');
  const [urlQuery, setUrlQuery] = useState('');
  const [skuList, setSkuList] = useState('');
  const [country, setCountry] = useState('NG');
  const [products, setProducts] = useState<Product[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    brands: [],
    sellers: [],
    tags: [],
  });
  const [showFilters, setShowFilters] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pagesToFetch, setPagesToFetch] = useState(1);

  // We'll use manual fetching to support multiple pages
  const searchUtils = trpc.useUtils();



  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (filters.brands.length > 0 && !filters.brands.includes(p.brand || '')) return false;
      if (filters.sellers.length > 0 && !filters.sellers.includes(p.seller || '')) return false;
      if (filters.jumiaExpress !== undefined && p.isJumiaExpress !== filters.jumiaExpress) return false;
      if (filters.tags.length > 0 && !filters.tags.some(tag => p.tags?.includes(tag))) return false;
      return true;
    });
  }, [products, filters]);

  const removeProduct = (sku: string) => {
    setProducts(prev => prev.filter(p => p.sku !== sku));
  };

  // We'll use a manual CSV generation to ensure it always uses the latest filtered products
  const handleExport = () => {
    if (filteredProducts.length === 0) return;

    const headers = [
      'SKU', 'Name', 'Brand', 'Category', 'Price', 'Old Price', 'Discount',
      'Rating', 'Total Ratings', 'Seller', 'Jumia Express', 'Shop Global',
      'Image URL', 'Product URL', 'Stock', 'Tags'
    ];

    const escapeCSV = (value: any) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = filteredProducts.map(p => [
      escapeCSV(p.sku),
      escapeCSV(p.name),
      escapeCSV(p.brand),
      escapeCSV(p.category),
      p.price || '',
      p.oldPrice || '',
      escapeCSV(p.discount),
      p.rating || '',
      p.totalRatings || '',
      escapeCSV(p.seller),
      p.isJumiaExpress ? 'Yes' : 'No',
      p.isShopGlobal ? 'Yes' : 'No',
      escapeCSV(p.image),
      escapeCSV(p.url),
      escapeCSV(p.stock),
      p.tags ? p.tags.join('; ') : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const element = document.createElement('a');
    const file = new Blob([csvContent], { type: 'text/csv' });
    element.href = URL.createObjectURL(file);
    element.download = `jumia-products-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    setProducts([]);
    try {
      let allProducts: Product[] = [];
      for (let p = 1; p <= pagesToFetch; p++) {
        const result = await searchUtils.jumia.search.fetch({ query: searchQuery, country, page: p });
        if (result.products) {
          allProducts = [...allProducts, ...result.products];
          setProducts([...allProducts]); // Update UI incrementally
          if (!result.hasMore) break;
        }
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkuSearch = async () => {
    if (!skuList.trim()) return;
    
    setIsLoading(true);
    setProducts([]);
    try {
      const skus = skuList.split('\n').filter(s => s.trim());
      const result = await searchUtils.jumia.searchBySkuList.fetch({ skus, country });
      if (result.products) {
        setProducts(result.products);
      }
    } catch (error) {
      console.error('SKU search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUrlSearch = async () => {
    if (!urlQuery.trim()) return;
    
    setIsLoading(true);
    setProducts([]);
    try {
      let currentUrl = urlQuery;
      let allProducts: Product[] = [];
      
      for (let p = 1; p <= pagesToFetch; p++) {
        // Construct page URL if not the first page and if it's a catalog URL
        const fetchUrl = p === 1 ? currentUrl : 
          (currentUrl.includes('?') ? `${currentUrl}&page=${p}` : `${currentUrl}?page=${p}`);
          
        const result = await searchUtils.jumia.searchByUrl.fetch({ url: fetchUrl });
        if (result.products) {
          allProducts = [...allProducts, ...result.products];
          setProducts([...allProducts]);
          if (!result.hasMore) break;
        }
      }
    } catch (error) {
      console.error('URL search error:', error);
    } finally {
      setIsLoading(false);
    }
  };



  const uniqueBrands = Array.from(new Set(products.map(p => p.brand).filter(Boolean) as string[])).sort();
  const uniqueSellers = Array.from(new Set(products.map(p => p.seller).filter(Boolean) as string[])).sort();
  const uniqueTags = Array.from(new Set(products.flatMap(p => p.tags || []).filter(Boolean) as string[])).sort();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Jumia Product Finder</h1>
          <p className="text-slate-600">Search and export products across African Jumia markets</p>
        </div>

        {/* Search Section */}
        <Card className="mb-8 shadow-lg border-0">
          <CardHeader>
            <CardTitle>Search Products</CardTitle>
            <CardDescription>Search by keyword or upload SKU list</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Country and Pages Selector */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-2">Country</label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-2">Number of Pages to Fetch</label>
                <Input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={pagesToFetch} 
                  onChange={(e) => setPagesToFetch(parseInt(e.target.value) || 1)}
                />
              </div>
            </div>

            {/* Search Mode Tabs */}
            <Tabs value={searchMode} onValueChange={(v) => setSearchMode(v as 'keyword' | 'sku' | 'url')}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="keyword">Keyword Search</TabsTrigger>
                <TabsTrigger value="sku">SKU List</TabsTrigger>
                <TabsTrigger value="url">URL Search</TabsTrigger>
              </TabsList>

              <TabsContent value="keyword" className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter product keyword (e.g., laptop, phone, shoes)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSearch}
                    disabled={isLoading || !searchQuery.trim()}
                    className="gap-2"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Search
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="sku" className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Enter SKUs (one per line)</label>
                  <textarea
                    placeholder="SKU1&#10;SKU2&#10;SKU3"
                    value={skuList}
                    onChange={(e) => setSkuList(e.target.value)}
                    className="w-full h-32 p-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button
                    onClick={handleSkuSearch}
                    disabled={isLoading || !skuList.trim()}
                    className="gap-2 w-full"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Search SKUs
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="url" className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter Jumia catalog or store URL"
                    value={urlQuery}
                    onChange={(e) => setUrlQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleUrlSearch()}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleUrlSearch}
                    disabled={isLoading || !urlQuery.trim()}
                    className="gap-2"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    Fetch Products
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Results Section */}
        {products.length > 0 && (
          <>
            {/* Filters and Export */}
            <div className="flex gap-4 mb-6">
              <Button
                variant="outline"
                onClick={() => setShowFilters(!showFilters)}
                className="gap-2"
              >
                <Filter className="w-4 h-4" />
                Filters ({filters.brands.length + filters.sellers.length})
              </Button>
              <Button
                onClick={handleExport}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                <Download className="w-4 h-4" />
                Export CSV ({filteredProducts.length})
              </Button>
            </div>

            {/* Filter Panel */}
            {showFilters && (
              <Card className="mb-6 bg-slate-50 border-slate-200">
                <CardContent className="pt-6 space-y-4">
                  {/* Brand Filter */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Brands</label>
                    <div className="flex flex-wrap gap-2">
                      {uniqueBrands.map((brand: string) => (
                        <Badge
                          key={brand}
                          variant={filters.brands.includes(brand) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => {
                            setFilters(prev => ({
                              ...prev,
                              brands: prev.brands.includes(brand)
                                ? prev.brands.filter(b => b !== brand)
                                : [...prev.brands, brand]
                            }));
                          }}
                        >
                          {brand}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Seller Filter */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Sellers</label>
                    <div className="flex flex-wrap gap-2">
                      {uniqueSellers.map((seller: string) => (
                        <Badge
                          key={seller}
                          variant={filters.sellers.includes(seller) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => {
                            setFilters(prev => ({
                              ...prev,
                              sellers: prev.sellers.includes(seller)
                                ? prev.sellers.filter(s => s !== seller)
                                : [...prev.sellers, seller]
                            }));
                          }}
                        >
                          {seller}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Tag Filter */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Tags</label>
                    <div className="flex flex-wrap gap-2">
                      {uniqueTags.map((tag: string) => (
                        <Badge
                          key={tag}
                          variant={filters.tags.includes(tag) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => {
                            setFilters(prev => ({
                              ...prev,
                              tags: prev.tags.includes(tag)
                                ? prev.tags.filter(t => t !== tag)
                                : [...prev.tags, tag]
                            }));
                          }}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Jumia Express Filter */}
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.jumiaExpress === true}
                        onChange={(e) => {
                          setFilters(prev => ({
                            ...prev,
                            jumiaExpress: e.target.checked ? true : undefined
                          }));
                        }}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span className="text-sm font-medium text-slate-700">Jumia Express Only</span>
                    </label>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Products Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProducts.map(product => (
                <Card key={product.sku} className="overflow-hidden hover:shadow-lg transition-shadow relative group">
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 z-10 w-8 h-8 opacity-0 group-hover:opacity-100 transition-opacity rounded-full shadow-md"
                    onClick={() => removeProduct(product.sku)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <div className="aspect-square bg-slate-100 overflow-hidden">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-full h-full object-cover hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        No Image
                      </div>
                    )}
                  </div>
                  <CardContent className="p-4 space-y-2">
                    <div>
                      <p className="text-xs text-slate-500 font-medium">SKU: {product.sku}</p>
                      <h3 className="font-semibold text-sm line-clamp-2 text-slate-900">{product.name}</h3>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-slate-900">
                        {product.price.toLocaleString()}
                      </span>
                      {product.oldPrice && (
                        <span className="text-xs text-slate-500 line-through">
                          {product.oldPrice.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {product.discount && (
                      <Badge variant="secondary" className="text-xs">{product.discount}</Badge>
                    )}

                    <div className="flex items-center gap-1">
                      {product.rating && (
                        <>
                          <span className="text-yellow-500">★</span>
                          <span className="text-xs font-medium">{product.rating}</span>
                          <span className="text-xs text-slate-500">({product.totalRatings || 0})</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {product.isJumiaExpress && (
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                          Jumia Express
                        </Badge>
                      )}
                      {product.seller && (
                        <Badge variant="outline" className="text-xs">{product.seller || 'Unknown'}</Badge>
                      )}
                      {product.tags && product.tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">{tag}</Badge>
                      ))}
                    </div>

                    <p className="text-xs text-slate-600">{product.brand || 'Unknown'}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Results Summary */}
            <div className="mt-8 text-center text-slate-600">
              <p>Showing {filteredProducts.length} of {products.length} products</p>
            </div>
          </>
        )}

        {/* Empty State */}
        {products.length === 0 && !isLoading && (
          <Card className="text-center py-12">
            <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No products found</h3>
            <p className="text-slate-600">Start by searching for a product or uploading a SKU list</p>
          </Card>
        )}
      </div>
    </div>
  );
}
