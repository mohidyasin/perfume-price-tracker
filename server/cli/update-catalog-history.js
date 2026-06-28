import { scrapeCatalog } from "../lib/catalog.js";
import { updatePriceHistoryFromCatalog } from "../lib/history.js";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  })
);

const report = await scrapeCatalog({
  siteLimit: args.has("site-limit") ? Number(args.get("site-limit")) : undefined,
  maxPagesPerSite: args.has("pages") ? Number(args.get("pages")) : undefined,
  maxItemsPerPage: args.has("items") ? Number(args.get("items")) : undefined,
  includeStorefronts: args.get("include-storefronts") === "true"
});

const history = await updatePriceHistoryFromCatalog(report, {
  date: args.get("date") || undefined
});

console.log(JSON.stringify({
  runId: report.runId,
  catalogSummary: report.summary,
  history: {
    runs: history.runs.length,
    products: history.products.length,
    updatedAt: history.updatedAt
  },
  outputs: [
    "data/catalog-latest.json",
    "data/price-history.json"
  ]
}, null, 2));
