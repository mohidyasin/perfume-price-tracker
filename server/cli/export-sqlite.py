#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
CATALOG_FILE = DATA_DIR / "catalog-latest.json"
HISTORY_FILE = DATA_DIR / "price-history.json"
DATABASE_FILE = DATA_DIR / "perfume-prices.sqlite"


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def money(value):
    if value is None:
        return None
    return float(value)


def main():
    catalog = load_json(CATALOG_FILE, {"perfumes": [], "items": [], "sites": [], "summary": {}})
    history = load_json(HISTORY_FILE, {"runs": [], "products": []})

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if DATABASE_FILE.exists():
        DATABASE_FILE.unlink()

    with sqlite3.connect(DATABASE_FILE) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        create_schema(conn)
        insert_runs(conn, history)
        insert_perfumes(conn, catalog)
        insert_offers(conn, catalog)
        insert_price_points(conn, history)
        conn.commit()

    print(json.dumps({
        "database": str(DATABASE_FILE.relative_to(ROOT_DIR)).replace("\\", "/"),
        "perfumes": len(catalog.get("perfumes", [])),
        "offers": sum(len(perfume.get("offers", [])) for perfume in catalog.get("perfumes", [])),
        "runs": len(history.get("runs", [])),
        "pricePoints": sum(
            len(retailer.get("points", []))
            for product in history.get("products", [])
            for retailer in product.get("retailers", [])
        )
    }, indent=2))


def create_schema(conn):
    conn.executescript("""
        CREATE TABLE runs (
          date TEXT PRIMARY KEY,
          run_id TEXT,
          finished_at TEXT,
          summary_json TEXT
        );

        CREATE TABLE perfumes (
          product_key TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          brand TEXT,
          normalized_name TEXT,
          volume_ml REAL,
          product_format TEXT,
          audience TEXT,
          image TEXT,
          best_price REAL,
          highest_price REAL,
          spread REAL,
          spread_pct REAL,
          offer_count INTEGER,
          retailer_count INTEGER
        );

        CREATE TABLE offers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_key TEXT NOT NULL,
          site_key TEXT,
          site_name TEXT,
          product_url TEXT,
          title TEXT,
          audience TEXT,
          image TEXT,
          price REAL,
          price_text TEXT,
          currency TEXT,
          list_price REAL,
          discount_pct REAL,
          price_per_100ml REAL,
          source TEXT,
          confidence REAL,
          is_best_price INTEGER,
          FOREIGN KEY(product_key) REFERENCES perfumes(product_key)
        );

        CREATE TABLE price_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_key TEXT NOT NULL,
          site_key TEXT NOT NULL,
          site_name TEXT,
          date TEXT NOT NULL,
          price REAL NOT NULL,
          price_text TEXT,
          price_per_100ml REAL,
          title TEXT,
          audience TEXT,
          image TEXT,
          product_url TEXT,
          UNIQUE(product_key, site_key, date)
        );

        CREATE INDEX idx_offers_product ON offers(product_key);
        CREATE INDEX idx_offers_audience ON offers(audience);
        CREATE INDEX idx_price_points_product_date ON price_points(product_key, date);
        CREATE INDEX idx_price_points_site_date ON price_points(site_key, date);
    """)


def insert_runs(conn, history):
    rows = [
        (
            run.get("date", ""),
            run.get("runId", ""),
            run.get("finishedAt", ""),
            json.dumps(run.get("summary", {}), separators=(",", ":"))
        )
        for run in history.get("runs", [])
        if run.get("date")
    ]
    conn.executemany(
        "INSERT INTO runs(date, run_id, finished_at, summary_json) VALUES (?, ?, ?, ?)",
        rows
    )


def insert_perfumes(conn, catalog):
    rows = []
    for perfume in catalog.get("perfumes", []):
        rows.append((
            perfume.get("productKey", ""),
            perfume.get("title", ""),
            perfume.get("brand", ""),
            perfume.get("normalizedName", ""),
            perfume.get("volumeMl"),
            perfume.get("productFormat", "format-unknown"),
            perfume.get("audience", "unknown"),
            perfume.get("image", ""),
            money(perfume.get("bestPrice")),
            money(perfume.get("highestPrice")),
            money(perfume.get("spread")),
            money(perfume.get("spreadPct")),
            int(perfume.get("offerCount") or 0),
            int(perfume.get("retailerCount") or 0)
        ))

    conn.executemany("""
        INSERT INTO perfumes(
          product_key, title, brand, normalized_name, volume_ml, product_format,
          audience, image, best_price, highest_price, spread, spread_pct,
          offer_count, retailer_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)


def insert_offers(conn, catalog):
    rows = []
    for perfume in catalog.get("perfumes", []):
        product_key = perfume.get("productKey", "")
        for offer in perfume.get("offers", []):
            rows.append((
                product_key,
                offer.get("siteKey", ""),
                offer.get("siteName", ""),
                offer.get("productUrl", ""),
                offer.get("title", ""),
                offer.get("audience", perfume.get("audience", "unknown")),
                offer.get("image", ""),
                money(offer.get("price")),
                offer.get("priceText", ""),
                offer.get("currency", "EUR"),
                money(offer.get("listPrice")),
                money(offer.get("discountPct")),
                money(offer.get("pricePer100ml")),
                offer.get("source", ""),
                money(offer.get("confidence")),
                1 if offer.get("isBestPrice") else 0
            ))

    conn.executemany("""
        INSERT INTO offers(
          product_key, site_key, site_name, product_url, title, audience, image,
          price, price_text, currency, list_price, discount_pct, price_per_100ml,
          source, confidence, is_best_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)


def insert_price_points(conn, history):
    rows = []
    for product in history.get("products", []):
        product_key = product.get("productKey", "")
        product_audience = product.get("audience", "unknown")
        for retailer in product.get("retailers", []):
            for point in retailer.get("points", []):
                rows.append((
                    product_key,
                    retailer.get("siteKey", ""),
                    retailer.get("siteName", ""),
                    point.get("date", ""),
                    money(point.get("price")),
                    point.get("priceText", ""),
                    money(point.get("pricePer100ml")),
                    point.get("title", ""),
                    point.get("audience", product_audience),
                    point.get("image", ""),
                    point.get("productUrl", "")
                ))

    conn.executemany("""
        INSERT OR REPLACE INTO price_points(
          product_key, site_key, site_name, date, price, price_text,
          price_per_100ml, title, audience, image, product_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)


if __name__ == "__main__":
    main()
