import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const API_VERSION = "2026-03-10";
const DEFAULT_REPO = "perfume-price-tracker";

const args = parseArgs(process.argv.slice(2));
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;

if (!token) {
  throw new Error("Set GH_TOKEN, GITHUB_TOKEN, or GITHUB_PAT before running this publisher.");
}

const user = await github("GET", "/user");
const owner = args.owner || user.login;
const repo = args.repo || DEFAULT_REPO;
const isPrivate = args.private === "true";

const repository = await ensureRepository({ owner, repo, userLogin: user.login, isPrivate });
const branch = repository.default_branch || "main";
const files = await listPublishFiles(ROOT_DIR);

for (const filePath of files) {
  const repoPath = toRepoPath(relative(ROOT_DIR, filePath));
  await putFile({ owner, repo, repoPath, filePath, branch });
}

const pages = await ensurePages({ owner, repo });
await triggerWorkflow({ owner, repo, branch }).catch((error) => {
  console.warn(`Workflow dispatch was skipped: ${error.message}`);
});

const pagesUrl = pages?.html_url || `https://${owner}.github.io/${repo}/`;

console.log(JSON.stringify({
  repository: repository.html_url || `https://github.com/${owner}/${repo}`,
  pages: pagesUrl,
  filesUploaded: files.length,
  next: [
    "Open the repository Actions tab and wait for the Pages deployment to finish.",
    "If Pages is not enabled yet, set Settings > Pages > Source to GitHub Actions."
  ]
}, null, 2));

function parseArgs(values) {
  return Object.fromEntries(values.map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }));
}

async function ensureRepository({ owner, repo, userLogin, isPrivate }) {
  const existing = await github("GET", `/repos/${owner}/${repo}`, null, { allowNotFound: true });
  if (existing) return existing;

  const payload = {
    name: repo,
    description: "Irish perfume price tracker with daily retailer scraping, price history, and SQLite export.",
    private: isPrivate,
    has_issues: true,
    auto_init: true
  };

  if (owner === userLogin) {
    return github("POST", "/user/repos", payload);
  }

  return github("POST", `/orgs/${owner}/repos`, payload);
}

async function putFile({ owner, repo, repoPath, filePath, branch }) {
  const encodedPath = repoPath.split("/").map(encodeURIComponent).join("/");
  const existing = await github("GET", `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, null, {
    allowNotFound: true
  });
  const content = await prepareFileContent(repoPath, filePath, branch);
  const payload = {
    message: existing?.sha ? `Update ${repoPath}` : `Add ${repoPath}`,
    content: content.toString("base64"),
    branch,
    ...(existing?.sha ? { sha: existing.sha } : {})
  };

  await github("PUT", `/repos/${owner}/${repo}/contents/${encodedPath}`, payload);
}

async function ensurePages({ owner, repo }) {
  const existing = await github("GET", `/repos/${owner}/${repo}/pages`, null, { allowNotFound: true });
  if (existing?.build_type === "workflow") return existing;

  const payload = { build_type: "workflow" };
  if (existing) {
    return github("PUT", `/repos/${owner}/${repo}/pages`, payload);
  }

  return github("POST", `/repos/${owner}/${repo}/pages`, payload);
}

async function triggerWorkflow({ owner, repo, branch }) {
  await github("POST", `/repos/${owner}/${repo}/actions/workflows/pages.yml/dispatches`, {
    ref: branch
  }, { expectStatus: [200, 204] });
}

async function prepareFileContent(repoPath, filePath, branch) {
  const content = await readFile(filePath);
  if (repoPath !== ".github/workflows/pages.yml" || branch === "main") return content;

  return Buffer.from(content.toString("utf8").replace(/branches:\n\s+- main/, `branches:\n      - ${branch}`), "utf8");
}

async function listPublishFiles(rootDir) {
  const output = [];
  await walk(rootDir, output);
  return output.sort((a, b) => toRepoPath(relative(rootDir, a)).localeCompare(toRepoPath(relative(rootDir, b))));
}

async function walk(dir, output) {
  for (const entry of await readdir(dir)) {
    if (shouldSkip(entry, dir)) continue;
    const path = join(dir, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      await walk(path, output);
    } else if (info.isFile()) {
      output.push(path);
    }
  }
}

function shouldSkip(entry, dir) {
  const rootRelative = toRepoPath(relative(ROOT_DIR, join(dir, entry)));
  if (!rootRelative) return false;
  if ([".git", "node_modules", "dist"].includes(entry)) return true;
  if (entry.endsWith(".zip")) return true;
  if (basename(rootRelative).toLowerCase() === ".env") return true;
  return false;
}

function toRepoPath(path) {
  return path.split(sep).join("/");
}

async function github(method, path, body, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": API_VERSION,
      "user-agent": "irish-perfume-price-tracker-publisher"
    },
    body: body == null ? undefined : JSON.stringify(body)
  });

  if (options.expectStatus && asArray(options.expectStatus).includes(response.status)) return null;
  if (options.allowNotFound && response.status === 404) return null;

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    const detail = payload?.message || text || response.statusText;
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${detail}`);
  }

  return payload;
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
