/**
 * Representative fixture mirroring the EXACT structure of the catalog HTML that
 * Jumia currently serves (as of Apr 2026). Taken from
 * https://www.jumia.com.ng/catalog/?q=shoe — see document index 1 of the
 * debugging session.
 *
 * The important characteristics this fixture preserves:
 *   1. `window.__STORE__={...};` appears as the last assignment before the
 *      closing `</script>` tag and is followed by additional `<script>` blocks.
 *   2. Catalog products carry `sellerId` (numeric) but do NOT carry
 *      `sellerEntity.name`, `sellerName`, or a string `seller` field — so the
 *      scraper's fallback path (which triggers a per-product PDP fetch) fires
 *      for every single product.
 *   3. The JSON blob contains many minified single-quote sequences inside
 *      nested strings, embedded `</script>`-like tokens are NOT present, but
 *      escaped quotes ARE present.
 */
export const CATALOG_HTML = `<!DOCTYPE html><html lang="en"><head><title>shoe | Jumia Nigeria</title><link rel="next" href="https://www.jumia.com.ng/catalog/?q=shoe&amp;page=2"/></head><body><main><div class="row"><div class="-pvs col12"><section><div class="-phs -pvxs row" data-catalog="true">
<article class="prd _fb col c-prd"><a href="/aidailu-mens-leather-shoes-237800562.html">product1</a></article>
<article class="prd _fb col c-prd"><a href="/mens-new-simple-220493750.html">product2</a></article>
</div></section></div></div></main>
<script>window.__STORE__={"view":"Catalog","activeLanguage":"en","countryCode":"NG","csrfToken":"abc","user":{"isGuest":true},"cart":{"count":0},"shop":"jumia","url":"/catalog/?q=shoe","products":[{"sku":"FA203FS3QUP6XNAFAMZ","name":"Men's Leather Shoes Breathable Slip-on Formal Shoes Casual PU- Brown","displayName":"AIDAILU Men's Leather Shoes Breathable Slip-on Formal Shoes Casual PU- Brown","brand":"AIDAILU","sellerId":201792,"isShopExpress":true,"categories":["Fashion","Men's Fashion","Shoes","Formal Shoes","Slip on"],"prices":{"rawPrice":"9880.00","price":"₦ 9,880","priceEuro":"6.24","oldPrice":"₦ 17,115 - ₦ 18,818","discount":"47%"},"tags":"APWK|BLF_04","rating":{"average":3.6,"totalRatings":271},"image":"https://ng.jumia.is/unsafe/fit-in/300x300/filters:fill(white)/product/26/5008732/1.jpg?8303","isSponsored":false,"url":"/aidailu-mens-leather-shoes-237800562.html","isBuyable":true,"shopExpress":{"title":"Express Shipping"}},{"sku":"FA203FS3EHPJENAFAMZ","name":"New Simple Casual Plain Walkabout Running Sport Shoes","displayName":"Men'S New Simple Casual Plain Walkabout Running Sport Shoes","brand":"Men'S","sellerId":239338,"categories":["Sporting Goods","Sports & Fitness","Exercise & Fitness","Footwear","Men's"],"prices":{"rawPrice":"7345.00","price":"₦ 7,345","priceEuro":"4.64","oldPrice":"₦ 7,999","discount":"8%"},"rating":{"average":3.5,"totalRatings":73},"image":"https://ng.jumia.is/unsafe/fit-in/300x300/filters:fill(white)/product/05/7394022/1.jpg?9553","isSponsored":false,"url":"/mens-new-simple-220493750.html","isBuyable":true},{"sku":"FA203FS2KU32PNAFAMZ","name":"Men's Formal Shoes","displayName":"AIDAILU Men's Formal Shoes","brand":"AIDAILU","sellerId":201792,"isShopExpress":true,"categories":["Fashion","Men's Fashion","Shoes"],"prices":{"rawPrice":"12920.00","price":"₦ 12,920","oldPrice":"₦ 25,840","discount":"50%"},"rating":{"average":3.8,"totalRatings":449},"image":"https://ng.jumia.is/test.jpg","url":"/aidailu-mens-formal-173382955.html","isBuyable":true,"shopExpress":{"title":"Express Shipping"}}],"googleAds":{"targeting":{"searchTerm":["shoe"]}}};</script>
<script defer src="https://www.jumia.com.ng/assets_he/js/common.d7862224.js"></script>
</body></html>`;
