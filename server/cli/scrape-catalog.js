import { scrapeCatalog } from "../lib/catalog.js";

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

console.log(JSON.stringify({
  runId: report.runId,
  summary: report.summary,
  topDiscrepancies: report.discrepancies.slice(0, 10).map((item) => ({
    title: item.title,
    bestPrice: item.bestPrice,
    highestPrice: item.highestPrice,
    spread: item.spread,
    bestSite: item.bestOffer?.siteName
  })),
  output: "data/catalog-latest.json"
}, null, 2));
