import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT, ROOT, loadApps, loadSource, type App, type Arch } from "./config.ts";
import { log } from "./util.ts";

// Builds site/src/data/catalog.json: everything the portal shows, taken from
// apps/*.yml and the GitHub releases. Runs before the Astro build.

interface GhRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string;
  body: string | null;
  draft: boolean;
  assets: { name: string; browser_download_url: string; size: number; download_count: number }[];
}

export interface CatalogAsset {
  arch: Arch;
  name: string;
  url: string;
  size: number;
  downloads: number;
}

export interface CatalogRelease {
  tag: string;
  version: string;
  patchesVersion: string;
  date: string;
  url: string;
  assets: CatalogAsset[];
  applied: string[];
  failed: string[];
}

export interface CatalogApp {
  id: string;
  name: string;
  package: string;
  about: string;
  microg: boolean;
  icon: string | null;
  source: { name: string; repo: string };
  arches: Arch[];
  latest: CatalogRelease | null;
  older: CatalogRelease[];
  obtainium: Partial<Record<Arch, string>>;
  totalDownloads: number;
}

export interface Catalog {
  generatedAt: string;
  project: typeof PROJECT;
  apps: CatalogApp[];
  obtainiumImport: { apps: ObtainiumApp[] };
}

interface ObtainiumApp {
  id: string;
  url: string;
  author: string;
  name: string;
  preferredApkIndex: number;
  additionalSettings: string;
}

async function gh<T>(path: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "auto-murph-apk-builds",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

async function allReleases(): Promise<GhRelease[]> {
  const out: GhRelease[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh<GhRelease[]>(`/repos/${PROJECT.repo}/releases?per_page=100&page=${page}`);
    out.push(...batch.filter((r) => !r.draft));
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Saves the Play Store listing's icon (og:image, 256px) into site/public/icons
 * and returns its site path; null if unavailable.
 */
async function playIcon(id: string, pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" },
    });
    if (!res.ok) return null;
    const m = (await res.text()).match(/<meta property="og:image" content="([^"]+)"/);
    if (!m) return null;
    const img = await fetch(m[1]!.replace(/=[^=/]*$/, "") + "=w256");
    if (!img.ok) return null;
    const dir = join(ROOT, "site", "public", "icons");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.png`), Buffer.from(await img.arrayBuffer()));
    return `/icons/${id}.png`;
  } catch {
    return null;
  }
}

// Release notes list patches as "- Name" lines; applied ones sit inside <details>.
function patchLists(body: string): { applied: string[]; failed: string[] } {
  const section = (re: RegExp) => (body.match(re)?.[1] ?? "").split("\n").map((l) => l.match(/^- (.+)$/)?.[1]?.trim()).filter((x): x is string => !!x);
  return {
    applied: section(/<summary>Applied patches<\/summary>([\s\S]*?)<\/details>/),
    failed: section(/### Failed patches\n([\s\S]*?)(?:\n\n|<details>)/),
  };
}

function toRelease(app: App, r: GhRelease): CatalogRelease | null {
  const m = r.tag_name.match(new RegExp(`^${app.id}-v(.+)-p(.+)$`));
  if (!m) return null;
  const assets: CatalogAsset[] = [];
  for (const a of r.assets) {
    const arch = app.arches.find((x) => a.name.endsWith(`-${x}.apk`));
    if (arch) assets.push({ arch, name: a.name, url: a.browser_download_url, size: a.size, downloads: a.download_count });
  }
  if (!assets.length) return null;
  return { tag: r.tag_name, version: m[1]!, patchesVersion: m[2]!, date: r.published_at, url: r.html_url, assets, ...patchLists(r.body ?? "") };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function obtainiumApp(app: App, arch: Arch): ObtainiumApp {
  return {
    id: app.package,
    url: `https://github.com/${PROJECT.repo}`,
    author: PROJECT.name,
    name: app.name,
    preferredApkIndex: 0,
    additionalSettings: JSON.stringify({
      includePrereleases: false,
      fallbackToOlderReleases: true,
      // One repo holds every app; release titles start with the app name.
      filterReleaseTitlesByRegEx: `^${escapeRegex(app.name)} \\d`,
      apkFilterRegEx: `-${escapeRegex(arch)}\\.apk$`,
      invertAPKFilter: false,
      autoApkFilterByArch: false,
      // Tags look like youtube-v21.20.405-p1.48.0; compare on the app version.
      versionExtractionRegEx: "-v(\\d+(?:\\.\\d+)+)-p",
      matchGroupToUse: "1",
      versionDetection: true,
    }),
  };
}

function obtainiumLink(o: ObtainiumApp): string {
  const deep = `obtainium://app/${encodeURIComponent(JSON.stringify(o))}`;
  return `https://apps.obtainium.imranr.dev/redirect?r=${encodeURIComponent(deep)}`;
}

export async function buildCatalog(): Promise<Catalog> {
  const apps = (await loadApps()).filter((a) => a.enabled).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const releases = await allReleases();
  const out: CatalogApp[] = [];
  for (const app of apps) {
    const source = await loadSource(app.source);
    const mine = releases
      .map((r) => toRelease(app, r))
      .filter((r): r is CatalogRelease => !!r)
      .sort((a, b) => b.date.localeCompare(a.date));
    const obtainium: Partial<Record<Arch, string>> = {};
    for (const arch of app.arches) obtainium[arch] = obtainiumLink(obtainiumApp(app, arch));
    out.push({
      id: app.id,
      name: app.name,
      package: app.package,
      about: app.about,
      microg: app.microg,
      icon: await playIcon(app.id, app.package),
      source: { name: source.name, repo: source.patches.repo },
      arches: app.arches,
      latest: mine[0] ?? null,
      older: mine.slice(1, 6),
      obtainium,
      totalDownloads: mine.reduce((n, r) => n + r.assets.reduce((m, a) => m + a.downloads, 0), 0),
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    apps: out,
    // Bulk import defaults to arm64-v8a, the right file for almost every phone.
    obtainiumImport: { apps: apps.map((a) => obtainiumApp(a, a.arches[0]!)) },
  };
}

export async function writeCatalog(): Promise<string> {
  const catalog = await buildCatalog();
  const dir = join(ROOT, "site", "src", "data");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "catalog.json");
  await writeFile(file, `${JSON.stringify(catalog, null, 2)}\n`);
  log(`Catalog: ${catalog.apps.length} apps, ${catalog.apps.filter((a) => a.latest).length} with releases → ${file}`);
  return file;
}
