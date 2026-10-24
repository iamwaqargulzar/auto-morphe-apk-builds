import catalogJson from "./data/catalog.json";
import type { Catalog, CatalogApp } from "../../tool/catalog.ts";

export const catalog = catalogJson as unknown as Catalog;
export const project = catalog.project;
export const repoUrl = `https://github.com/${project.repo}`;
export const requestUrl = `${repoUrl}/issues/new?template=request-app.yml`;
export const microgUrl = "https://github.com/MorpheApp/MicroG-RE/releases/latest";

export const ARCH_LABEL: Record<string, string> = {
  "arm64-v8a": "64-bit (most phones)",
  "armeabi-v7a": "32-bit (older / budget phones)",
};

export function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function appUrl(app: CatalogApp): string {
  return `/apps/${app.id}/`;
}

export const lastBuild = catalog.apps
  .map((a) => a.latest?.date)
  .filter((d): d is string => !!d)
  .sort()
  .at(-1);
