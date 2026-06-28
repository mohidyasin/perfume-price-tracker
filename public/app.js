const state = {
  catalog: null,
  priceHistory: null,
  staticMode: false,
  selectedProductKey: "",
  catalogSearch: "",
  filters: {
    audience: "",
    brand: "",
    size: "",
    type: ""
  }
};

const elements = {
  message: document.querySelector("#message"),
  catalogScanBtn: document.querySelector("#catalogScanBtn"),
  catalogSites: document.querySelector("#catalogSites"),
  catalogProducts: document.querySelector("#catalogProducts"),
  catalogOffers: document.querySelector("#catalogOffers"),
  catalogGaps: document.querySelector("#catalogGaps"),
  catalogSearch: document.querySelector("#catalogSearch"),
  genderFilter: document.querySelector("#genderFilter"),
  brandFilter: document.querySelector("#brandFilter"),
  sizeFilter: document.querySelector("#sizeFilter"),
  typeFilter: document.querySelector("#typeFilter"),
  clearFiltersBtn: document.querySelector("#clearFiltersBtn"),
  catalogResultCount: document.querySelector("#catalogResultCount"),
  perfumeList: document.querySelector("#perfumeList"),
  retailerPrices: document.querySelector("#retailerPrices"),
  selectedPerfumeTitle: document.querySelector("#selectedPerfumeTitle")
};

await init();

async function init() {
  wireEvents();
  await loadCatalog();
  await loadPriceHistory();
  renderSelectedPerfume();
}

function wireEvents() {
  elements.catalogScanBtn.addEventListener("click", async () => {
    if (state.staticMode) {
      showMessage("This hosted version updates from the daily GitHub Actions scrape. Run the workflow manually in GitHub Actions to refresh now.", "success");
      return;
    }

    await runWithButton(elements.catalogScanBtn, async () => {
      showMessage("Scanning Irish fragrance retailers. This can take a minute.", "success");
      const report = await api("/api/catalog/scrape", {
        method: "POST",
        body: {
          siteLimit: 14,
          maxPagesPerSite: 6,
          maxItemsPerPage: 80,
          includeStorefronts: false
        }
      });
      renderCatalog(report);
      await loadPriceHistory();
      showMessage(`Scanned ${report.summary.sitesSucceeded} retailers and consolidated ${report.summary.consolidatedPerfumes} perfumes.`, "success");
    });
  });

  elements.catalogSearch.addEventListener("input", () => {
    state.catalogSearch = elements.catalogSearch.value.trim().toLowerCase();
    applyCatalogFilters();
  });

  elements.genderFilter.addEventListener("change", () => {
    state.filters.audience = elements.genderFilter.value;
    applyCatalogFilters();
  });

  elements.brandFilter.addEventListener("change", () => {
    state.filters.brand = elements.brandFilter.value;
    applyCatalogFilters();
  });

  elements.sizeFilter.addEventListener("change", () => {
    state.filters.size = elements.sizeFilter.value;
    applyCatalogFilters();
  });

  elements.typeFilter.addEventListener("change", () => {
    state.filters.type = elements.typeFilter.value;
    applyCatalogFilters();
  });

  elements.clearFiltersBtn.addEventListener("click", () => {
    state.catalogSearch = "";
    state.filters = { audience: "", brand: "", size: "", type: "" };
    elements.catalogSearch.value = "";
    elements.genderFilter.value = "";
    elements.brandFilter.value = "";
    elements.sizeFilter.value = "";
    elements.typeFilter.value = "";
    applyCatalogFilters();
  });
}

async function loadCatalog() {
  let report;
  try {
    report = await api("/api/catalog");
    if (!Array.isArray(report.perfumes)) throw new Error("Catalog API did not return catalog data.");
    state.staticMode = false;
    elements.catalogScanBtn.disabled = false;
    elements.catalogScanBtn.textContent = "Scan retailers";
  } catch {
    report = await fetchStaticJson("data/catalog-latest.json");
    state.staticMode = true;
    elements.catalogScanBtn.disabled = false;
    elements.catalogScanBtn.textContent = "Updated daily";
  }
  renderCatalog(report);
}

async function loadPriceHistory() {
  try {
    state.priceHistory = await api("/api/history");
    if (!Array.isArray(state.priceHistory.products)) throw new Error("History API did not return history data.");
  } catch {
    state.priceHistory = await fetchStaticJson("data/price-history.json").catch(() => null);
  }
}

function renderCatalog(report) {
  state.catalog = report;
  const summary = report.summary || {};
  elements.catalogSites.textContent = summary.sitesSucceeded || 0;
  elements.catalogProducts.textContent = summary.consolidatedPerfumes || report.perfumes?.length || 0;
  elements.catalogOffers.textContent = summary.productsFound || 0;
  elements.catalogGaps.textContent = summary.comparableGroups || 0;

  renderCatalogFilterOptions();
  const visible = getVisiblePerfumes();
  if (!state.selectedProductKey || !visible.some((item) => item.productKey === state.selectedProductKey)) {
    state.selectedProductKey = visible[0]?.productKey || "";
  }
  renderPerfumeList();
  renderSelectedPerfume();
}

function getVisiblePerfumes() {
  const perfumes = state.catalog?.perfumes || [];
  return perfumes.filter((perfume) => {
    if (state.filters.audience && audienceFilterValue(perfume) !== state.filters.audience) return false;
    if (state.filters.brand && brandFilterValue(perfume) !== state.filters.brand) return false;
    if (state.filters.size && sizeFilterValue(perfume) !== state.filters.size) return false;
    if (state.filters.type && typeFilterValue(perfume) !== state.filters.type) return false;
    if (!state.catalogSearch) return true;

    const haystack = [
      perfume.title,
      perfume.brand,
      audienceFilterLabel(audienceFilterValue(perfume)),
      formatProductFormat(perfume.productFormat),
      perfume.productFormat,
      perfume.volumeMl ? `${perfume.volumeMl}ml` : "",
      ...perfume.offers.map((offer) => `${offer.siteName} ${offer.title}`)
    ].join(" ").toLowerCase();
    return haystack.includes(state.catalogSearch);
  });
}

function renderPerfumeList() {
  elements.perfumeList.replaceChildren();
  const perfumes = getVisiblePerfumes();
  elements.catalogResultCount.textContent = `(${perfumes.length})`;

  if (!perfumes.length) {
    elements.perfumeList.append(emptyRow(state.catalog ? "No perfumes match those filters." : "Run a scan to populate consolidated perfumes."));
    return;
  }

  for (const perfume of perfumes) {
    const button = document.createElement("button");
    button.className = `perfume-row${perfume.productKey === state.selectedProductKey ? " selected" : ""}`;
    button.type = "button";
    button.addEventListener("click", () => {
      state.selectedProductKey = perfume.productKey;
      renderPerfumeList();
      renderSelectedPerfume();
    });

    const thumb = createProductImage(perfume.image, perfume.title, "catalog-thumb");

    const body = document.createElement("div");
    body.className = "perfume-row-body";

    const title = document.createElement("strong");
    title.textContent = perfume.title;

    const meta = document.createElement("div");
    meta.className = "catalog-meta";
    meta.textContent = [
      audienceFilterLabel(audienceFilterValue(perfume)),
      perfume.brand || "Brand unknown",
      formatSize(perfume.volumeMl),
      formatProductFormat(perfume.productFormat),
      `${perfume.offerCount} retailer${perfume.offerCount === 1 ? "" : "s"}`
    ].join(" | ");

    const priceLine = document.createElement("div");
    priceLine.className = "perfume-price-line";
    priceLine.textContent = perfume.offerCount > 1
      ? `Best ${formatPrice(perfume.bestPrice, "EUR")} | range ${formatPrice(perfume.bestPrice, "EUR")} to ${formatPrice(perfume.highestPrice, "EUR")}`
      : `Only seen at ${formatPrice(perfume.bestPrice, "EUR")}`;

    body.append(title, meta, priceLine);
    button.append(thumb, body);
    elements.perfumeList.append(button);
  }
}

function renderSelectedPerfume() {
  elements.retailerPrices.replaceChildren();
  const perfume = (state.catalog?.perfumes || []).find((item) => item.productKey === state.selectedProductKey);

  if (!perfume) {
    elements.selectedPerfumeTitle.textContent = "Retailer Prices";
    elements.retailerPrices.append(emptyRow("Select a perfume to compare retailer prices."));
    return;
  }

  elements.selectedPerfumeTitle.textContent = perfume.title;

  const selectedHero = document.createElement("section");
  selectedHero.className = "selected-hero";

  const selectedImage = createProductImage(perfume.image, perfume.title, "selected-image");
  const selectedCopy = document.createElement("div");
  selectedCopy.className = "selected-copy";

  const selectedTitle = document.createElement("strong");
  selectedTitle.textContent = perfume.title;

  const selectedMeta = document.createElement("span");
  selectedMeta.textContent = [
    audienceFilterLabel(audienceFilterValue(perfume)),
    perfume.brand || "Brand unknown",
    formatSize(perfume.volumeMl),
    formatProductFormat(perfume.productFormat),
    `${perfume.offerCount} offer${perfume.offerCount === 1 ? "" : "s"}`
  ].join(" | ");

  selectedCopy.append(selectedTitle, selectedMeta);
  selectedHero.append(selectedImage, selectedCopy);
  elements.retailerPrices.append(selectedHero);

  const identity = document.createElement("section");
  identity.className = "identity-strip";
  for (const value of [audienceFilterLabel(audienceFilterValue(perfume)), perfume.brand || "Brand unknown", formatSize(perfume.volumeMl), formatProductFormat(perfume.productFormat)]) {
    const pill = document.createElement("span");
    pill.textContent = value;
    identity.append(pill);
  }
  elements.retailerPrices.append(identity);

  const summary = document.createElement("section");
  summary.className = "selected-summary";
  summary.innerHTML = `
    <div><span>Best</span><strong>${formatPrice(perfume.bestPrice, "EUR")}</strong></div>
    <div><span>Highest</span><strong>${formatPrice(perfume.highestPrice, "EUR")}</strong></div>
    <div><span>Gap</span><strong>${perfume.spread ? `${formatPrice(perfume.spread, "EUR")} (${perfume.spreadPct}%)` : "-"}</strong></div>
  `;
  elements.retailerPrices.append(summary);

  elements.retailerPrices.append(createHistoryPanel(perfume));

  const table = document.createElement("div");
  table.className = "price-table";
  const header = document.createElement("div");
  header.className = "price-table-row header";
  header.innerHTML = "<span>Retailer</span><span>Price</span><span>Per 100ml</span><span>Source</span>";
  table.append(header);

  for (const offer of perfume.offers) {
    const row = document.createElement("div");
    row.className = `price-table-row${offer.isBestPrice ? " best" : ""}`;

    const retailer = document.createElement("div");
    retailer.className = "retailer-cell";
    const offerThumb = createProductImage(offer.image || perfume.image, offer.title || perfume.title, "offer-thumb");
    const retailerText = document.createElement("div");
    retailerText.className = "retailer-text";
    const site = document.createElement("strong");
    site.textContent = offer.siteName;
    const title = document.createElement("span");
    title.textContent = offer.title;
    retailerText.append(site, title);
    retailer.append(offerThumb, retailerText);

    const price = document.createElement("strong");
    price.textContent = formatPrice(offer.price, offer.currency);

    const per100 = document.createElement("span");
    per100.textContent = offer.pricePer100ml ? formatPrice(offer.pricePer100ml, offer.currency) : "-";

    const source = document.createElement("span");
    source.textContent = `${formatSource(offer.source)} | ${Math.round((offer.confidence || 0) * 100)}%`;

    row.append(retailer, price, per100, source);
    table.append(row);
  }

  elements.retailerPrices.append(table);
}

function createHistoryPanel(perfume) {
  const panel = document.createElement("section");
  panel.className = "history-panel";

  const heading = document.createElement("div");
  heading.className = "history-heading";
  const title = document.createElement("strong");
  title.textContent = "Price history";
  const meta = document.createElement("span");
  const history = getHistoryForPerfume(perfume);
  const dates = historyDates(history);
  meta.textContent = dates.length > 1
    ? `${dates.length} tracked days`
    : dates.length === 1
      ? "1 tracked day"
      : "Waiting for daily scrape data";
  heading.append(title, meta);
  panel.append(heading);

  if (!history.retailers.length) {
    panel.append(emptyRow("Price history will appear after the first daily scrape."));
    return panel;
  }

  panel.append(createPriceChart(history.retailers, dates));
  panel.append(createHistoryLegend(history.retailers));
  return panel;
}

function getHistoryForPerfume(perfume) {
  const tracked = (state.priceHistory?.products || []).find((product) => product.productKey === perfume.productKey);
  if (tracked?.retailers?.some((retailer) => retailer.points?.length)) return tracked;

  const fallbackDate = String(state.catalog?.finishedAt || new Date().toISOString()).slice(0, 10);
  return {
    productKey: perfume.productKey,
    title: perfume.title,
    retailers: (perfume.offers || []).map((offer) => ({
      siteKey: offer.siteKey,
      siteName: offer.siteName,
      points: [{
        date: fallbackDate,
        price: offer.price,
        priceText: offer.priceText,
        pricePer100ml: offer.pricePer100ml,
        title: offer.title,
        productUrl: offer.productUrl || ""
      }]
    }))
  };
}

function historyDates(history) {
  return [...new Set(
    (history.retailers || [])
      .flatMap((retailer) => retailer.points || [])
      .map((point) => point.date)
      .filter(Boolean)
  )].sort();
}

function createPriceChart(retailers, dates) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const width = 720;
  const height = 260;
  const padding = { top: 20, right: 18, bottom: 38, left: 58 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const allPoints = retailers.flatMap((retailer) => retailer.points || []).filter((point) => point.price != null);
  const prices = allPoints.map((point) => Number(point.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pricePadding = Math.max(1, (maxPrice - minPrice) * 0.12);
  const yMin = Math.max(0, minPrice - pricePadding);
  const yMax = maxPrice + pricePadding;

  svg.setAttribute("class", "history-chart");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Perfume price history by retailer");

  for (const tick of priceTicks(yMin, yMax)) {
    const y = scalePrice(tick, yMin, yMax, padding.top, chartHeight);
    svg.append(svgLine(padding.left, y, width - padding.right, y, "chart-grid"));
    svg.append(svgText(8, y + 4, formatPrice(tick, "EUR"), "chart-axis-label"));
  }

  svg.append(svgLine(padding.left, padding.top, padding.left, height - padding.bottom, "chart-axis"));
  svg.append(svgLine(padding.left, height - padding.bottom, width - padding.right, height - padding.bottom, "chart-axis"));

  const dateLabels = dates.length <= 2 ? dates : [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]];
  for (const date of dateLabels) {
    const x = scaleDate(date, dates, padding.left, chartWidth);
    svg.append(svgText(x, height - 12, formatShortDate(date), "chart-date-label"));
  }

  retailers
    .filter((retailer) => retailer.points?.length)
    .forEach((retailer, index) => {
      const points = retailer.points
        .filter((point) => point.price != null && dates.includes(point.date))
        .sort((a, b) => a.date.localeCompare(b.date));
      const color = chartColor(index);
      const coordinates = points.map((point) => [
        scaleDate(point.date, dates, padding.left, chartWidth),
        scalePrice(point.price, yMin, yMax, padding.top, chartHeight)
      ]);

      if (coordinates.length > 1) {
        const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        polyline.setAttribute("points", coordinates.map(([x, y]) => `${x},${y}`).join(" "));
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", color);
        polyline.setAttribute("stroke-width", "3");
        polyline.setAttribute("stroke-linecap", "round");
        polyline.setAttribute("stroke-linejoin", "round");
        svg.append(polyline);
      }

      points.forEach((point, pointIndex) => {
        const [x, y] = coordinates[pointIndex];
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
        circle.setAttribute("r", "5");
        circle.setAttribute("fill", color);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "title");
        label.textContent = `${retailer.siteName}: ${formatPrice(point.price, "EUR")} on ${formatShortDate(point.date)}`;
        circle.append(label);
        svg.append(circle);
      });
    });

  return svg;
}

function createHistoryLegend(retailers) {
  const legend = document.createElement("div");
  legend.className = "history-legend";

  retailers
    .filter((retailer) => retailer.points?.length)
    .forEach((retailer, index) => {
      const latest = retailer.points[retailer.points.length - 1];
      const item = document.createElement("div");
      item.className = "history-legend-item";

      const swatch = document.createElement("span");
      swatch.className = "history-swatch";
      swatch.style.background = chartColor(index);

      const copy = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = retailer.siteName;
      const detail = document.createElement("span");
      detail.textContent = `${formatPrice(latest.price, "EUR")} on ${formatShortDate(latest.date)}`;
      copy.append(name, detail);

      item.append(swatch, copy);
      legend.append(item);
    });

  return legend;
}

function priceTicks(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  const ticks = [];
  const step = Math.max(1, Math.ceil((max - min) / 4));
  for (let index = 0; index <= 4; index += 1) {
    ticks.push(Math.round((min + step * index) * 100) / 100);
  }
  return ticks;
}

function scaleDate(date, dates, left, width) {
  if (dates.length <= 1) return left + width / 2;
  const index = Math.max(0, dates.indexOf(date));
  return left + (index / (dates.length - 1)) * width;
}

function scalePrice(price, min, max, top, height) {
  if (max <= min) return top + height / 2;
  return top + height - ((Number(price) - min) / (max - min)) * height;
}

function svgLine(x1, y1, x2, y2, className) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("class", className);
  return line;
}

function svgText(x, y, value, className) {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y));
  text.setAttribute("class", className);
  text.textContent = value;
  return text;
}

function chartColor(index) {
  return ["#13715b", "#346aa3", "#a77822", "#b14242", "#6f57a5", "#257c8a", "#7a5a2d"][index % 7];
}

function emptyRow(text) {
  const row = document.createElement("article");
  row.className = "catalog-row";
  row.textContent = text;
  return row;
}

function applyCatalogFilters() {
  const visible = getVisiblePerfumes();
  if (!visible.some((item) => item.productKey === state.selectedProductKey)) {
    state.selectedProductKey = visible[0]?.productKey || "";
  }
  renderPerfumeList();
  renderSelectedPerfume();
}

function renderCatalogFilterOptions() {
  const perfumes = state.catalog?.perfumes || [];

  setSelectOptions(elements.genderFilter, [
    { value: "", label: "All genders" },
    ...countOptions(perfumes, audienceFilterValue, audienceFilterLabel)
      .sort((a, b) => audienceSortValue(a.value) - audienceSortValue(b.value) || a.label.localeCompare(b.label))
  ], state.filters.audience);

  setSelectOptions(elements.brandFilter, [
    { value: "", label: "All brands" },
    ...countOptions(perfumes, brandFilterValue, brandFilterLabel)
      .sort((a, b) => a.label.localeCompare(b.label))
  ], state.filters.brand);

  setSelectOptions(elements.sizeFilter, [
    { value: "", label: "All sizes" },
    ...countOptions(perfumes, sizeFilterValue, sizeFilterLabel)
      .sort((a, b) => sizeSortValue(a.value) - sizeSortValue(b.value))
  ], state.filters.size);

  setSelectOptions(elements.typeFilter, [
    { value: "", label: "All types" },
    ...countOptions(perfumes, typeFilterValue, typeFilterLabel)
      .sort((a, b) => typeSortValue(a.value) - typeSortValue(b.value) || a.label.localeCompare(b.label))
  ], state.filters.type);

  state.filters.audience = elements.genderFilter.value;
  state.filters.brand = elements.brandFilter.value;
  state.filters.size = elements.sizeFilter.value;
  state.filters.type = elements.typeFilter.value;
}

function setSelectOptions(select, options, selectedValue) {
  select.replaceChildren();
  const optionValues = new Set(options.map((option) => option.value));
  const valueToUse = optionValues.has(selectedValue) ? selectedValue : "";

  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    option.selected = optionData.value === valueToUse;
    select.append(option);
  }
}

function countOptions(items, valueFor, labelFor) {
  const counts = new Map();
  for (const item of items) {
    const value = valueFor(item);
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return [...counts.entries()].map(([value, count]) => ({
    value,
    label: `${labelFor(value)} (${count})`
  }));
}

function audienceFilterValue(perfume) {
  return perfume.audience || "unknown";
}

function audienceFilterLabel(value) {
  const labels = {
    men: "Men",
    women: "Women",
    unisex: "Unisex",
    unknown: "Gender unknown"
  };
  return labels[value] || "Gender unknown";
}

function audienceSortValue(value) {
  const order = ["men", "women", "unisex", "unknown"];
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function brandFilterValue(perfume) {
  return perfume.brand || "__unknown";
}

function brandFilterLabel(value) {
  return value === "__unknown" ? "Brand unknown" : value;
}

function sizeFilterValue(perfume) {
  return perfume.volumeMl ? String(perfume.volumeMl) : "__unknown";
}

function sizeFilterLabel(value) {
  return value === "__unknown" ? "Size unknown" : `${value}ml`;
}

function sizeSortValue(value) {
  return value === "__unknown" ? Number.MAX_SAFE_INTEGER : Number(value);
}

function typeFilterValue(perfume) {
  return perfume.productFormat || "format-unknown";
}

function typeFilterLabel(value) {
  return formatProductFormat(value);
}

function typeSortValue(value) {
  const order = [
    "eau-de-parfum",
    "eau-de-toilette",
    "parfum",
    "aftershave",
    "cologne",
    "gift-set",
    "deodorant",
    "body-spray",
    "format-unknown"
  ];
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function createProductImage(image, title, className) {
  const box = document.createElement("div");
  box.className = `product-picture ${className}${image ? "" : " missing"}`;

  if (image) {
    const img = document.createElement("img");
    img.src = image;
    img.alt = title ? `${title} bottle` : "Perfume bottle";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      box.classList.add("missing");
      box.replaceChildren(createImageInitials(title));
    });
    box.append(img);
    return box;
  }

  box.append(createImageInitials(title));
  return box;
}

function createImageInitials(title) {
  const fallback = document.createElement("span");
  fallback.textContent = initials(title);
  fallback.setAttribute("aria-hidden", "true");
  return fallback;
}

function initials(title) {
  const words = String(title || "Perfume")
    .replace(/[^a-z0-9\s]/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "PF";
}

async function runWithButton(button, task) {
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Working";
  }
  try {
    await task();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function fetchStaticJson(path) {
  const response = await fetch(new URL(path, document.baseURI), {
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Static data request failed with HTTP ${response.status}`);
  return response.json();
}

function showMessage(text, type = "success") {
  elements.message.textContent = text;
  elements.message.className = `message visible ${type}`;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    elements.message.className = "message";
  }, 7000);
}

function formatPrice(value, currency = "EUR") {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currency || "EUR"
  }).format(value);
}

function formatProductFormat(value) {
  const labels = {
    "eau-de-parfum": "EDP",
    "eau-de-toilette": "EDT",
    parfum: "Parfum",
    aftershave: "Aftershave",
    cologne: "Cologne",
    "gift-set": "Gift set",
    deodorant: "Deodorant",
    "body-spray": "Body spray",
    "format-unknown": "Type unknown"
  };
  return labels[value] || String(value || "Type unknown").replace(/-/g, " ");
}

function formatSize(value) {
  return value ? `${value}ml` : "size unknown";
}

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IE", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function formatSource(value) {
  return String(value || "scraped").replace(/^embedded-/, "").replace(/-/g, " ");
}
