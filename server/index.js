import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { SITE_ALLOWLIST } from "./config/sites.js";
import { readLatestCatalog, scrapeCatalog } from "./lib/catalog.js";
import { readPriceHistory, updatePriceHistoryFromCatalog } from "./lib/history.js";
import { discoverProducts, scrapeProduct } from "./lib/scraper.js";
import {
  deleteProduct,
  listProducts,
  recordProductError,
  readStore,
  updateProduct,
  upsertScrapedProduct
} from "./lib/store.js";

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(ROOT_DIR, "public");
const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(PORT, () => {
  console.log(`Irish perfume price tracker running at http://localhost:${PORT}`);
});

async function routeRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/api/sites" && req.method === "GET") {
    return sendJson(res, {
      sites: SITE_ALLOWLIST.map(({ key, name, homepage, categoryUrls, notes }) => ({
        key,
        name,
        homepage,
        categoryUrls,
        notes
      }))
    });
  }

  if (pathname === "/api/products" && req.method === "GET") {
    return sendJson(res, { products: await listProducts() });
  }

  if (pathname === "/api/catalog" && req.method === "GET") {
    return sendJson(res, await readLatestCatalog());
  }

  if (pathname === "/api/history" && req.method === "GET") {
    return sendJson(res, await readPriceHistory());
  }

  if (pathname === "/api/catalog/scrape" && req.method === "POST") {
    const body = await readJsonBody(req);
    const report = await scrapeCatalog({
      siteLimit: body.siteLimit || SITE_ALLOWLIST.length,
      maxPagesPerSite: body.maxPagesPerSite || 6,
      maxItemsPerPage: body.maxItemsPerPage || 80,
      includeStorefronts: Boolean(body.includeStorefronts)
    });
    await updatePriceHistoryFromCatalog(report);
    return sendJson(res, report, 201);
  }

  if (pathname === "/api/products" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.url) throw httpError(400, "A product URL is required.");
    const scraped = await scrapeProduct(body.url);
    const product = await upsertScrapedProduct(scraped, {
      targetPrice: body.targetPrice,
      notes: body.notes
    });
    return sendJson(res, { product }, 201);
  }

  if (pathname === "/api/discover" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body.url) throw httpError(400, "A category or search URL is required.");
    const result = await discoverProducts(body.url, { maxItems: body.maxItems || 24 });
    return sendJson(res, result);
  }

  const refreshMatch = pathname.match(/^\/api\/products\/([^/]+)\/refresh$/);
  if (refreshMatch && req.method === "POST") {
    const product = (await readStore()).products.find((item) => item.id === refreshMatch[1]);
    if (!product) throw httpError(404, "Tracked product not found.");

    try {
      const scraped = await scrapeProduct(product.url);
      const updated = await upsertScrapedProduct(scraped, {
        targetPrice: product.targetPrice,
        notes: product.notes
      });
      return sendJson(res, { product: updated });
    } catch (error) {
      const failed = await recordProductError(product.id, error.message);
      throw httpError(error.statusCode || 502, error.message, { product: failed });
    }
  }

  if (pathname === "/api/refresh-all" && req.method === "POST") {
    const products = await listProducts();
    const results = [];

    for (const product of products) {
      try {
        const scraped = await scrapeProduct(product.url);
        const updated = await upsertScrapedProduct(scraped, {
          targetPrice: product.targetPrice,
          notes: product.notes
        });
        results.push({ id: product.id, ok: true, product: updated });
      } catch (error) {
        const failed = await recordProductError(product.id, error.message);
        results.push({ id: product.id, ok: false, error: error.message, product: failed });
      }
    }

    return sendJson(res, { results, products: await listProducts() });
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && req.method === "PATCH") {
    const body = await readJsonBody(req);
    const product = await updateProduct(productMatch[1], body);
    if (!product) throw httpError(404, "Tracked product not found.");
    return sendJson(res, { product });
  }

  if (productMatch && req.method === "DELETE") {
    const removed = await deleteProduct(productMatch[1]);
    if (!removed) throw httpError(404, "Tracked product not found.");
    return sendJson(res, { ok: true });
  }

  if (req.method === "GET") {
    return serveStatic(res, pathname);
  }

  throw httpError(404, "Not found.");
}

async function serveStatic(res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    throw httpError(403, "Forbidden.");
  }

  try {
    const file = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      const index = await readFile(join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "content-type": MIME_TYPES[".html"], "cache-control": "no-store" });
      res.end(index);
      return;
    }
    throw error;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({
    error: {
      message: error.message || "Unexpected error",
      code: error.code || "ERROR",
      ...(error.details || {})
    }
  }));
}

function httpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}
