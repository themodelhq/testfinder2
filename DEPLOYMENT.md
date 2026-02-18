# Jumia SKU Finder & Product Grabber - Deployment Guide

## Overview

The **Jumia SKU Finder & Product Grabber** is a comprehensive web application designed to search, filter, and export product data from Jumia's African e-commerce platforms. The application combines advanced scraping capabilities with a clean, intuitive user interface.

## Features

### Core Functionality

**Search Capabilities:**
- Keyword-based product search across Jumia catalogs
- SKU list batch processing for multiple product lookups
- Support for 9 African Jumia markets (Nigeria, Kenya, Uganda, Egypt, Ghana, Ivory Coast, Morocco, Tunisia, South Africa)

**Data Extraction:**
- Extracts product data from Jumia's window.__STORE__ JSON object
- Captures SKU, name, brand, category, price, ratings, seller information, and Jumia Express status
- Includes product images and direct URLs

**Filtering System:**
- Filter by brand (multi-select)
- Filter by seller name (multi-select)
- Filter by Jumia Express availability
- Filter by price range
- Filter by minimum rating
- Filter by product tags

**Export Functionality:**
- CSV export with all product metadata
- Includes pricing, ratings, seller information, and Jumia Express status
- Timestamped filenames for easy organization

**Anti-Blocking Measures:**
- User-agent rotation (5 different user agents)
- Random request delays (1-3 seconds between requests)
- Proper HTTP headers (Accept, Accept-Language, DNT, etc.)
- Timeout handling (30-second default)

## Technology Stack

**Backend:**
- Node.js with Express 4
- tRPC 11 for type-safe API procedures
- TypeScript for type safety
- Drizzle ORM for database management
- MySQL/TiDB for data persistence

**Frontend:**
- React 19 with Vite
- Tailwind CSS 4 for styling
- shadcn/ui components for consistent UI
- React Query for data fetching

## Installation & Setup

### Prerequisites

- Node.js 22.13.0 or higher
- pnpm 10.4.1 or higher
- MySQL/TiDB database
- Internet connection for Jumia access

### Local Development

```bash
# Clone or navigate to project
cd /home/ubuntu/jumia-sku-finder

# Install dependencies
pnpm install

# Set up environment variables
# DATABASE_URL, JWT_SECRET, and OAuth variables are auto-injected

# Run development server
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build

# Start production server
pnpm start
```

## API Endpoints

All API endpoints are accessible via tRPC at `/api/trpc`:

### Search Procedures

**`jumia.search`** - Keyword search
- Input: `{ query: string, country?: string, page?: number }`
- Returns: `{ products: Product[], hasMore: boolean, error?: string }`

**`jumia.searchBySkuList`** - Batch SKU search
- Input: `{ skus: string[], country?: string }`
- Returns: `{ products: Product[], error?: string }`

**`jumia.filter`** - Apply filters to products
- Input: `{ products: Product[], filters?: FilterOptions }`
- Returns: `{ products: Product[], filterOptions: FilterOptions }`

**`jumia.getFilterOptions`** - Extract available filter options
- Input: `{ products: Product[] }`
- Returns: `{ brands: string[], sellers: string[], tags: string[], priceRange: { min, max } }`

**`jumia.exportCsv`** - Generate CSV export
- Input: `{ products: Product[] }`
- Returns: `{ csv: string }`

## Supported Countries

| Code | Country | Domain |
|------|---------|--------|
| NG | Nigeria | jumia.com.ng |
| KE | Kenya | jumia.co.ke |
| UG | Uganda | jumia.ug |
| EG | Egypt | jumia.eg |
| GH | Ghana | jumia.com.gh |
| CI | Ivory Coast | jumia.ci |
| MA | Morocco | jumia.ma |
| TN | Tunisia | jumia.com.tn |
| ZA | South Africa | zando.co.za |

## Database Schema

### Products Table

```sql
CREATE TABLE products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sku VARCHAR(255) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  brand VARCHAR(255),
  category TEXT,
  price DECIMAL(10, 2),
  oldPrice DECIMAL(10, 2),
  discount VARCHAR(50),
  rating DECIMAL(3, 1),
  totalRatings INT,
  image LONGTEXT,
  url LONGTEXT,
  seller VARCHAR(255),
  isJumiaExpress BOOLEAN,
  isShopGlobal BOOLEAN,
  stock VARCHAR(255),
  tags JSON,
  country VARCHAR(10),
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Searches Table

```sql
CREATE TABLE searches (
  id INT PRIMARY KEY AUTO_INCREMENT,
  query VARCHAR(255),
  country VARCHAR(10),
  resultsCount INT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Usage Examples

### Keyword Search

1. Navigate to the application
2. Select country (default: Nigeria)
3. Enter search keyword (e.g., "laptop")
4. Click "Search"
5. Products will be displayed in a grid
6. Apply filters as needed
7. Click "Export CSV" to download results

### SKU List Search

1. Click "SKU List" tab
2. Paste SKUs (one per line)
3. Click "Search SKUs"
4. Results will be displayed
5. Apply filters and export as needed

## Performance Considerations

**Request Delays:** The application includes 1-3 second delays between requests to avoid overwhelming Jumia's servers and reducing detection risk.

**Batch Processing:** For large SKU lists, the application processes requests sequentially with delays to maintain stability.

**Caching:** Product data is cached in the database to reduce redundant requests.

**Timeout Handling:** 30-second timeout per request with proper error handling.

## Anti-Blocking Measures

The application implements multiple anti-blocking strategies:

1. **User-Agent Rotation:** Randomly selects from 5 different user agents
2. **Request Delays:** 1-3 second random delays between requests
3. **Proper Headers:** Includes Accept, Accept-Language, DNT, Connection, and other standard headers
4. **Timeout Management:** Handles slow connections gracefully
5. **Error Recovery:** Continues processing on individual request failures

## Troubleshooting

### No Products Found

- Verify the search query is spelled correctly
- Try searching with a more general term
- Check that the selected country is correct
- Ensure internet connection is stable

### Slow Search Performance

- The application intentionally includes delays to avoid detection
- Large batch searches may take several minutes
- Consider breaking SKU lists into smaller batches

### Export Issues

- Ensure products have been successfully fetched
- Check browser's download folder for CSV file
- Verify sufficient disk space

## Security Considerations

- The application does not store user credentials
- All data is processed server-side
- CSV exports are generated on-demand
- Database queries are parameterized to prevent SQL injection
- API endpoints are protected with proper error handling

## Limitations

- Jumia's website structure may change, requiring scraper updates
- Large batch searches (100+ SKUs) may take extended time
- Some product data may be unavailable for certain items
- Jumia may implement additional anti-scraping measures

## Future Enhancements

- Real-time search progress indicators
- Advanced scheduling for batch operations
- Price tracking and alerts
- Product comparison features
- Multi-language support
- API rate limiting and quotas

## Support & Maintenance

For issues or feature requests, ensure the application is running the latest version. Check the browser console for error messages and verify database connectivity.

## License

This application is provided as-is for educational and commercial use.

---

**Last Updated:** February 18, 2026
**Version:** 1.0.0
