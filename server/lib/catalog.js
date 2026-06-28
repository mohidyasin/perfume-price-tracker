import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_ALLOWLIST, canonicalizeUrl } from "../config/sites.js";
import { discoverProducts } from "./scraper.js";

const ROOT_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = join(ROOT_DIR, "data");
const LATEST_CATALOG_FILE = join(DATA_DIR, "catalog-latest.json");

const BRAND_ALIASES = [
  ["hugo boss", "Hugo Boss"],
  ["boss", "Hugo Boss"],
  ["calvin klein", "Calvin Klein"],
  ["ck", "Calvin Klein"],
  ["paco rabanne", "Rabanne"],
  ["rabanne", "Rabanne"],
  ["jean paul gaultier", "Jean Paul Gaultier"],
  ["tommy hilfiger", "Tommy Hilfiger"],
  ["tom ford", "Tom Ford"],
  ["yves saint laurent", "Yves Saint Laurent"],
  ["ysl", "Yves Saint Laurent"],
  ["dolce gabbana", "Dolce & Gabbana"],
  ["dolce & gabbana", "Dolce & Gabbana"],
  ["giorgio armani", "Armani"],
  ["emporio armani", "Armani"],
  ["armani", "Armani"],
  ["issey miyake", "Issey Miyake"],
  ["davidoff", "Davidoff"],
  ["david beckham", "David Beckham"],
  ["joop", "Joop"],
  ["versace", "Versace"],
  ["dior", "Dior"],
  ["chanel", "Chanel"],
  ["prada", "Prada"],
  ["gucci", "Gucci"],
  ["montblanc", "Montblanc"],
  ["lacoste", "Lacoste"],
  ["aramis", "Aramis"],
  ["tommy bowe", "Tommy Bowe"],
  ["jenny glow", "Jenny Glow"],
  ["verset", "Verset"]
];

const NOISE_TERMS_RE = /\b(save|worth|free gift|with purchase|spray|natural spray|vaporisateur|refillable bottle|refill|for him|for men|mens|men's|male|for her|women|women's|womens|female|ladies|all sizes|various sizes|default title)\b/gi;
const AUDIENCE_VALUES = ["men", "women", "unisex", "unknown"];

export async function scrapeCatalog(options = {}) {
  const runId = options.runId || new Date().toISOString().replace(/[:.]/g, "-");
  const maxPagesPerSite = clampNumber(options.maxPagesPerSite, 1, 20, 6);
  const maxItemsPerPage = clampNumber(options.maxItemsPerPage, 1, 80, 80);
  const includeStorefronts = Boolean(options.includeStorefronts);
  const siteLimit = clampNumber(options.siteLimit, 1, SITE_ALLOWLIST.length, SITE_ALLOWLIST.length);
  const sites = SITE_ALLOWLIST
    .filter((site) => site.categoryUrls?.length)
    .filter((site) => includeStorefronts || site.irishBased !== false)
    .slice(0, siteLimit);

  const startedAt = new Date().toISOString();
  const siteReports = [];
  const allItems = [];

  for (const site of sites) {
    const siteReport = {
      siteKey: site.key,
      siteName: site.name,
      homepage: site.homepage,
      irishBased: site.irishBased !== false,
      pagesScraped: 0,
      productsFound: 0,
      errors: []
    };

    const seenPages = new Set();
    const queuedPages = site.categoryUrls.map((url) => ({
      url,
      audience: inferAudience(url) || "unknown"
    }));
    const seenItems = new Set();

    while (queuedPages.length && siteReport.pagesScraped < maxPagesPerSite) {
      const page = queuedPages.shift();
      const pageUrl = page.url;
      const canonicalPageUrl = canonicalizeUrl(pageUrl);
      if (seenPages.has(canonicalPageUrl)) continue;
      seenPages.add(canonicalPageUrl);

      try {
        const result = await discoverProducts(canonicalPageUrl, {
          maxItems: maxItemsPerPage,
          timeoutMs: options.timeoutMs || 20000
        });
        siteReport.pagesScraped += 1;

        for (const rawItem of result.items) {
          const normalized = normalizeCatalogItem(rawItem, {
            runId,
            scrapedAt: result.fetchedAt,
            site,
            audience: page.audience,
            sourceCategoryUrl: canonicalPageUrl
          });
          const itemKey = `${normalized.siteKey}|${normalized.canonicalUrl}|${normalized.volumeMl || ""}|${normalized.price.current}`;
          if (seenItems.has(itemKey)) continue;
          seenItems.add(itemKey);
          allItems.push(normalized);
        }

        for (const nextUrl of result.paginationUrls || []) {
          if (!seenPages.has(nextUrl) && queuedPages.length < maxPagesPerSite * 3) {
            queuedPages.push({
              url: nextUrl,
              audience: page.audience
            });
          }
        }
      } catch (error) {
        siteReport.errors.push({
          url: canonicalPageUrl,
          message: error.message,
          code: error.code || "SCRAPE_ERROR",
          httpStatus: error.httpStatus || null
        });
      }
    }

    siteReport.productsFound = allItems.filter((item) => item.siteKey === site.key).length;
    siteReports.push(siteReport);
  }

  const report = buildCatalogReport({
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    sites,
    siteReports,
    items: allItems
  });

  await writeLatestCatalog(report);
  return report;
}

export function normalizeCatalogItem(rawItem, context = {}) {
  const site = context.site || {};
  const name = cleanName(rawItem.name || "");
  const canonicalUrl = canonicalizeUrl(rawItem.url);
  const identityText = `${name} ${decodeURIComponent(new URL(canonicalUrl).pathname)}`;
  const brand = normalizeBrand(rawItem.brand || inferBrandFromName(name));
  const volumeMl = extractVolumeMl(identityText);
  const productFormat = extractProductFormat(identityText);
  const normalizedName = normalizePerfumeName(name, brand, volumeMl);
  const currentPrice = normalizePrice(rawItem.price);
  const listPrice = normalizePrice(rawItem.listPrice);
  const pricePer100ml = currentPrice && volumeMl ? roundMoney((currentPrice / volumeMl) * 100) : null;
  const productKey = buildProductKey({ brand, normalizedName, productFormat, volumeMl });
  const image = normalizeImageUrl(rawItem.image, canonicalUrl);
  const audience = resolveAudience(rawItem, context, identityText);

  return {
    schemaVersion: 1,
    catalogId: shortHash(`${site.key}|${canonicalUrl}|${normalizedName}|${volumeMl || ""}|${currentPrice || ""}`),
    runId: context.runId || "",
    scrapedAt: context.scrapedAt || new Date().toISOString(),
    siteKey: rawItem.siteKey || site.key || "",
    siteName: rawItem.siteName || site.name || "",
    siteHomepage: site.homepage || "",
    irishBased: site.irishBased !== false,
    canonicalUrl,
    productUrl: canonicalUrl,
    image,
    title: name,
    brand,
    normalizedName,
    productKey,
    volumeMl,
    productFormat,
    audience,
    category: categoryForAudience(audience),
    price: {
      current: currentPrice,
      list: listPrice,
      currency: rawItem.currency || "EUR",
      text: rawItem.priceText || (currentPrice == null ? "" : formatEuro(currentPrice)),
      discountPct: rawItem.discountPct ?? calculateDiscountPct(currentPrice, listPrice),
      per100ml: pricePer100ml
    },
    availability: rawItem.availability || "",
    source: rawItem.source || "",
    confidence: rawItem.confidence || 0
  };
}

export function buildCatalogReport({ runId, startedAt, finishedAt, sites, siteReports, items }) {
  const groups = groupComparableItems(items);
  const perfumes = buildPerfumeGroups(groups);
  const audienceCounts = countBy(perfumes, (perfume) => perfume.audience || "unknown");
  const discrepancies = perfumes
    .filter((group) => group.offerCount >= 2 && group.bestPrice != null && group.highestPrice > group.bestPrice)
    .map((group) => ({
      productKey: group.productKey,
      title: group.title,
      brand: group.brand,
      volumeMl: group.volumeMl,
      productFormat: group.productFormat,
      audience: group.audience,
      offerCount: group.offerCount,
      bestPrice: group.bestPrice,
      highestPrice: group.highestPrice,
      spread: group.spread,
      spreadPct: group.spreadPct,
      bestOffer: group.items.find((item) => item.price.current === group.bestPrice),
      offers: group.items
        .slice()
        .sort((a, b) => a.price.current - b.price.current)
        .map((item) => ({
          siteName: item.siteName,
          productUrl: item.productUrl,
          price: item.price.current,
          priceText: item.price.text,
          pricePer100ml: item.price.per100ml,
          title: item.title
        }))
    }))
    .sort((a, b) => b.spreadPct - a.spreadPct || b.spread - a.spread)
    .slice(0, 50);

  const saleDeals = items
    .filter((item) => item.price.discountPct != null && item.price.discountPct >= 10)
    .sort((a, b) => b.price.discountPct - a.price.discountPct || a.price.current - b.price.current)
    .slice(0, 50);

  return {
    schemaVersion: 1,
    runId,
    startedAt,
    finishedAt,
    standardization: {
      groupKeyParts: ["brand", "normalizedName", "productFormat", "volumeMl"],
      sizeUnit: "ml",
      formatValues: [
        "eau-de-parfum",
        "eau-de-toilette",
        "parfum",
        "aftershave",
        "cologne",
        "deodorant",
        "body-spray",
        "gift-set",
        "format-unknown"
      ],
      audienceValues: AUDIENCE_VALUES
    },
    summary: {
      sitesRequested: sites.length,
      sitesSucceeded: siteReports.filter((site) => site.pagesScraped > 0).length,
      sitesFailed: siteReports.filter((site) => site.pagesScraped === 0).length,
      pagesScraped: siteReports.reduce((sum, site) => sum + site.pagesScraped, 0),
      productsFound: items.length,
      distinctProductKeys: groups.size,
      consolidatedPerfumes: perfumes.length,
      comparableGroups: discrepancies.length,
      saleDeals: saleDeals.length,
      audienceCounts
    },
    sites: siteReports,
    perfumes,
    items,
    discrepancies,
    saleDeals
  };
}

export async function readLatestCatalog() {
  try {
    const raw = await readFile(LATEST_CATALOG_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        schemaVersion: 1,
        runId: "",
        standardization: {
          groupKeyParts: ["brand", "normalizedName", "productFormat", "volumeMl"],
          sizeUnit: "ml",
          formatValues: [],
          audienceValues: AUDIENCE_VALUES
        },
        summary: {
          sitesRequested: 0,
          sitesSucceeded: 0,
          sitesFailed: 0,
          pagesScraped: 0,
          productsFound: 0,
          distinctProductKeys: 0,
          consolidatedPerfumes: 0,
          comparableGroups: 0,
          saleDeals: 0,
          audienceCounts: {}
        },
        sites: [],
        perfumes: [],
        items: [],
        discrepancies: [],
        saleDeals: []
      };
    }
    throw error;
  }
}

export async function writeLatestCatalog(report) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LATEST_CATALOG_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function groupComparableItems(items) {
  const groups = new Map();

  for (const item of items) {
    if (!item.productKey || item.price.current == null) continue;
    const existing = groups.get(item.productKey) || {
      productKey: item.productKey,
      title: item.title,
      brand: item.brand,
      volumeMl: item.volumeMl,
      productFormat: item.productFormat,
      audience: item.audience || "unknown",
      minPrice: null,
      maxPrice: null,
      items: []
    };

    existing.items.push(item);
    existing.items = dedupeGroupItems(existing.items);
    existing.audience = summarizeAudience(existing.items.map((entry) => entry.audience));
    const prices = existing.items.map((entry) => entry.price.current).filter((price) => price != null);
    existing.minPrice = prices.length ? Math.min(...prices) : null;
    existing.maxPrice = prices.length ? Math.max(...prices) : null;
    groups.set(item.productKey, existing);
  }

  return groups;
}

function buildPerfumeGroups(groups) {
  return [...groups.values()]
    .map((group) => {
      const offers = group.items
        .slice()
        .sort((a, b) => a.price.current - b.price.current)
        .map((item, index) => ({
          siteKey: item.siteKey,
          siteName: item.siteName,
          productUrl: item.productUrl,
          title: item.title,
          audience: item.audience || "unknown",
          image: item.image,
          price: item.price.current,
          priceText: item.price.text,
          currency: item.price.currency,
          listPrice: item.price.list,
          discountPct: item.price.discountPct,
          pricePer100ml: item.price.per100ml,
          source: item.source,
          confidence: item.confidence,
          isBestPrice: index === 0
        }));

      const bestOffer = offers[0] || null;
      const worstOffer = offers[offers.length - 1] || null;
      const spread = bestOffer && worstOffer ? roundMoney(worstOffer.price - bestOffer.price) : null;

      return {
        productKey: group.productKey,
        title: chooseGroupTitle(group.items),
        brand: group.brand,
        normalizedName: group.items[0]?.normalizedName || "",
        volumeMl: group.volumeMl,
        productFormat: group.productFormat,
        audience: group.audience || summarizeAudience(group.items.map((item) => item.audience)),
        image: bestOffer?.image || group.items.find((item) => item.image)?.image || "",
        offerCount: offers.length,
        retailerCount: new Set(offers.map((offer) => offer.siteKey)).size,
        bestPrice: bestOffer?.price ?? null,
        highestPrice: worstOffer?.price ?? null,
        spread,
        spreadPct: worstOffer?.price ? Math.round(((worstOffer.price - bestOffer.price) / worstOffer.price) * 1000) / 10 : null,
        bestOffer,
        offers,
        items: group.items
      };
    })
    .sort((a, b) => {
      const comparableDiff = Number(b.offerCount > 1) - Number(a.offerCount > 1);
      if (comparableDiff) return comparableDiff;
      return (b.spreadPct || 0) - (a.spreadPct || 0)
        || b.offerCount - a.offerCount
        || String(a.title).localeCompare(String(b.title));
    });
}

function chooseGroupTitle(items) {
  const sorted = items
    .slice()
    .sort((a, b) => scoreTitle(b.title) - scoreTitle(a.title) || String(a.title).length - String(b.title).length);
  return sorted[0]?.title || "Unknown fragrance";
}

function scoreTitle(title) {
  let score = 0;
  if (/\b\d+(?:\.\d+)?\s*ml\b/i.test(title)) score += 3;
  if (/\beau\s+de\s+(?:toilette|parfum)\b|\bedt\b|\bedp\b/i.test(title)) score += 2;
  if (!/\b(all sizes|various sizes|unknown)\b/i.test(title)) score += 1;
  return score;
}

function dedupeGroupItems(items) {
  const seenSites = new Map();
  for (const item of items) {
    const previous = seenSites.get(item.siteKey);
    if (!previous || item.price.current < previous.price.current) {
      seenSites.set(item.siteKey, item);
    }
  }
  return [...seenSites.values()];
}

function normalizePerfumeName(name, brand, volumeMl) {
  let text = asciiFold(name).toLowerCase();
  text = text
    .replace(/\b(edp)\b/g, "eau de parfum")
    .replace(/\b(edt)\b/g, "eau de toilette")
    .replace(/\b(eau de parfum|eau de toilette|parfum|aftershave lotion|aftershave|cologne)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*ml\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*fl\.?\s*oz\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*oz\b/g, " ")
    .replace(/\u20ac\s*\d+(?:\.\d+)?/g, " ")
    .replace(NOISE_TERMS_RE, " ");

  if (brand) {
    const brandSlug = asciiFold(brand).toLowerCase().replace(/&/g, "and");
    text = text.replace(new RegExp(`\\b${escapeRegExp(brandSlug)}\\b`, "g"), " ");
    for (const [alias, label] of BRAND_ALIASES) {
      if (label !== brand) continue;
      const aliasSlug = asciiFold(alias).toLowerCase().replace(/&/g, "and");
      text = text.replace(new RegExp(`\\b${escapeRegExp(aliasSlug)}\\b`, "g"), " ");
    }
  }

  return text
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildProductKey({ brand, normalizedName, productFormat, volumeMl }) {
  const brandPart = slugify(brand || "unknown");
  const namePart = slugify(normalizedName || "unknown");
  const formatPart = slugify(productFormat || "format-unknown");
  const volumePart = volumeMl ? `${volumeMl}ml` : "size-unknown";
  return `${brandPart}:${namePart}:${formatPart}:${volumePart}`;
}

function resolveAudience(rawItem, context, identityText) {
  const explicit = normalizeAudience(rawItem.audience);
  if (explicit) return explicit;

  const productAudience = inferAudience(identityText);
  if (productAudience) return productAudience;

  const sourceAudience = normalizeAudience(context.audience) || inferAudience(context.sourceCategoryUrl);
  return sourceAudience || "unknown";
}

function inferAudience(value) {
  const text = asciiFold(decodeURIComponentSafe(value)).toLowerCase();
  if (/\b(unisex|everyone|all genders|all-gender|gender neutral|gender-neutral)\b/.test(text)) return "unisex";
  if (/\b(for her|for-her|pour femme|femme|women|women's|womens|female|ladies|fragrance-for-her|fragrances-for-her|womens-fragrance|womens-fragrances)\b/.test(text)) return "women";
  if (/\b(for him|for-him|for men|for-men|pour homme|homme|men|men's|mens|male|fragrance-for-him|fragrances-for-him|mens-fragrance|mens-fragrances)\b/.test(text)) return "men";
  return "";
}

function normalizeAudience(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["men", "male", "mens", "men's"].includes(text)) return "men";
  if (["women", "female", "womens", "women's", "ladies"].includes(text)) return "women";
  if (["unisex", "everyone", "all"].includes(text)) return "unisex";
  return "";
}

function summarizeAudience(values) {
  const known = new Set(values.map((value) => normalizeAudience(value)).filter(Boolean));
  known.delete("unknown");
  if (known.has("unisex") || (known.has("men") && known.has("women"))) return "unisex";
  if (known.has("men")) return "men";
  if (known.has("women")) return "women";
  return "unknown";
}

function categoryForAudience(audience) {
  const normalized = normalizeAudience(audience) || "unknown";
  if (normalized === "men") return "mens-fragrance";
  if (normalized === "women") return "womens-fragrance";
  if (normalized === "unisex") return "unisex-fragrance";
  return "fragrance";
}

function countBy(items, valueFor) {
  const counts = {};
  for (const item of items) {
    const value = valueFor(item) || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function inferBrandFromName(name) {
  const folded = asciiFold(name).toLowerCase().replace(/&/g, "and");
  for (const [alias, brand] of BRAND_ALIASES) {
    const normalizedAlias = asciiFold(alias).toLowerCase().replace(/&/g, "and");
    if (folded.includes(normalizedAlias)) return brand;
  }
  return "";
}

function normalizeBrand(brand) {
  const folded = asciiFold(brand).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
  if (!folded) return "";
  for (const [alias, label] of BRAND_ALIASES) {
    const normalizedAlias = asciiFold(alias).toLowerCase().replace(/&/g, "and");
    if (folded === normalizedAlias || folded.includes(normalizedAlias)) return label;
  }
  return titleCase(brand);
}

function extractVolumeMl(name) {
  const mlMatch = String(name || "").match(/\b(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) return Number(mlMatch[1]);

  const flozMatch = String(name || "").match(/\b(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz\b/i);
  if (!flozMatch) return null;
  return Math.round(Number(flozMatch[1]) * 29.5735);
}

function extractProductFormat(name) {
  const text = asciiFold(name).toLowerCase();
  if (/\bgift\s*set\b|\bset\b/i.test(text)) return "gift-set";
  if (/\bdeodorant\b|\bdeo\b/i.test(text)) return "deodorant";
  if (/\bbody\s*spray\b/i.test(text)) return "body-spray";
  if (/\baftershave\b/i.test(text)) return "aftershave";
  if (/\beau\s+de\s+parfum\b|\bedp\b/i.test(text)) return "eau-de-parfum";
  if (/\beau\s+de\s+toilette\b|\bedt\b/i.test(text)) return "eau-de-toilette";
  if (/\bparfum\b|\bperfume\b/i.test(text)) return "parfum";
  if (/\bcologne\b/i.test(text)) return "cologne";
  return "format-unknown";
}

function cleanName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+Worth\s+\u20ac?\d+(?:\.\d+)?/i, "")
    .replace(/\bWorth\s+\u20ac?\d+(?:\.\d+)?/i, "")
    .trim();
}

function normalizePrice(value) {
  if (value == null || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? roundMoney(price) : null;
}

function normalizeImageUrl(value, baseUrl) {
  const image = String(value || "").trim();
  if (!image || /^(data:|blob:|#)/i.test(image)) return "";

  try {
    return new URL(image.replace(/&amp;/gi, "&"), baseUrl).toString();
  } catch {
    return "";
  }
}

function calculateDiscountPct(currentPrice, listPrice) {
  if (currentPrice == null || listPrice == null || listPrice <= currentPrice) return null;
  return Math.round(((listPrice - currentPrice) / listPrice) * 1000) / 10;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function formatEuro(value) {
  return `\u20ac${Number(value).toFixed(2)}`;
}

function slugify(value) {
  return asciiFold(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asciiFold(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bCk\b/g, "CK")
    .replace(/\bYsl\b/g, "YSL");
}

function shortHash(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 16);
}

function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
