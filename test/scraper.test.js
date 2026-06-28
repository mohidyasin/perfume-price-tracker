import assert from "node:assert/strict";
import test from "node:test";

import { getAllowedSite } from "../server/config/sites.js";
import { buildCatalogReport, normalizeCatalogItem } from "../server/lib/catalog.js";
import { mergeCatalogIntoHistory } from "../server/lib/history.js";
import {
  discoverProductsFromHtml,
  extractProductFromHtml,
  extractPrices,
  parseMoney
} from "../server/lib/scraper.js";

test("allowlist has at least 10 Irish-based scan sources with category URLs", () => {
  const sites = [
    "https://www.mccauley.ie/fragrances/mens-fragrances",
    "https://www.mccauley.ie/fragrances/womens-fragrances",
    "https://www.hickeyspharmacies.ie/toiletries/mens/fragrance",
    "https://www.allcarepharmacy.ie/fragrances/mens-fragrances",
    "https://www.allcarepharmacy.ie/fragrances/womens-fragrances",
    "https://www.meagherspharmacy.ie/collections/mens-fragrance",
    "https://www.mccabespharmacy.com/collections/fragrance-offers-for-him",
    "https://www.mccabespharmacy.com/collections/christmas-gifts-all-gift-ideas-gift-ideas-by-type-fragrance-fragrance-for-her",
    "https://www.inishpharmacy.com/collections/fragrances-for-him",
    "https://www.inishpharmacy.com/collections/fragrances-for-her",
    "https://www.cloud10beauty.com/collections/fragrance-for-him",
    "https://www.cloud10beauty.com/collections/fragrance-for-her",
    "https://www.leavys.ie/category/fragrance-for-him",
    "https://healthplus.ie/toiletries/mens-fragrances.html",
    "https://www.rochfordspharmacy.ie/c/mens-fragrance/76"
  ];

  assert.equal(sites.every((url) => getAllowedSite(url)?.irishBased !== false), true);
});

test("allowlist accepts Irish retailer URLs and rejects non-Irish storefront paths", () => {
  assert.equal(getAllowedSite("https://www.mccauley.ie/burberry-hero-for-him-eau-de-parfum-50ml").key, "mccauley");
  assert.equal(getAllowedSite("https://www.theperfumeshop.com/ie/dior/sauvage/eau-de-parfum-spray/p/65330EDPJU").key, "the-perfume-shop-ie");
  assert.equal(getAllowedSite("https://www.theperfumeshop.com/dior/sauvage/eau-de-parfum-spray/p/65330EDPJU"), null);
  assert.equal(getAllowedSite("https://example.com/product"), null);
});

test("extractProductFromHtml reads JSON-LD product offers", () => {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [{
              "@type": "Product",
              "name": "Dior Sauvage Eau de Parfum Spray",
              "brand": {"name": "Dior"},
              "image": "https://cdn.example/sauvage.jpg",
              "offers": {"@type": "Offer", "price": "91.50", "priceCurrency": "EUR"}
            }]
          }
        </script>
      </head>
    </html>`;

  const product = extractProductFromHtml(
    html,
    "https://www.theperfumeshop.com/ie/dior/sauvage/eau-de-parfum-spray/p/65330EDPJU"
  );

  assert.equal(product.name, "Dior Sauvage Eau de Parfum Spray");
  assert.equal(product.brand, "Dior");
  assert.equal(product.price, 91.5);
  assert.equal(product.currency, "EUR");
  assert.equal(product.source, "json-ld");
});

test("extractProductFromHtml falls back to OpenGraph product price metadata", () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Burberry Hero For Him Eau De Parfum 50ml | McCauley" />
        <meta property="product:price:amount" content="74.95" />
        <meta property="product:price:currency" content="EUR" />
        <meta property="og:image" content="/media/hero.jpg" />
      </head>
    </html>`;

  const product = extractProductFromHtml(html, "https://www.mccauley.ie/burberry-hero-for-him-eau-de-parfum-50ml");
  assert.equal(product.name, "Burberry Hero For Him Eau De Parfum 50ml");
  assert.equal(product.price, 74.95);
  assert.equal(product.currency, "EUR");
  assert.equal(product.image, "https://www.mccauley.ie/media/hero.jpg");
});

test("discoverProductsFromHtml finds product-like links and nearby euro prices", () => {
  const html = `
    <section class="grid">
      <a href="/burberry-hero-for-him-eau-de-parfum-50ml">
        <img data-src="/media/catalog/burberry-hero.jpg" alt="Burberry Hero For Him Eau De Parfum 50ml" />
        <span>Burberry Hero For Him Eau De Parfum 50ml</span>
      </a>
      <span class="price">&euro;74.95</span>
      <a href="/fragrances/mens-fragrances">Mens fragrance category</a>
    </section>`;

  const items = discoverProductsFromHtml(html, "https://www.mccauley.ie/fragrances/mens-fragrances", getAllowedSite("https://www.mccauley.ie/"));

  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Burberry Hero For Him Eau De Parfum 50ml");
  assert.equal(items[0].price, 74.95);
  assert.equal(items[0].image, "https://www.mccauley.ie/media/catalog/burberry-hero.jpg");
});

test("discoverProductsFromHtml reads embedded Shopify variant product data", () => {
  const html = `
    <script>
      window.ShopifyAnalytics = {"products":[{
        "variants":[{
          "price":{"amount":49.95,"currencyCode":"EUR"},
          "product":{"title":"Hugo Boss Orange Man Eau de Toilette 100ml","vendor":"HUGO BOSS","url":"/products/hugo-boss-orange-man-edt-100ml","type":"Fragrance"},
          "id":"49295752495372",
          "image":{"src":"//cdn.example/hugo.jpg"},
          "title":"100ML"
        }]
      }]};
    </script>`;

  const items = discoverProductsFromHtml(
    html,
    "https://www.mccabespharmacy.com/collections/fragrance-offers-for-him",
    getAllowedSite("https://www.mccabespharmacy.com/")
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Hugo Boss Orange Man Eau de Toilette 100ml");
  assert.equal(items[0].brand, "HUGO BOSS");
  assert.equal(items[0].price, 49.95);
  assert.equal(items[0].source, "embedded-shopify");
});

test("catalog normalization groups comparable products and reports price gaps", () => {
  const site = getAllowedSite("https://www.mccauley.ie/");
  const low = normalizeCatalogItem({
    url: "https://www.mccauley.ie/hugo-boss-orange-man-edt-100ml",
    siteKey: "mccauley",
    siteName: "McCauley Pharmacy",
    name: "Hugo Boss Orange Man Eau de Toilette 100ml",
    price: 49.95,
    currency: "EUR",
    image: "/media/hugo-boss-orange.jpg"
  }, { site, runId: "test", sourceCategoryUrl: "https://www.mccauley.ie/fragrances/mens-fragrances" });
  const high = normalizeCatalogItem({
    url: "https://www.hickeyspharmacies.ie/hugo-boss-orange-man-edt-100ml.html",
    siteKey: "hickeys",
    siteName: "Hickey's Pharmacy",
    name: "Boss Orange Man EDT 100ml",
    price: 62,
    currency: "EUR"
  }, { site: getAllowedSite("https://www.hickeyspharmacies.ie/"), runId: "test" });

  const report = buildCatalogReport({
    runId: "test",
    startedAt: "2026-06-28T00:00:00.000Z",
    finishedAt: "2026-06-28T00:00:01.000Z",
    sites: [site],
    siteReports: [],
    items: [low, high]
  });

  assert.equal(report.discrepancies.length, 1);
  assert.equal(report.discrepancies[0].spread, 12.05);
  assert.equal(report.perfumes.length, 1);
  assert.equal(report.perfumes[0].offerCount, 2);
  assert.deepEqual(report.perfumes[0].offers.map((offer) => offer.siteName), ["McCauley Pharmacy", "Hickey's Pharmacy"]);
  assert.equal(report.perfumes[0].bestPrice, 49.95);
  assert.equal(report.perfumes[0].image, "https://www.mccauley.ie/media/hugo-boss-orange.jpg");
  assert.equal(report.perfumes[0].offers[0].image, "https://www.mccauley.ie/media/hugo-boss-orange.jpg");
});

test("catalog grouping keeps different sizes and parfum/toilette separate", () => {
  const site = getAllowedSite("https://www.mccauley.ie/");
  const items = [
    normalizeCatalogItem({
      url: "https://www.mccauley.ie/burberry-hero-eau-de-parfum-50ml",
      siteKey: "mccauley",
      siteName: "McCauley Pharmacy",
      name: "Burberry Hero Eau De Parfum 50ml",
      price: 88.2,
      currency: "EUR"
    }, { site, runId: "test" }),
    normalizeCatalogItem({
      url: "https://www.hickeyspharmacies.ie/burberry-hero-eau-de-parfum-100ml.html",
      siteKey: "hickeys",
      siteName: "Hickey's Pharmacy",
      name: "Burberry Hero Eau De Parfum 100ml",
      price: 121,
      currency: "EUR"
    }, { site: getAllowedSite("https://www.hickeyspharmacies.ie/"), runId: "test" }),
    normalizeCatalogItem({
      url: "https://www.allcarepharmacy.ie/burberry-hero-eau-de-toilette-50ml.html",
      siteKey: "allcare",
      siteName: "Allcare Pharmacy",
      name: "Burberry Hero Eau De Toilette 50ml",
      price: 68,
      currency: "EUR"
    }, { site: getAllowedSite("https://www.allcarepharmacy.ie/"), runId: "test" })
  ];

  const report = buildCatalogReport({
    runId: "test",
    startedAt: "2026-06-28T00:00:00.000Z",
    finishedAt: "2026-06-28T00:00:01.000Z",
    sites: [site],
    siteReports: [],
    items
  });

  assert.equal(report.perfumes.length, 3);
  assert.deepEqual(report.standardization.groupKeyParts, ["brand", "normalizedName", "productFormat", "volumeMl"]);
  assert.equal(new Set(report.perfumes.map((item) => item.volumeMl)).size, 2);
  assert.equal(new Set(report.perfumes.map((item) => item.productFormat)).size, 2);
});

test("catalog records men and women audience for filtering", () => {
  const mccauley = getAllowedSite("https://www.mccauley.ie/");
  const allcare = getAllowedSite("https://www.allcarepharmacy.ie/");
  const men = normalizeCatalogItem({
    url: "https://www.mccauley.ie/burberry-hero-for-him-eau-de-parfum-50ml",
    siteKey: "mccauley",
    siteName: "McCauley Pharmacy",
    name: "Burberry Hero For Him Eau De Parfum 50ml",
    price: 88.2,
    currency: "EUR"
  }, {
    site: mccauley,
    runId: "test",
    sourceCategoryUrl: "https://www.mccauley.ie/fragrances/mens-fragrances"
  });
  const women = normalizeCatalogItem({
    url: "https://www.allcarepharmacy.ie/chanel-chance-eau-de-parfum-50ml",
    siteKey: "allcare",
    siteName: "Allcare Pharmacy",
    name: "Chanel Chance Eau De Parfum 50ml",
    price: 95,
    currency: "EUR"
  }, {
    site: allcare,
    runId: "test",
    sourceCategoryUrl: "https://www.allcarepharmacy.ie/fragrances/womens-fragrances"
  });

  const report = buildCatalogReport({
    runId: "test",
    startedAt: "2026-06-28T00:00:00.000Z",
    finishedAt: "2026-06-28T00:00:01.000Z",
    sites: [mccauley, allcare],
    siteReports: [],
    items: [men, women]
  });

  assert.equal(men.audience, "men");
  assert.equal(women.audience, "women");
  assert.equal(report.summary.audienceCounts.men, 1);
  assert.equal(report.summary.audienceCounts.women, 1);
  assert.deepEqual(new Set(report.perfumes.map((perfume) => perfume.audience)), new Set(["men", "women"]));
});

test("price history stores retailer price points by perfume", () => {
  const site = getAllowedSite("https://www.mccauley.ie/");
  const item = normalizeCatalogItem({
    url: "https://www.mccauley.ie/burberry-hero-eau-de-parfum-50ml",
    siteKey: "mccauley",
    siteName: "McCauley Pharmacy",
    name: "Burberry Hero Eau De Parfum 50ml",
    price: 88.2,
    currency: "EUR"
  }, { site, runId: "test", sourceCategoryUrl: "https://www.mccauley.ie/fragrances/mens-fragrances" });

  const report = buildCatalogReport({
    runId: "test",
    startedAt: "2026-06-28T00:00:00.000Z",
    finishedAt: "2026-06-28T00:00:01.000Z",
    sites: [site],
    siteReports: [],
    items: [item]
  });

  const history = mergeCatalogIntoHistory(null, report, { date: "2026-06-28" });
  assert.equal(history.runs.length, 1);
  assert.equal(history.products.length, 1);
  assert.equal(history.products[0].productKey, item.productKey);
  assert.equal(history.products[0].audience, "men");
  assert.equal(history.products[0].retailers[0].siteName, "McCauley Pharmacy");
  assert.equal(history.products[0].retailers[0].points[0].price, 88.2);
  assert.equal(history.products[0].retailers[0].points[0].audience, "men");
});

test("money parsing handles euro text and comma decimals", () => {
  assert.equal(parseMoney("EUR 1,234.50"), 1234.5);
  assert.equal(parseMoney("74,95"), 74.95);
  assert.deepEqual(extractPrices("Now &euro;49.99 Was &euro;72.00").map((item) => item.value), [49.99, 72]);
});
