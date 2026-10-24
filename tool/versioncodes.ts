import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./config.ts";

// Google Play only serves old versions by version code, and only reports the
// code of its current version. We keep a name → code map per package, seeded
// by hand and extended every time we see a code. Apps that use a different
// code per CPU type get "<version>@<arch>" keys; plain "<version>" keys are
// the arm64-v8a code and the fallback for other CPU types.
const FILE = join(ROOT, "state", "version-codes.json");

type Codes = Record<string, Record<string, number>>;

async function load(): Promise<Codes> {
  return JSON.parse(await readFile(FILE, "utf8").catch(() => "{}")) as Codes;
}

const key = (version: string, arch?: string) => (arch && arch !== "arm64-v8a" ? `${version}@${arch}` : version);

export async function lookupVersionCode(pkg: string, version: string, arch?: string): Promise<number | undefined> {
  const known = (await load())[pkg];
  return known?.[key(version, arch)] ?? known?.[version];
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
export async function recordVersionCode(pkg: string, version: string, code: number, arch?: string): Promise<boolean> {
  const codes = await load();
  const known = codes[pkg] ?? {};
  const k = key(version, arch);
  if (known[k] === code) return false;
  known[k] = code;
  // Stable key order keeps diffs small.
  codes[pkg] = Object.fromEntries(Object.entries(known).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  const sorted = Object.fromEntries(Object.entries(codes).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  return true;
}
