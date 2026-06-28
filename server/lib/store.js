import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = join(ROOT_DIR, "data");
const DATA_FILE = join(DATA_DIR, "tracker.json");

const EMPTY_STORE = {
  version: 1,
  products: []
};

export async function readStore() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY_STORE,
      ...parsed,
      products: Array.isArray(parsed.products) ? parsed.products : []
    };
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(EMPTY_STORE);
    throw error;
  }
}

export async function writeStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function listProducts() {
  const store = await readStore();
  return store.products.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function upsertScrapedProduct(scraped, overrides = {}) {
  const store = await readStore();
  const id = productId(scraped.url);
  const now = scraped.fetchedAt || new Date().toISOString();
  const existing = store.products.find((item) => item.id === id);
  const historyEntry = {
    checkedAt: now,
    price: scraped.price,
    priceText: scraped.priceText,
    currency: scraped.currency || "EUR",
    source: scraped.source,
    confidence: scraped.confidence
  };

  if (existing) {
    existing.name = scraped.name || existing.name;
    existing.brand = scraped.brand || existing.brand || "";
    existing.image = scraped.image || existing.image || "";
    existing.currentPrice = scraped.price;
    existing.priceText = scraped.priceText;
    existing.currency = scraped.currency || existing.currency || "EUR";
    existing.siteKey = scraped.siteKey;
    existing.siteName = scraped.siteName;
    existing.finalUrl = scraped.finalUrl || scraped.url;
    existing.lastChecked = now;
    existing.lastError = "";
    existing.scrapeSource = scraped.source;
    existing.confidence = scraped.confidence;
    existing.targetPrice = normalizeOptionalPrice(overrides.targetPrice ?? existing.targetPrice);
    existing.notes = overrides.notes ?? existing.notes ?? "";
    existing.lowestSeen = lowest(existing.lowestSeen, scraped.price);
    existing.highestSeen = highest(existing.highestSeen, scraped.price);
    existing.history = [...(existing.history || []), historyEntry].slice(-250);
    await writeStore(store);
    return existing;
  }

  const product = {
    id,
    url: scraped.url,
    finalUrl: scraped.finalUrl || scraped.url,
    siteKey: scraped.siteKey,
    siteName: scraped.siteName,
    name: scraped.name,
    brand: scraped.brand || "",
    image: scraped.image || "",
    currentPrice: scraped.price,
    priceText: scraped.priceText,
    currency: scraped.currency || "EUR",
    targetPrice: normalizeOptionalPrice(overrides.targetPrice),
    notes: overrides.notes || "",
    createdAt: now,
    lastChecked: now,
    lastError: "",
    scrapeSource: scraped.source,
    confidence: scraped.confidence,
    lowestSeen: scraped.price,
    highestSeen: scraped.price,
    history: [historyEntry]
  };

  store.products.push(product);
  await writeStore(store);
  return product;
}

export async function updateProduct(id, patch) {
  const store = await readStore();
  const product = store.products.find((item) => item.id === id);
  if (!product) return null;

  if ("targetPrice" in patch) {
    product.targetPrice = normalizeOptionalPrice(patch.targetPrice);
  }
  if ("notes" in patch) {
    product.notes = String(patch.notes || "").slice(0, 500);
  }

  await writeStore(store);
  return product;
}

export async function recordProductError(id, message) {
  const store = await readStore();
  const product = store.products.find((item) => item.id === id);
  if (!product) return null;
  product.lastError = String(message || "Scrape failed");
  product.lastChecked = new Date().toISOString();
  await writeStore(store);
  return product;
}

export async function deleteProduct(id) {
  const store = await readStore();
  const before = store.products.length;
  store.products = store.products.filter((item) => item.id !== id);
  await writeStore(store);
  return store.products.length !== before;
}

export function productId(url) {
  return createHash("sha1").update(String(url)).digest("hex").slice(0, 14);
}

function normalizeOptionalPrice(value) {
  if (value == null || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null;
}

function lowest(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.min(a, b);
}

function highest(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return Math.max(a, b);
}
