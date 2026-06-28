import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DIST_DIR = join(ROOT_DIR, "dist");

await rm(DIST_DIR, { recursive: true, force: true });
await mkdir(DIST_DIR, { recursive: true });
await cp(join(ROOT_DIR, "public"), DIST_DIR, { recursive: true });
await cp(join(ROOT_DIR, "data"), join(DIST_DIR, "data"), { recursive: true });
await writeFile(join(DIST_DIR, ".nojekyll"), "", "utf8");

console.log(JSON.stringify({
  output: "dist",
  includes: [
    "public app",
    "data/catalog-latest.json",
    "data/price-history.json"
  ]
}, null, 2));
