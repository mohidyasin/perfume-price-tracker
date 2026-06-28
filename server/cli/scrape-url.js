import { discoverProducts, scrapeProduct } from "../lib/scraper.js";

const [url, mode = "product"] = process.argv.slice(2);

if (!url) {
  console.error("Usage: npm run scrape -- <irish-retailer-url> [product|discover]");
  process.exit(1);
}

try {
  const result = mode === "discover"
    ? await discoverProducts(url, { maxItems: 12 })
    : await scrapeProduct(url);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
