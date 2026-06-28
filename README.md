# Irish Perfume Price Tracker

A local web app for comparing perfume prices from allowlisted Irish retailers in one consolidated catalog view.

## What it does

- Runs a 10+ Irish-site catalog scan into one normalized catalog.
- Groups matching perfumes so one perfume view shows every retailer price together.
- Shows scraped perfume bottle thumbnails in the catalog and retailer comparison rows when retailer pages provide images.
- Filters the catalog by gender, brand, bottle size, and type/concentration such as EDP or EDT.
- Highlights best-price offers and cross-site price discrepancies inside each consolidated perfume group.
- Standardizes size to millilitres and keeps different sizes separate.
- Keeps perfume concentration/type separate, including eau de parfum, eau de toilette, parfum, aftershave, cologne, deodorant, body spray, and gift sets.

## Run it

```powershell
npm start
```

Then open:

```text
http://localhost:4173
```

## Host it on GitHub Pages

This project is ready to run as a static GitHub Pages app. The hosted version reads:

```text
data/catalog-latest.json
data/price-history.json
data/perfume-prices.sqlite
```

The included GitHub Actions workflow at `.github/workflows/pages.yml`:

- runs tests,
- scrapes the Irish retailer catalog daily at `06:17 UTC`,
- updates `data/catalog-latest.json`,
- appends retailer price points to `data/price-history.json`,
- exports a SQLite database snapshot to `data/perfume-prices.sqlite`,
- commits those data changes back to the repository,
- builds `dist/`,
- deploys the app to GitHub Pages.

After pushing this folder to a GitHub repository, open the repository settings and set:

```text
Settings > Pages > Build and deployment > Source > GitHub Actions
```

If `git` is not installed locally, you can publish through the GitHub API instead. Create a GitHub personal access token with permission to create/update repository contents, workflows, and Pages, then run:

```powershell
$env:GH_TOKEN="YOUR_GITHUB_TOKEN"
npm run publish:github -- --repo=perfume-price-tracker
```

Optional flags:

```powershell
npm run publish:github -- --owner=YOUR_GITHUB_USERNAME_OR_ORG --repo=perfume-price-tracker --private=true
```

The publisher uploads the project, enables GitHub Pages in workflow mode, and dispatches the Pages workflow.

You can also refresh manually from GitHub with:

```text
Actions > Deploy perfume price tracker > Run workflow
```

To build the same static artifact locally:

```powershell
npm run build:pages
```

## Test it

```powershell
npm test
```

Try a live scrape from the command line:

```powershell
npm run scrape -- "https://www.mccauley.ie/burberry-hero-for-him-eau-de-parfum-50ml"
npm run scrape -- "https://www.mccauley.ie/fragrances/mens-fragrances" discover
```

Run a full Irish-site catalog scan:

```powershell
npm run catalog -- --site-limit=14 --pages=6 --items=80
```

Run the daily-tracking command locally:

```powershell
npm run update-history -- --site-limit=14 --pages=6 --items=80
```

Export the latest JSON data into the SQLite database:

```powershell
npm run export:sqlite
```

The latest normalized output is saved to:

```text
data/catalog-latest.json
```

The graph data is saved to:

```text
data/price-history.json
```

The SQLite database snapshot is saved to:

```text
data/perfume-prices.sqlite
```

The hosted static app reads the JSON files so it can run on GitHub Pages without a backend server. The workflow also stores the same scrape in SQLite tables (`runs`, `perfumes`, `offers`, and `price_points`) so the received data is available as a real database snapshot.

The report keeps raw normalized offers in `items`, but the dashboard primarily uses `perfumes`. Each `perfumes[]` entry is one consolidated perfume with `productKey`, `title`, `brand`, `volumeMl`, `productFormat`, `image`, `bestPrice`, `highestPrice`, `spread`, and an `offers[]` array sorted by retailer price.

The grouping key is:

```text
brand + normalizedName + productFormat + volumeMl
```

That means `50ml` and `100ml` are not merged, and eau de parfum and eau de toilette are not merged.

Each `offers[]` row includes `siteName`, `productUrl`, `title`, `image`, `price`, `priceText`, `pricePer100ml`, `discountPct`, `source`, and `confidence`.

`price-history.json` keeps dated price points by normalized perfume and retailer, so each perfume can show a retailer-by-retailer price graph over time. The daily workflow updates existing perfumes by `productKey` and adds new `productKey` records when retailers add new perfumes.

## Allowed retailer storefronts

- McCauley Pharmacy: `mccauley.ie`
- Hickey's Pharmacy: `hickeyspharmacies.ie`
- Allcare Pharmacy: `allcarepharmacy.ie`
- Meaghers Pharmacy: `meagherspharmacy.ie`
- McCabes Pharmacy: `mccabespharmacy.com`
- Inish Pharmacy: `inishpharmacy.com`
- Cloud 10 Beauty: `cloud10beauty.com`
- Leavys Pharmacy: `leavys.ie`
- HealthPlus Pharmacy: `healthplus.ie`
- Rochfords Pharmacy: `rochfordspharmacy.ie`
- University Late Night Pharmacy: `universitypharmacy.ie`
- Always There Pharmacy: `alwaystherepharmacy.ie`
- Stauntons Pharmacy: `stauntonspharmacy.ie`
- Arnotts: `arnotts.ie`
- Brown Thomas: `brownthomas.com`
- The Perfume Shop Ireland: `theperfumeshop.com/ie/`
- Boots Ireland: `boots.ie`

The catalog scan defaults to Irish-based retailers only. The app still rejects non-allowlisted websites and non-Ireland storefront paths. Boots Ireland may return HTTP 403 to plain server-side fetches; the app reports that as a scrape issue instead of silently inventing data.

## API

- `GET /api/catalog`
- `POST /api/catalog/scrape` with `{ "siteLimit": 14, "maxPagesPerSite": 6, "maxItemsPerPage": 80 }`
