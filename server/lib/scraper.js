import { assertAllowedSite, canonicalizeUrl, getAllowedSite } from "../config/sites.js";

const USER_AGENT = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  "Chrome/126.0 Safari/537.36",
  "IrishPerfumePriceTracker/0.1"
].join(" ");

const MONEY_SYMBOL_PATTERN = "(?:\\u20ac|&euro;|EUR\\s*)";
const MONEY_RE = new RegExp(`${MONEY_SYMBOL_PATTERN}\\s*([0-9]{1,4}(?:[,.][0-9]{3})*(?:[,.][0-9]{1,2})?)`, "gi");
const PRODUCT_PATH_RE = /(?:^|[-/])(eau|parfum|perfume|toilette|aftershave|cologne|fragrance|fragrances|homme|pour-homme|for-him|for-men|spray|edt|edp)(?:[-/0-9]|$)/i;

export async function scrapeProduct(inputUrl, options = {}) {
  const site = assertAllowedSite(inputUrl);
  const url = canonicalizeUrl(inputUrl);
  const { html, finalUrl, status } = await fetchHtml(url, options);
  const scraped = extractProductFromHtml(html, finalUrl || url, site);

  return {
    ...scraped,
    url,
    finalUrl: canonicalizeUrl(finalUrl || url),
    siteKey: site.key,
    siteName: site.name,
    fetchedAt: new Date().toISOString(),
    httpStatus: status
  };
}

export async function discoverProducts(inputUrl, options = {}) {
  const site = assertAllowedSite(inputUrl);
  const url = canonicalizeUrl(inputUrl);
  const { html, finalUrl, status } = await fetchHtml(url, options);
  const items = discoverProductsFromHtml(html, finalUrl || url, site, options);
  const paginationUrls = discoverPaginationUrlsFromHtml(html, finalUrl || url, site);

  return {
    url,
    finalUrl: canonicalizeUrl(finalUrl || url),
    siteKey: site.key,
    siteName: site.name,
    fetchedAt: new Date().toISOString(),
    httpStatus: status,
    items,
    paginationUrls
  };
}

export async function fetchHtml(url, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-IE,en;q=0.9",
        "cache-control": "no-cache",
        "user-agent": USER_AGENT
      }
    });

    const html = await response.text();
    if (!response.ok) {
      const error = new Error(
        response.status === 403
          ? "The retailer blocked this automated fetch with HTTP 403."
          : `The retailer returned HTTP ${response.status}.`
      );
      error.code = response.status === 403 ? "FETCH_BLOCKED" : "FETCH_FAILED";
      error.statusCode = 502;
      error.httpStatus = response.status;
      throw error;
    }

    return { html, finalUrl: response.url, status: response.status };
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`The retailer did not respond within ${timeoutMs / 1000}s.`);
      timeoutError.code = "FETCH_TIMEOUT";
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function extractProductFromHtml(html, inputUrl, site = getAllowedSite(inputUrl)) {
  const jsonLdCandidates = extractJsonLdCandidates(html);
  const embeddedCandidates = extractEmbeddedJsonCandidates(html);
  const metaCandidate = extractMetaCandidate(html);
  const fallbackCandidate = extractFallbackCandidate(html);

  const candidate = chooseBestProductCandidate([
    ...jsonLdCandidates,
    ...embeddedCandidates,
    metaCandidate,
    fallbackCandidate
  ]);

  const name = cleanProductName(candidate?.name || fallbackCandidate.name || "Unknown fragrance", site);
  const price = candidate?.price ?? null;
  const priceText = candidate?.priceText || (price == null ? "" : formatEuro(price));

  return {
    name,
    brand: cleanProductName(candidate?.brand || "", site),
    price,
    priceText,
    currency: candidate?.currency || inferCurrency(candidate?.priceText || priceText) || "EUR",
    image: absolutizeUrl(candidate?.image || metaCandidate.image || "", inputUrl),
    source: candidate?.source || "fallback",
    confidence: candidate?.confidence || 0.35,
    scrapedFields: {
      hasName: Boolean(name && name !== "Unknown fragrance"),
      hasPrice: price != null,
      hasImage: Boolean(candidate?.image || metaCandidate.image)
    }
  };
}

export function discoverProductsFromHtml(html, inputUrl, site = getAllowedSite(inputUrl), options = {}) {
  const maxItems = Math.max(1, Math.min(Number(options.maxItems || 24), 80));
  const results = new Map();

  for (const candidate of extractStructuredListingCandidates(html, inputUrl, site)) {
    addDiscoveryResult(results, candidate);
    if (results.size >= maxItems) break;
  }

  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (!attrs.href) continue;

    const absoluteUrl = absolutizeUrl(attrs.href, inputUrl);
    if (!absoluteUrl || !getAllowedSite(absoluteUrl)) continue;
    if (!looksLikeProductUrl(absoluteUrl, site)) continue;

    const canonicalUrl = canonicalizeUrl(absoluteUrl);
    if (hasDiscoveryUrl(results, canonicalUrl)) continue;

    const context = getListingContext(html, match.index, anchorRe.lastIndex, site);
    const attrPrice = parseMoney(attrs["data-price"]) ?? extractFinalPriceFromContext(context);
    const contextPrice = selectPrice(extractPrices(stripTags(context)));
    const priceInfo = attrPrice == null
      ? contextPrice
      : { value: attrPrice, text: formatEuro(attrPrice) };
    const rawName = inferDiscoveryName(attrs, match[2], context, absoluteUrl, site);
    const name = cleanProductName(rawName, site) || nameFromUrl(absoluteUrl);
    if (!priceInfo) continue;
    const listPrice = inferListPrice(context, priceInfo.value);

    addDiscoveryResult(results, {
      url: canonicalUrl,
      siteKey: site?.key || "",
      siteName: site?.name || "",
      name,
      price: priceInfo?.value ?? null,
      priceText: priceInfo?.text || "",
      currency: inferCurrency(priceInfo?.text) || "EUR",
      listPrice,
      discountPct: calculateDiscountPct(priceInfo?.value, listPrice),
      image: extractListingImage(attrs, match[2], context, inputUrl),
      source: "listing",
      confidence: priceInfo ? 0.72 : 0.52
    });

    if (results.size >= maxItems) break;
  }

  return [...results.values()];
}

export function discoverPaginationUrlsFromHtml(html, inputUrl, site = getAllowedSite(inputUrl)) {
  const urls = new Set();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (!attrs.href || attrs.href.startsWith("#") || attrs.href.startsWith("javascript:")) continue;

    const text = stripTags(match[2]);
    const rel = String(attrs.rel || "").toLowerCase();
    const label = String(attrs["aria-label"] || attrs.title || "").toLowerCase();
    const absoluteUrl = absolutizeUrl(attrs.href, inputUrl);
    if (!absoluteUrl || !getAllowedSite(absoluteUrl)) continue;
    if (site && getAllowedSite(absoluteUrl)?.key !== site.key) continue;
    if (looksLikeProductUrl(absoluteUrl, site)) continue;

    const parsed = new URL(absoluteUrl);
    const samePath = parsed.pathname === new URL(inputUrl).pathname;
    const hasPageParam = [...parsed.searchParams.keys()].some((key) => /^(p|page|page_number|pageNumber|start)$/i.test(key));
    const looksNext = rel.includes("next") || /\bnext\b|older|more/i.test(`${text} ${label}`) || hasPageParam;
    if (!samePath && !hasPageParam && !/\/page\/\d+/i.test(parsed.pathname)) continue;
    if (!looksNext) continue;

    urls.add(canonicalizeUrl(absoluteUrl));
  }

  return [...urls];
}

export function parseMoney(input) {
  if (input == null) return null;
  let raw = decodeHtml(String(input)).replace(/[^\d.,-]/g, "").trim();
  if (!raw) return null;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  if (lastComma > lastDot) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else {
    raw = raw.replace(/,/g, "");
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function extractPrices(input) {
  const text = decodeHtml(String(input || ""));
  const prices = [];
  let match;

  MONEY_RE.lastIndex = 0;
  while ((match = MONEY_RE.exec(text)) !== null) {
    const value = parseMoney(match[1]);
    if (value == null || value < 2 || value > 1500) continue;
    prices.push({
      value,
      text: match[0].replace(/&euro;/gi, "\u20ac").replace(/\s+/g, " ").trim(),
      index: match.index,
      context: text.slice(Math.max(0, match.index - 60), Math.min(text.length, match.index + 80))
    });
  }

  return prices;
}

function chooseBestProductCandidate(candidates) {
  const usable = candidates
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      price: candidate.price == null ? null : parseMoney(candidate.price)
    }))
    .filter((candidate) => candidate.name || candidate.price != null);

  usable.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  return usable[0] || null;
}

function scoreCandidate(candidate) {
  let score = candidate.confidence || 0;
  if (candidate.name) score += 1;
  if (candidate.price != null) score += 2;
  if (candidate.image) score += 0.2;
  if (candidate.source === "json-ld") score += 1;
  if (candidate.source === "meta") score += 0.8;
  if (candidate.source === "embedded-json") score += 0.5;
  return score;
}

function extractJsonLdCandidates(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const candidates = [];

  for (const [, attrText, body] of scripts) {
    const attrs = parseAttributes(attrText);
    const type = String(attrs.type || "").toLowerCase();
    const id = String(attrs.id || "").toLowerCase();
    if (!type.includes("ld+json") && id !== "json-ld") continue;

    const parsed = safeJsonParse(decodeHtml(stripHtmlComments(body)));
    if (!parsed) continue;

    for (const product of collectTypedNodes(parsed, "product")) {
      const offer = collectBestOffer(product.offers);
      candidates.push({
        source: "json-ld",
        confidence: 0.96,
        name: firstString(product.name, product.headline),
        brand: extractBrand(product.brand),
        price: offer.price,
        priceText: offer.priceText,
        currency: offer.currency || firstString(product.priceCurrency),
        image: firstImage(product.image)
      });
    }
  }

  return candidates;
}

function extractEmbeddedJsonCandidates(html) {
  const candidates = [];
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

  for (const [, attrText, body] of scripts) {
    const attrs = parseAttributes(attrText);
    const type = String(attrs.type || "").toLowerCase();
    const id = String(attrs.id || "").toLowerCase();
    if (id !== "__next_data__" && !type.includes("json")) continue;
    if (type.includes("ld+json")) continue;

    const parsed = safeJsonParse(decodeHtml(stripHtmlComments(body)));
    if (!parsed) continue;
    collectLooseProductCandidates(parsed, candidates);
    if (candidates.length > 20) break;
  }

  return candidates.slice(0, 20);
}

function extractMetaCandidate(html) {
  const metas = {};
  for (const match of html.matchAll(/<meta\b([^>]+)>/gi)) {
    const attrs = parseAttributes(match[1]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (!key || !attrs.content) continue;
    if (!(key in metas)) metas[key] = decodeHtml(attrs.content);
  }

  const priceText = firstString(
    metas["product:price:amount"],
    metas["og:price:amount"],
    metas["price"],
    metas["twitter:data1"],
    metas["product:sale_price:amount"]
  );
  const priceInfo = selectPrice(extractPrices(priceText || ""));
  const numericPrice = parseMoney(priceText);

  return {
    source: "meta",
    confidence: 0.86,
    name: firstString(metas["og:title"], metas["twitter:title"], metas.title),
    brand: firstString(metas["product:brand"], metas.brand),
    price: priceInfo?.value ?? numericPrice,
    priceText: priceInfo?.text || (numericPrice == null ? "" : formatEuro(numericPrice)),
    currency: firstString(metas["product:price:currency"], metas["og:price:currency"], metas.currency),
    image: firstString(metas["og:image"], metas["twitter:image"])
  };
}

function extractFallbackCandidate(html) {
  const h1 = firstTagText(html, "h1");
  const title = firstTagText(html, "title");
  const visibleText = stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
  const priceInfo = selectPrice(extractPrices(visibleText.slice(0, 220000)));

  return {
    source: "fallback",
    confidence: 0.38,
    name: h1 || title,
    price: priceInfo?.value ?? null,
    priceText: priceInfo?.text || "",
    currency: inferCurrency(priceInfo?.text)
  };
}

function collectBestOffer(offers) {
  const allOffers = collectTypedNodes(offers, "offer").concat(collectTypedNodes(offers, "aggregateoffer"));
  if (!allOffers.length && offers && typeof offers === "object") allOffers.push(...asArray(offers));

  const pricedOffers = allOffers
    .map((offer) => {
      const price = firstValue(
        offer?.price,
        offer?.lowPrice,
        offer?.highPrice,
        offer?.salePrice,
        offer?.priceSpecification?.price,
        offer?.priceSpecification?.minPrice
      );
      const parsedPrice = parseMoney(price);
      return {
        price: parsedPrice,
        priceText: parsedPrice == null ? "" : formatEuro(parsedPrice),
        currency: firstString(offer?.priceCurrency, offer?.priceSpecification?.priceCurrency)
      };
    })
    .filter((offer) => offer.price != null);

  pricedOffers.sort((a, b) => a.price - b.price);
  return pricedOffers[0] || {};
}

function collectTypedNodes(value, typeName, output = []) {
  if (value == null) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectTypedNodes(item, typeName, output);
    return output;
  }
  if (typeof value !== "object") return output;

  if (hasSchemaType(value, typeName)) {
    output.push(value);
  }

  if (value["@graph"]) collectTypedNodes(value["@graph"], typeName, output);
  if (value.itemListElement) collectTypedNodes(value.itemListElement, typeName, output);
  return output;
}

function collectLooseProductCandidates(value, output, depth = 0) {
  if (depth > 9 || value == null || output.length > 80) return;

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 300)) collectLooseProductCandidates(item, output, depth + 1);
    return;
  }

  if (typeof value !== "object") return;

  const name = firstString(value.name, value.productName, value.title, value.displayName);
  const brand = extractBrand(value.brand || value.brandName);
  const price = firstValue(
    value.price,
    value.currentPrice,
    value.salePrice,
    value.listPrice,
    value.priceValue,
    value?.pricing?.price,
    value?.pricing?.current,
    value?.offers?.price
  );
  const parsedPrice = parseMoney(price);

  if (name && parsedPrice != null && PRODUCT_PATH_RE.test(`${name} ${value.url || ""}`)) {
    output.push({
      source: "embedded-json",
      confidence: 0.76,
      name,
      brand,
      price: parsedPrice,
      priceText: formatEuro(parsedPrice),
      currency: firstString(value.currency, value.priceCurrency, value?.offers?.priceCurrency),
      image: firstImage(value.image || value.images)
    });
  }

  for (const item of Object.values(value).slice(0, 120)) {
    collectLooseProductCandidates(item, output, depth + 1);
  }
}

function selectPrice(prices) {
  if (!prices.length) return null;

  const saleContext = prices.some((price) => /\b(old|regular|was|worth|save|special)\b/i.test(price.context));
  if (saleContext) {
    return prices.slice().sort((a, b) => a.value - b.value)[0];
  }

  const nowSale = prices.find((price) => /\b(now|sale|special|club|was\s+\S+\s+now)\b/i.test(price.context));
  if (nowSale) return nowSale;

  const nearPriceLabel = prices.find((price) => /\b(price|eur|sale)\b/i.test(price.context));
  if (nearPriceLabel) return nearPriceLabel;

  return prices[0];
}

function extractFinalPriceFromContext(context) {
  const finalPriceMatch = String(context || "").match(/data-price-amount=["']([^"']+)["'][^>]{0,160}data-price-type=["']finalPrice["']|data-price-type=["']finalPrice["'][^>]{0,160}data-price-amount=["']([^"']+)["']/i);
  if (finalPriceMatch) return parseMoney(finalPriceMatch[1] || finalPriceMatch[2]);

  const itempropPriceMatch = String(context || "").match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
  if (itempropPriceMatch) return parseMoney(itempropPriceMatch[1]);

  return null;
}

function looksLikeProductUrl(url, site) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const path = decodeURIComponent(parsed.pathname).toLowerCase();
  const lastSegment = path.split("/").filter(Boolean).pop() || "";
  if (site?.key === "the-perfume-shop-ie") return path.includes("/p/");
  if (/\/(account|basket|cart|checkout|search|brands|vitamins)\b/i.test(path)) return false;
  if (path.startsWith("/beauty/") && !path.includes("/fragrance/")) return false;
  if (/^(fragrances?|mens-fragrances?|womens-fragrances?|aftershaves?|cologne|perfume|beauty|men|mens)$/i.test(lastSegment)) {
    return false;
  }
  if (path.endsWith("/")) return PRODUCT_PATH_RE.test(path) && !path.includes("/c/");
  if (path.includes("/c/") || path.includes("/category/") || path.includes("/collections/")) return false;
  if (path.includes("search") || path.includes("account") || path.includes("basket")) return false;
  return PRODUCT_PATH_RE.test(path) || /\/p\/|\/product\/|\/products\//i.test(path);
}

function extractStructuredListingCandidates(html, inputUrl, site) {
  return [
    ...extractShopifyVariantCandidates(html, inputUrl, site),
    ...extractSquarespaceCandidates(html, inputUrl, site)
  ];
}

function extractShopifyVariantCandidates(html, inputUrl, site) {
  const text = decodeScriptishJson(html);
  const candidates = [];
  const variantRe = /"price"\s*:\s*\{\s*"amount"\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*"currencyCode"\s*:\s*"([A-Z]{3})"\s*\}\s*,\s*"product"\s*:\s*\{([\s\S]{0,1600}?)\}\s*,\s*"id"\s*:\s*"([^"]+)"([\s\S]{0,700}?)(?=\},\s*\{|\}\]|\},)/g;
  let match;

  while ((match = variantRe.exec(text)) !== null) {
    const price = parseMoney(match[1]);
    const productBlock = match[3];
    const tail = match[5] || "";
    const title = firstString(
      extractJsonString(productBlock, "title"),
      extractJsonString(productBlock, "untranslatedTitle")
    );
    const vendor = firstString(extractJsonString(productBlock, "vendor"));
    const productUrl = extractJsonString(productBlock, "url");
    const variantTitle = firstString(extractJsonString(tail, "title"), extractJsonString(tail, "untranslatedTitle"));
    const image = firstString(extractJsonString(tail, "src"), extractJsonString(productBlock, "src"));

    if (!title || !productUrl || price == null || price < 2) continue;
    if (!PRODUCT_PATH_RE.test(`${title} ${productUrl}`)) continue;

    const url = new URL(productUrl, inputUrl);
    if (match[4]) url.searchParams.set("variant", match[4]);

    candidates.push({
      url: canonicalizeUrl(url.toString()),
      siteKey: site?.key || "",
      siteName: site?.name || "",
      name: cleanProductName(withVariantSize(title, variantTitle), site),
      brand: cleanProductName(vendor, site),
      price,
      priceText: formatEuro(price),
      currency: match[2] || "EUR",
      image: absolutizeUrl(image, inputUrl),
      source: "embedded-shopify",
      confidence: 0.84
    });
  }

  return dedupeCandidates(candidates);
}

function extractSquarespaceCandidates(html, inputUrl, site) {
  const text = decodeHtml(html);
  const context = extractAssignedJson(text, "Static.SQUARESPACE_CONTEXT");
  if (context) {
    const objects = [];
    collectSquarespaceProductObjects(context, objects);
    const candidates = squarespaceObjectsToCandidates(objects, inputUrl, site);
    if (candidates.length) return candidates;
  }

  const itemArrays = extractAssignedArrays(text, "\"items\"");
  for (const itemArray of itemArrays) {
    const objects = [];
    collectSquarespaceProductObjects(itemArray, objects);
    const candidates = squarespaceObjectsToCandidates(objects, inputUrl, site);
    if (candidates.length) return candidates;
  }

  const fallbackText = decodeScriptishJson(html);
  const candidates = [];
  const itemRe = /"title"\s*:\s*"([^"]+)"[\s\S]{0,3500}?"fromPrice"\s*:\s*\{\s*"currency"\s*:\s*"([A-Z]{3})"\s*,\s*"value"\s*:\s*"([^"]+)"\s*\}[\s\S]{0,16000}?"fullUrl"\s*:\s*"([^"]+)"/g;
  let match;

  while ((match = itemRe.exec(fallbackText)) !== null) {
    const price = parseMoney(match[3]);
    const title = cleanProductName(match[1], site);
    const url = absolutizeUrl(match[4], inputUrl);
    if (!title || !url || price == null || price < 2) continue;
    if (!PRODUCT_PATH_RE.test(`${title} ${url}`)) continue;

    candidates.push({
      url: canonicalizeUrl(url),
      siteKey: site?.key || "",
      siteName: site?.name || "",
      name: title,
      price,
      priceText: formatEuro(price),
      currency: match[2] || "EUR",
      source: "embedded-squarespace",
      confidence: 0.82
    });
  }

  return dedupeCandidates(candidates);
}

function squarespaceObjectsToCandidates(objects, inputUrl, site) {
  return dedupeCandidates(objects.map((item) => {
    const variant = item.firstInStockVariant || asArray(item.variants).find((entry) => !entry.soldOut) || asArray(item.variants)[0] || {};
    const price = parseMoney(variant?.price?.value || item?.fromPrice?.value);
    const currency = variant?.price?.currency || item?.fromPrice?.currency || "EUR";
    const variantSize = variant?.attributes?.Size || "";
    return {
      url: canonicalizeUrl(absolutizeUrl(item.fullUrl, inputUrl)),
      siteKey: site?.key || "",
      siteName: site?.name || "",
      name: cleanProductName(withVariantSize(item.title, variantSize), site),
      price,
      priceText: price == null ? "" : formatEuro(price),
      currency,
      image: firstImage(item.assetUrl || item.assets),
      source: "embedded-squarespace",
      confidence: 0.88
    };
  }).filter((item) => item.name && item.url && item.price != null && PRODUCT_PATH_RE.test(`${item.name} ${item.url}`)));
}

function extractAssignedJson(text, assignmentName) {
  const marker = `${assignmentName} =`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const braceStart = text.indexOf("{", start + marker.length);
  if (braceStart < 0) return null;
  const json = extractBalancedJsonObject(text, braceStart);
  return safeJsonParse(json);
}

function extractAssignedArrays(text, propertyName) {
  const arrays = [];
  let offset = 0;

  while (offset < text.length) {
    const keyIndex = text.indexOf(propertyName, offset);
    if (keyIndex < 0) break;
    const colonIndex = text.indexOf(":", keyIndex + propertyName.length);
    const arrayStart = text.indexOf("[", colonIndex);
    if (colonIndex < 0 || arrayStart < 0 || arrayStart - colonIndex > 8) {
      offset = keyIndex + propertyName.length;
      continue;
    }

    const arrayText = extractBalancedJsonArray(text, arrayStart);
    const parsed = safeJsonParse(arrayText);
    if (parsed) arrays.push(parsed);
    offset = arrayStart + Math.max(arrayText.length, 1);
  }

  return arrays;
}

function extractBalancedJsonObject(text, startIndex) {
  return extractBalancedJson(text, startIndex, "{", "}");
}

function extractBalancedJsonArray(text, startIndex) {
  return extractBalancedJson(text, startIndex, "[", "]");
}

function extractBalancedJson(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }

  return "";
}

function collectSquarespaceProductObjects(value, output, depth = 0) {
  if (depth > 10 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectSquarespaceProductObjects(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  if (value.title && value.fullUrl && (value.fromPrice || value.variants)) {
    output.push(value);
  }

  for (const item of Object.values(value).slice(0, 200)) {
    collectSquarespaceProductObjects(item, output, depth + 1);
  }
}

function addDiscoveryResult(results, candidate) {
  if (!candidate?.url || candidate.price == null) return;
  const key = `${candidate.url}|${candidate.name}|${candidate.price}`;
  results.set(key, mergeDiscoveryCandidate(results.get(key), candidate));
}

function hasDiscoveryUrl(results, url) {
  for (const item of results.values()) {
    if (item.url === url) return true;
  }
  return false;
}

function getListingContext(html, startIndex, endIndex, site) {
  if (site?.key === "the-perfume-shop-ie") {
    const start = html.lastIndexOf("<e2-product-tile", startIndex);
    const end = html.indexOf("</e2-product-tile>", endIndex);
    if (start >= 0 && end > startIndex) return html.slice(start, end + "</e2-product-tile>".length);
  }

  if (site?.key === "mccauley") {
    const start = html.lastIndexOf("<li", startIndex);
    const end = html.indexOf("</li>", endIndex);
    if (start >= 0 && end > startIndex) return html.slice(start, end + "</li>".length);
  }

  return html.slice(Math.max(0, startIndex - 800), Math.min(html.length, endIndex + 1200));
}

function inferDiscoveryName(attrs, innerHtml, context, absoluteUrl, site) {
  const dataName = firstString(attrs["data-name"], attrs["aria-label"]);
  if (dataName) return dataName;

  if (site?.key === "the-perfume-shop-ie") {
    const productParts = [
      textByClass(context, "product-list-item__brand"),
      textByClass(context, "product-list-item__range"),
      textByClass(context, "product-list-item__name")
    ].filter(Boolean);
    if (productParts.length) return productParts.join(" ");
  }

  const imageAlt = imageAltText(innerHtml);
  if (imageAlt) return imageAlt;

  const anchorText = stripTags(innerHtml);
  if (isUsefulDiscoveryName(anchorText)) return anchorText;
  return nameFromUrl(absoluteUrl);
}

function mergeDiscoveryCandidate(existing, candidate) {
  if (!existing) return candidate;
  return {
    ...existing,
    name: isUsefulDiscoveryName(existing.name) ? existing.name : candidate.name,
    brand: existing.brand || candidate.brand || "",
    price: existing.price ?? candidate.price,
    priceText: existing.priceText || candidate.priceText,
    currency: existing.currency || candidate.currency,
    listPrice: existing.listPrice ?? candidate.listPrice ?? null,
    discountPct: existing.discountPct ?? candidate.discountPct ?? null,
    image: existing.image || candidate.image || "",
    confidence: Math.max(existing.confidence || 0, candidate.confidence || 0)
  };
}

function textByClass(html, className) {
  const escaped = escapeRegExp(className);
  const re = new RegExp(`<[^>]*class=["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = html.match(re);
  return match ? stripTags(match[1]) : "";
}

function imageAltText(html) {
  const img = String(html || "").match(/<img\b([^>]*)>/i);
  if (!img) return "";
  const attrs = parseAttributes(img[1]);
  return firstString(attrs.alt, attrs.title);
}

function extractListingImage(anchorAttrs, innerHtml, context, inputUrl) {
  const rawImage = firstString(
    anchorAttrs["data-image"],
    anchorAttrs["data-img"],
    anchorAttrs["data-src"],
    anchorAttrs.src,
    imageSrc(innerHtml),
    imageSrc(context)
  );
  return absolutizeUrl(rawImage, inputUrl);
}

function imageSrc(html) {
  const imageCandidates = [];

  for (const match of String(html || "").matchAll(/<(?:img|source)\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[1]);
    imageCandidates.push(
      attrs["data-src"],
      attrs["data-original"],
      attrs["data-lazy"],
      attrs["data-image"],
      srcFromSrcset(attrs["data-srcset"] || attrs.srcset),
      attrs.src
    );
  }

  return firstUsableImage(...imageCandidates);
}

function srcFromSrcset(srcset) {
  const candidates = String(srcset || "")
    .split(",")
    .map((item) => {
      const [url, descriptor] = item.trim().split(/\s+/, 2);
      const width = Number.parseInt(String(descriptor || "").replace(/[^\d]/g, ""), 10);
      return { url, width: Number.isFinite(width) ? width : 0 };
    })
    .filter((item) => item.url);

  candidates.sort((a, b) => b.width - a.width);
  return candidates[0]?.url || "";
}

function firstUsableImage(...values) {
  for (const value of values) {
    const image = String(value || "").trim();
    if (!image) continue;
    if (/^(data:|blob:|#)/i.test(image)) continue;
    if (/\b(?:logo|placeholder|spacer|loading)\b/i.test(image)) continue;
    return image;
  }
  return "";
}

function isUsefulDiscoveryName(value) {
  const text = stripTags(value);
  if (text.length < 12) return false;
  if (/^(save|out of stock|quick view|view details|shop\b)/i.test(text)) return false;
  if (/^[A-Z0-9]{6,}$/.test(text)) return false;
  return true;
}

function nameFromUrl(inputUrl) {
  const parsed = new URL(inputUrl);
  const segments = decodeURIComponent(parsed.pathname).split("/").filter(Boolean);
  const productMarker = segments.indexOf("p");
  const slug = productMarker > 0
    ? segments.slice(0, productMarker).filter((segment) => segment !== "ie").join("-")
    : segments.at(-1) || "";

  return slug
    .replace(/\.(html?|aspx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function inferListPrice(context, currentPrice) {
  if (!/\b(old-price|oldPrice|regular price|was|worth|save|special price)\b/i.test(String(context || ""))) {
    return null;
  }

  const prices = extractPrices(context)
    .map((item) => item.value)
    .filter((value) => value != null && value >= currentPrice);
  const highest = prices.length ? Math.max(...prices) : null;
  if (highest == null || highest <= currentPrice) return null;
  return highest;
}

function calculateDiscountPct(currentPrice, listPrice) {
  if (currentPrice == null || listPrice == null || listPrice <= currentPrice) return null;
  return Math.round(((listPrice - currentPrice) / listPrice) * 1000) / 10;
}

function decodeScriptishJson(input) {
  return decodeHtml(input)
    .replace(/\\"/g, "\"")
    .replace(/\\\//g, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u002D/gi, "-")
    .replace(/\\u0026/gi, "&");
}

function extractJsonString(block, key) {
  const re = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
  const match = String(block || "").match(re);
  return match ? decodeJsonString(match[1]) : "";
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${String(value || "").replace(/"/g, "\\\"")}"`);
  } catch {
    return String(value || "")
      .replace(/\\"/g, "\"")
      .replace(/\\\//g, "/")
      .replace(/\\n/g, " ")
      .trim();
  }
}

function withVariantSize(title, variantTitle) {
  const cleanVariant = String(variantTitle || "").trim();
  if (!cleanVariant || /^default title$/i.test(cleanVariant)) return title;
  if (/\b\d+(?:\.\d+)?\s*ml\b/i.test(title)) return title;
  if (!/\b\d+(?:\.\d+)?\s*ml\b/i.test(cleanVariant)) return title;
  return `${title} ${cleanVariant}`;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const deduped = [];
  for (const candidate of candidates) {
    const key = `${candidate.url}|${candidate.name}|${candidate.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function cleanProductName(input, site) {
  const name = decodeHtml(String(input || ""))
    .replace(/\s+/g, " ")
    .replace(/\s+\|\s+.*$/i, "")
    .trim();

  if (!name) return "";
  if (!site?.name) return name;
  return name.replace(new RegExp(`\\s+[-|]\\s+${escapeRegExp(site.name)}.*$`, "i"), "").trim();
}

function firstTagText(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = html.match(re);
  return match ? stripTags(match[1]) : "";
}

function parseAttributes(input) {
  const attrs = {};
  const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;

  while ((match = attrRe.exec(input || "")) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[match[1].toLowerCase()] = decodeHtml(value);
  }

  return attrs;
}

function stripTags(input) {
  return decodeHtml(String(input || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(input) {
  return String(input || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&euro;/gi, "\u20ac");
}

function stripHtmlComments(input) {
  return String(input || "").replace(/<!--|-->/g, "").trim();
}

function safeJsonParse(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[\[{]/);
    const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function hasSchemaType(value, typeName) {
  const actual = value?.["@type"];
  return asArray(actual).some((item) => String(item).toLowerCase() === typeName.toLowerCase());
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstValue(...values) {
  for (const value of values) {
    if (value != null && value !== "") return value;
  }
  return null;
}

function extractBrand(brand) {
  if (typeof brand === "string") return brand;
  if (brand && typeof brand === "object") return firstString(brand.name, brand.brandName);
  return "";
}

function firstImage(image) {
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return firstImage(image[0]);
  if (image && typeof image === "object") return firstString(image.url, image.src, image.contentUrl);
  return "";
}

function inferCurrency(text) {
  if (!text) return "";
  if (/\u20ac|&euro;|EUR/i.test(text)) return "EUR";
  return "";
}

function formatEuro(value) {
  return `\u20ac${Number(value).toFixed(2)}`;
}

function absolutizeUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return "";
  }
}

function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
