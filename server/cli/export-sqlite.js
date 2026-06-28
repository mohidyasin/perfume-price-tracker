import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(SCRIPT_DIR, "export-sqlite.py");

const candidates = [
  process.env.PYTHON,
  "python3",
  "python",
  "py",
  join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
].filter(Boolean);

let lastError = "";

for (const candidate of candidates) {
  if (candidate.includes("\\") || candidate.includes("/")) {
    if (!existsSync(candidate)) continue;
  }

  const args = candidate.endsWith("py") || candidate.endsWith("py.exe")
    ? ["-3", PYTHON_SCRIPT]
    : [PYTHON_SCRIPT];

  const result = spawnSync(candidate, args, {
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    lastError = result.error.message;
    continue;
  }

  process.exit(result.status ?? 0);
}

console.error(`Could not find Python to export SQLite. Last error: ${lastError || "no candidate executable worked"}`);
process.exit(1);
