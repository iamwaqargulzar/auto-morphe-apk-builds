import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { log } from "./util.ts";

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "auto-morphe-apk-builds",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface Release {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string;
  body: string | null;
  assets: ReleaseAsset[];
}

export async function latestRelease(repo: string): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: headers() });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo} latest release`);
  return (await res.json()) as Release;
}

export function pickAsset(release: Release, pattern: RegExp): ReleaseAsset {
  const asset = release.assets.find((a) => pattern.test(a.name));
  if (!asset) throw new Error(`No asset matching ${pattern} in ${release.html_url}`);
  return asset;
}

/** Download to `dest` unless a file of the same size is already there. */
export async function downloadAsset(asset: ReleaseAsset, dest: string): Promise<string> {
  const existing = await stat(dest).catch(() => null);
  if (existing?.size === asset.size) return dest;
  await mkdir(dirname(dest), { recursive: true });
  log(`Downloading ${asset.name} (${(asset.size / 1e6).toFixed(1)} MB)`);
  const res = await fetch(asset.browser_download_url, { headers: { "User-Agent": "auto-morphe-apk-builds" } });
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}: ${asset.browser_download_url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  await rename(tmp, dest);
  return dest;
}
