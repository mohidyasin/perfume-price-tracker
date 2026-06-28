export const SITE_ALLOWLIST = [
  {
    key: "mccauley",
    name: "McCauley Pharmacy",
    homepage: "https://www.mccauley.ie/",
    hosts: ["mccauley.ie", "www.mccauley.ie"],
    irishBased: true,
    categoryUrls: ["https://www.mccauley.ie/fragrances/mens-fragrances"],
    notes: "Irish pharmacy retailer. Product pages expose price metadata."
  },
  {
    key: "hickeys",
    name: "Hickey's Pharmacy",
    homepage: "https://www.hickeyspharmacies.ie/",
    hosts: ["hickeyspharmacies.ie", "www.hickeyspharmacies.ie"],
    irishBased: true,
    categoryUrls: ["https://www.hickeyspharmacies.ie/toiletries/mens/fragrance"],
    notes: "Irish pharmacy retailer with a men's fragrance category."
  },
  {
    key: "allcare",
    name: "Allcare Pharmacy",
    homepage: "https://www.allcarepharmacy.ie/",
    hosts: ["allcarepharmacy.ie", "www.allcarepharmacy.ie"],
    irishBased: true,
    categoryUrls: ["https://www.allcarepharmacy.ie/fragrances/mens-fragrances"],
    notes: "Irish pharmacy retailer with fragrance offers and men's fragrances."
  },
  {
    key: "meaghers",
    name: "Meaghers Pharmacy",
    homepage: "https://www.meagherspharmacy.ie/",
    hosts: ["meagherspharmacy.ie", "www.meagherspharmacy.ie"],
    irishBased: true,
    categoryUrls: ["https://www.meagherspharmacy.ie/collections/mens-fragrance"],
    notes: "Irish pharmacy retailer; Shopify product data is normalized from collection output."
  },
  {
    key: "mccabes",
    name: "McCabes Pharmacy",
    homepage: "https://www.mccabespharmacy.com/",
    hosts: ["mccabespharmacy.com", "www.mccabespharmacy.com"],
    irishBased: true,
    categoryUrls: ["https://www.mccabespharmacy.com/collections/fragrance-offers-for-him"],
    notes: "Irish pharmacy retailer; Shopify collection data is normalized."
  },
  {
    key: "inish",
    name: "Inish Pharmacy",
    homepage: "https://www.inishpharmacy.com/",
    hosts: ["inishpharmacy.com", "www.inishpharmacy.com"],
    irishBased: true,
    categoryUrls: ["https://www.inishpharmacy.com/collections/fragrances-for-him"],
    notes: "Irish online pharmacy with men's fragrance collection pages."
  },
  {
    key: "cloud10",
    name: "Cloud 10 Beauty",
    homepage: "https://www.cloud10beauty.com/",
    hosts: ["cloud10beauty.com", "www.cloud10beauty.com"],
    irishBased: true,
    categoryUrls: ["https://www.cloud10beauty.com/collections/fragrance-for-him"],
    notes: "Irish beauty retailer with a fragrance-for-him collection."
  },
  {
    key: "leavys",
    name: "Leavys Pharmacy",
    homepage: "https://leavys.ie/",
    hosts: ["leavys.ie", "www.leavys.ie"],
    irishBased: true,
    categoryUrls: ["https://www.leavys.ie/category/fragrance-for-him"],
    notes: "Irish pharmacy retailer with a men's fragrance category."
  },
  {
    key: "healthplus",
    name: "HealthPlus Pharmacy",
    homepage: "https://healthplus.ie/",
    hosts: ["healthplus.ie", "www.healthplus.ie"],
    irishBased: true,
    categoryUrls: ["https://healthplus.ie/toiletries/mens-fragrances.html"],
    notes: "Irish pharmacy retailer using Magento-style category pages."
  },
  {
    key: "rochfords",
    name: "Rochfords Pharmacy",
    homepage: "https://www.rochfordspharmacy.ie/",
    hosts: ["rochfordspharmacy.ie", "www.rochfordspharmacy.ie"],
    irishBased: true,
    categoryUrls: ["https://www.rochfordspharmacy.ie/c/mens-fragrance/76"],
    notes: "Irish pharmacy and beauty retailer using /p/ product URLs."
  },
  {
    key: "university-pharmacy",
    name: "University Late Night Pharmacy",
    homepage: "https://www.universitypharmacy.ie/",
    hosts: ["universitypharmacy.ie", "www.universitypharmacy.ie"],
    irishBased: true,
    categoryUrls: ["https://www.universitypharmacy.ie/c/fragrance-for-him/73"],
    notes: "Irish Galway pharmacy with fragrance-for-him product pages."
  },
  {
    key: "always-there",
    name: "Always There Pharmacy",
    homepage: "https://www.alwaystherepharmacy.ie/",
    hosts: ["alwaystherepharmacy.ie", "www.alwaystherepharmacy.ie"],
    irishBased: true,
    categoryUrls: ["https://www.alwaystherepharmacy.ie/c/mens-fragrance/121"],
    notes: "Irish pharmacy with men's fragrance product pages."
  },
  {
    key: "stauntons",
    name: "Stauntons Pharmacy",
    homepage: "https://stauntonspharmacy.ie/",
    hosts: ["stauntonspharmacy.ie", "www.stauntonspharmacy.ie"],
    irishBased: true,
    categoryUrls: ["https://stauntonspharmacy.ie/fragrance-for-him"],
    notes: "Irish Life Pharmacy in Navan; Squarespace catalog output is normalized."
  },
  {
    key: "arnotts",
    name: "Arnotts",
    homepage: "https://www.arnotts.ie/",
    hosts: ["arnotts.ie", "www.arnotts.ie"],
    irishBased: true,
    categoryUrls: ["https://www.arnotts.ie/beauty/fragrance/mens-fragrances/"],
    notes: "Irish department store with men's fragrance category pages."
  },
  {
    key: "brown-thomas",
    name: "Brown Thomas",
    homepage: "https://www.brownthomas.com/",
    hosts: ["brownthomas.com", "www.brownthomas.com"],
    irishBased: true,
    categoryUrls: ["https://www.brownthomas.com/beauty/fragrance/mens-fragrances/"],
    notes: "Irish department store; allowlisted despite .com because the retailer is Irish."
  },
  {
    key: "the-perfume-shop-ie",
    name: "The Perfume Shop Ireland",
    homepage: "https://www.theperfumeshop.com/ie/",
    hosts: ["theperfumeshop.com", "www.theperfumeshop.com"],
    pathPrefixes: ["/ie/"],
    irishBased: false,
    categoryUrls: ["https://www.theperfumeshop.com/ie/mens/mens-fragrance/c/M2001"],
    notes: "Ireland storefront only. Non-/ie/ paths are rejected."
  },
  {
    key: "boots-ie",
    name: "Boots Ireland",
    homepage: "https://www.boots.ie/",
    hosts: ["boots.ie", "www.boots.ie"],
    irishBased: false,
    categoryUrls: ["https://www.boots.ie/mens/aftershave/cologne"],
    notes: "Irish storefront. Some pages may block plain server-side fetches."
  }
];

export function normalizeHost(hostname) {
  return String(hostname || "").trim().toLowerCase();
}

export function getAllowedSite(inputUrl) {
  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  const host = normalizeHost(parsed.hostname);

  return SITE_ALLOWLIST.find((site) => {
    if (!site.hosts.includes(host)) return false;
    if (!site.pathPrefixes?.length) return true;
    return site.pathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix));
  }) || null;
}

export function assertAllowedSite(inputUrl) {
  const site = getAllowedSite(inputUrl);
  if (!site) {
    const names = SITE_ALLOWLIST.map((item) => item.name).join(", ");
    const error = new Error(`Only allowlisted Irish retailer URLs are supported. Try one of: ${names}.`);
    error.code = "SITE_NOT_ALLOWED";
    error.statusCode = 400;
    throw error;
  }
  return site;
}

export function canonicalizeUrl(inputUrl) {
  const parsed = new URL(inputUrl);
  parsed.hash = "";

  const removableParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "msclkid",
    "srsltid"
  ];

  for (const param of removableParams) {
    parsed.searchParams.delete(param);
  }

  parsed.searchParams.sort();
  return parsed.toString();
}
