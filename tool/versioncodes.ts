import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./config.ts";

// Google Play only serves old versions by version code, and only reports the
// code of its current version. We keep a name → code map per package, seeded
// by hand and extended every time we see Play's current version.
const FILE = join(ROOT, "state", "version-codes.json");

type Codes = Record<string, Record<string, number>>;

async function load(): Promise<Codes> {
  return JSON.parse(await readFile(FILE, "utf8").catch(() => "{}")) as Codes;
}

export async function lookupVersionCode(pkg: string, version: string): Promise<number | undefined> {
  return (await load())[pkg]?.[version];
}

/** Merge other version-codes.json files (e.g. from parallel CI jobs) into ours. */
export async function mergeVersionCodes(files: string[]): Promise<number> {
  let added = 0;
  for (const f of files) {
    const other = JSON.parse(await readFile(f, "utf8")) as Codes;
    for (const [pkg, versions] of Object.entries(other)) {
      for (const [version, code] of Object.entries(versions)) {
        if (await recordVersionCode(pkg, version, code)) added++;
      }
    }
  }
  return added;
}

/** Record a code; returns true if the file changed. */
export async function recordVersionCode(pkg: string, version: string, code: number): Promise<boolean> {
  const codes = await load();
  const known = codes[pkg] ?? {};
  if (known[version] === code) return false;
  known[version] = code;
  // Stable key order keeps diffs small.
  codes[pkg] = Object.fromEntries(Object.entries(known).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  const sorted = Object.fromEntries(Object.entries(codes).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  return true;
}
