import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT, ROOT, loadApps, loadSource, type App, type Arch } from "./config.ts";
import type { BuildManifest } from "./release.ts";
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
  sha256: string | null;
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
  // From build.json (null for releases made before it existed).
  installedPackage: string | null;
  versionCode: number | null;
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
  totalDownloads: number;
  // Extra build offered on this app's page (e.g. Reddit's login helper).
  helper: { id: string; name: string; about: string; latest: CatalogRelease | null } | null;
  helperFor?: string;
}

export interface Catalog {
  generatedAt: string;
  project: typeof PROJECT;
  apps: CatalogApp[];
  updater: UpdaterRelease | null;
  feed: UpdaterFeed;
}

export interface UpdaterRelease {
  versionName: string;
  versionCode: number;
  sha256: string;
  url: string;
  size: number;
  releasedAt: string;
  releaseUrl: string;
}

interface UpdaterFeed {
  schema: 1;
  generatedAt: string;
  site: string;
  certSha256: string;
  updater: UpdaterRelease | null;
  apps: unknown[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

async function fetchManifest(r: GhRelease): Promise<BuildManifest | null> {
  const asset = r.assets.find((a) => a.name === "build.json");
  if (!asset) return null;
  try {
    const res = await fetch(asset.browser_download_url, { headers: { "User-Agent": "auto-murph-apk-builds" } });
    return res.ok ? ((await res.json()) as BuildManifest) : null;
  } catch {
    return null;
  }
}

function toRelease(app: App, r: GhRelease): CatalogRelease | null {
  const m = r.tag_name.match(new RegExp(`^${escapeRegex(app.id)}-v(.+)-p(.+)$`));
  if (!m) return null;
  const assets: CatalogAsset[] = [];
  for (const a of r.assets) {
    const arch = app.arches.find((x) => a.name.endsWith(`-${x}.apk`));
    if (arch) assets.push({ arch, name: a.name, url: a.browser_download_url, size: a.size, downloads: a.download_count, sha256: null });
  }
  if (!assets.length) return null;
  return {
    tag: r.tag_name,
    version: m[1]!,
    patchesVersion: m[2]!,
    date: r.published_at,
    url: r.html_url,
    assets,
    ...patchLists(r.body ?? ""),
    installedPackage: null,
    versionCode: null,
  };
}

/** Fill in checksums and installed package from the release's build.json. */
async function enrich(release: CatalogRelease, gh: GhRelease): Promise<void> {
  const manifest = await fetchManifest(gh);
  if (!manifest) return;
  release.installedPackage = manifest.package;
  release.versionCode = manifest.versionCode;
  release.applied = manifest.patches.applied;
  release.failed = manifest.patches.failed;
  for (const a of release.assets) a.sha256 = manifest.files[a.arch]?.sha256 ?? null;
}

/**
 * The updater app's feed (/api/v1/apps.json). Only apps with a release;
 * field names must match updater/app/.../data/Feed.kt.
 */
function feedFor(apps: CatalogApp[], updater: UpdaterRelease | null): UpdaterFeed {
  const abs = (path: string) => new URL(path, PROJECT.site).toString();
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    site: PROJECT.site,
    certSha256: PROJECT.certSha256.replace(/:/g, "").toLowerCase(),
    updater,
    apps: apps.flatMap((a) => {
      const r = a.latest;
      if (!r) return [];
      return [{
        id: a.id,
        name: a.name,
        about: a.about,
        icon: a.icon ? abs(a.icon) : null,
        package: r.installedPackage ?? a.package,
        originalPackage: a.package,
        versionName: r.version,
        build: r.tag,
        releasedAt: r.date,
        releaseUrl: r.url,
        microg: a.microg,
        patchesRepo: a.source.repo,
        patchesVersion: r.patchesVersion,
        patchCount: r.applied.length,
        files: Object.fromEntries(r.assets.map((x) => [x.arch, { url: x.url, size: x.size, sha256: x.sha256 }])),
        helper: a.helper?.latest
          ? {
              name: a.helper.name,
              about: a.helper.about,
              versionName: a.helper.latest.version,
              build: a.helper.latest.tag,
              files: Object.fromEntries(a.helper.latest.assets.map((x) => [x.arch, { url: x.url, size: x.size, sha256: x.sha256 }])),
            }
          : null,
      }];
    }),
  };
}

/** Latest release of the updater app itself (tag updater-v<version>, with updater.json). */
async function updaterRelease(releases: GhRelease[]): Promise<UpdaterRelease | null> {
  const r = releases.filter((x) => x.tag_name.startsWith("updater-v")).sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
  const meta = r?.assets.find((a) => a.name === "updater.json");
  const apk = r?.assets.find((a) => a.name.endsWith(".apk"));
  if (!r || !meta || !apk) return null;
  const res = await fetch(meta.browser_download_url, { headers: { "User-Agent": "auto-murph-apk-builds" } });
  if (!res.ok) return null;
  const info = (await res.json()) as { versionName: string; versionCode: number; sha256: string };
  return { ...info, url: apk.browser_download_url, size: apk.size, releasedAt: r.published_at, releaseUrl: r.html_url };
}

export async function buildCatalog(): Promise<Catalog> {
  const apps = (await loadApps()).filter((a) => a.enabled).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const releases = await allReleases();
  const out: CatalogApp[] = [];
  for (const app of apps) {
    const source = await loadSource(app.source);
    const pairs = releases
      .map((r) => [toRelease(app, r), r] as const)
      .filter((p): p is readonly [CatalogRelease, GhRelease] => !!p[0])
      .sort((a, b) => b[0].date.localeCompare(a[0].date));
    if (pairs[0]) await enrich(pairs[0][0], pairs[0][1]);
    const mine = pairs.map((p) => p[0]);
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
      totalDownloads: mine.reduce((n, r) => n + r.assets.reduce((m, a) => m + a.downloads, 0), 0),
      helper: null,
      helperFor: app.helperFor,
    });
  }
  // Helpers aren't listed on their own; attach each to the app it serves.
  for (const h of out.filter((a) => a.helperFor)) {
    const target = out.find((a) => a.id === h.helperFor);
    if (target) target.helper = { id: h.id, name: h.name, about: h.about, latest: h.latest };
  }
  const listed = out.filter((a) => !a.helperFor);
  const updater = await updaterRelease(releases);
  return {
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    apps: listed,
    updater,
    feed: feedFor(listed, updater),
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
