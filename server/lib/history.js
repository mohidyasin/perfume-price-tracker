import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = join(ROOT_DIR, "data");
const HISTORY_FILE = join(DATA_DIR, "price-history.json");

export async function readPriceHistory() {
  try {
    const raw = await readFile(HISTORY_FILE, "utf8");
    return normalizeHistory(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") return emptyHistory();
    throw error;
  }
}

export async function writePriceHistory(history) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(HISTORY_FILE, `${JSON.stringify(normalizeHistory(history), null, 2)}\n`, "utf8");
}

export async function updatePriceHistoryFromCatalog(report, options = {}) {
  const history = await readPriceHistory();
  const updated = mergeCatalogIntoHistory(history, report, options);
  await writePriceHistory(updated);
  return updated;
}

export function mergeCatalogIntoHistory(history, report, options = {}) {
  const date = options.date || isoDate(report.finishedAt || new Date().toISOString());
  const updatedAt = new Date().toISOString();
  const next = normalizeHistory(history);
  const productsByKey = new Map(next.products.map((product) => [product.productKey, product]));

  for (const perfume of report.perfumes || []) {
    if (!perfume.productKey) continue;

    const product = productsByKey.get(perfume.productKey) || {
      productKey: perfume.productKey,
      title: perfume.title,
      brand: perfume.brand,
      normalizedName: perfume.normalizedName,
      volumeMl: perfume.volumeMl,
      productFormat: perfume.productFormat,
      image: perfume.image || "",
      retailers: []
    };

    product.title = perfume.title || product.title;
    product.brand = perfume.brand || product.brand;
    product.normalizedName = perfume.normalizedName || product.normalizedName;
    product.volumeMl = perfume.volumeMl ?? product.volumeMl ?? null;
    product.productFormat = perfume.productFormat || product.productFormat;
    product.image = perfume.image || product.image || "";

    const retailersByKey = new Map(product.retailers.map((retailer) => [retailer.siteKey, retailer]));
    for (const offer of perfume.offers || []) {
      if (!offer.siteKey || offer.price == null) continue;
      const retailer = retailersByKey.get(offer.siteKey) || {
        siteKey: offer.siteKey,
        siteName: offer.siteName,
        points: []
      };

      retailer.siteName = offer.siteName || retailer.siteName;
      retailer.points = retailer.points.filter((point) => point.date !== date);
      retailer.points.push({
        date,
        price: roundMoney(offer.price),
        priceText: offer.priceText || formatEuro(offer.price),
        pricePer100ml: offer.pricePer100ml == null ? null : roundMoney(offer.pricePer100ml),
        title: offer.title || perfume.title,
        image: offer.image || perfume.image || "",
        productUrl: offer.productUrl || ""
      });
      retailer.points.sort((a, b) => a.date.localeCompare(b.date));

      retailersByKey.set(retailer.siteKey, retailer);
    }

    product.retailers = [...retailersByKey.values()]
      .filter((retailer) => retailer.points.length)
      .sort((a, b) => a.siteName.localeCompare(b.siteName));
    productsByKey.set(product.productKey, product);
  }

  next.updatedAt = updatedAt;
  next.runs = [
    ...next.runs.filter((run) => run.date !== date),
    {
      date,
      runId: report.runId || "",
      finishedAt: report.finishedAt || updatedAt,
      summary: report.summary || {}
    }
  ].sort((a, b) => a.date.localeCompare(b.date));
  next.products = [...productsByKey.values()].sort((a, b) => a.title.localeCompare(b.title));
  return next;
}

function normalizeHistory(history) {
  const input = history && typeof history === "object" ? history : {};
  return {
    schemaVersion: 1,
    updatedAt: input.updatedAt || "",
    runs: Array.isArray(input.runs) ? input.runs : [],
    products: Array.isArray(input.products) ? input.products.map(normalizeProductHistory) : []
  };
}

function normalizeProductHistory(product) {
  return {
    productKey: product.productKey || "",
    title: product.title || "",
    brand: product.brand || "",
    normalizedName: product.normalizedName || "",
    volumeMl: product.volumeMl ?? null,
    productFormat: product.productFormat || "format-unknown",
    image: product.image || "",
    retailers: Array.isArray(product.retailers) ? product.retailers.map(normalizeRetailerHistory) : []
  };
}

function normalizeRetailerHistory(retailer) {
  return {
    siteKey: retailer.siteKey || "",
    siteName: retailer.siteName || "",
    points: Array.isArray(retailer.points)
      ? retailer.points
        .filter((point) => point?.date && point.price != null)
        .map((point) => ({
          date: point.date,
          price: roundMoney(point.price),
          priceText: point.priceText || formatEuro(point.price),
          pricePer100ml: point.pricePer100ml == null ? null : roundMoney(point.pricePer100ml),
          title: point.title || "",
          image: point.image || "",
          productUrl: point.productUrl || ""
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
      : []
  };
}

function emptyHistory() {
  return {
    schemaVersion: 1,
    updatedAt: "",
    runs: [],
    products: []
  };
}

function isoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function formatEuro(value) {
  return `€${Number(value).toFixed(2)}`;
}
