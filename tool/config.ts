import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const ROOT = new URL("..", import.meta.url).pathname;

export const PROJECT = {
  name: "Auto Murph APK Builds",
  repo: "iamwaqargulzar/auto-murph-apk-builds",
  site: "https://apk.iamwaqargulzar.com",
  // SHA-256 of the signing certificate, so people can verify downloads.
  certSha256: "6D:83:1C:77:55:56:39:05:14:D3:4B:2C:0D:18:69:20:CA:A7:A9:AA:83:04:08:7B:DB:24:83:97:73:80:7A:A7",
} as const;

// Morphe Desktop CLI, used for every source.
export const CLI_REPO = "MorpheApp/morphe-desktop";
export const CLI_ASSET = /^morphe-desktop-.*-all\.jar$/;

export const ARCHES = ["arm64-v8a", "armeabi-v7a"] as const;
export type Arch = (typeof ARCHES)[number];

const SourceSchema = z.object({
  name: z.string(),
  patches: z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    asset: z.string(),
  }),
});

const AppSchema = z.object({
  name: z.string(),
  package: z.string().regex(/^[a-zA-Z][\w]*(\.[\w]+)+$/),
  source: z.string(),
  enabled: z.boolean().default(true),
  version: z.string().default("auto"),
  // Also consider versions the patch authors mark experimental.
  experimental: z.boolean().default(false),
  // One APK per CPU type; the first one is required, the rest are best effort.
  arches: z.array(z.enum(ARCHES)).min(1).default([...ARCHES]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  // Position on the portal (lower first).
  order: z.number().default(100),
  // Portal text: one or two sentences on what the patched build changes.
  about: z.string().default(""),
  // Needs MicroG-RE to sign in with a Google account (YouTube, YouTube Music).
  microg: z.boolean().default(false),
});

export type Source = z.infer<typeof SourceSchema> & { id: string };
export type App = z.infer<typeof AppSchema> & { id: string };

async function loadYaml<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const raw = parse(await readFile(file, "utf8"));
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${file}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export async function loadSource(id: string): Promise<Source> {
  const data = await loadYaml(join(ROOT, "sources", `${id}.yml`), SourceSchema);
  return { ...data, id };
}

export async function loadApp(id: string): Promise<App> {
  const data = await loadYaml(join(ROOT, "apps", `${id}.yml`), AppSchema);
  return { ...data, id };
}

export async function loadApps(): Promise<App[]> {
  const files = (await readdir(join(ROOT, "apps"))).filter((f) => f.endsWith(".yml")).sort();
  return Promise.all(files.map((f) => loadApp(f.replace(/\.yml$/, ""))));
}
