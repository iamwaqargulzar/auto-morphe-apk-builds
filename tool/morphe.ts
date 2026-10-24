import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CLI_ASSET, CLI_REPO, ROOT, type App, type Arch, type Source } from "./config.ts";
import { downloadAsset, latestRelease, pickAsset } from "./github.ts";
import { compareVersions, run } from "./util.ts";

const CACHE = join(ROOT, ".cache", "tools");
const java = process.env.JAVA_BIN ?? (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", "java") : "java");

export interface Tools {
  cliJar: string;
  cliVersion: string;
  patches: string;
  patchesVersion: string;
  patchesUrl: string;
  patchesNotes: string;
}

export async function fetchTools(source: Source): Promise<Tools> {
  const [cliRel, patchRel] = await Promise.all([latestRelease(CLI_REPO), latestRelease(source.patches.repo)]);
  const cliAsset = pickAsset(cliRel, CLI_ASSET);
  const patchAsset = pickAsset(patchRel, new RegExp(source.patches.asset));
  const [cliJar, patches] = await Promise.all([
    downloadAsset(cliAsset, join(CACHE, cliAsset.name)),
    downloadAsset(patchAsset, join(CACHE, source.id, patchAsset.name)),
  ]);
  return {
    cliJar,
    cliVersion: cliRel.tag_name.replace(/^v/, ""),
    patches,
    patchesVersion: patchRel.tag_name.replace(/^v/, ""),
    patchesUrl: patchRel.html_url,
    patchesNotes: patchRel.body ?? "",
  };
}

// Morphe keeps its data folder next to the jar, so it stays inside .cache.
function morphe(tools: Tools, args: string[], quiet = true) {
  return run(java, ["-jar", tools.cliJar, ...args], { quiet });
}

/**
 * Versions the patches support for a package, best first: most compatible
 * patches, then newest. Parsed from `list-versions` output lines like
 * "\t21.20.405 (104 patches)".
 */
export async function supportedVersions(tools: Tools, pkg: string): Promise<{ version: string; patches: number }[]> {
  const res = await morphe(tools, ["list-versions", "--patches", tools.patches, "-f", pkg]);
  if (res.code !== 0) throw new Error(`list-versions failed:\n${res.stderr || res.stdout}`);
  const out: { version: string; patches: number }[] = [];
  for (const m of res.stdout.matchAll(/^\s+(\S+) \((\d+) patch(?:es)?\)/gm)) {
    out.push({ version: m[1]!, patches: Number(m[2]) });
  }
  return out.sort((a, b) => b.patches - a.patches || compareVersions(b.version, a.version));
}

export interface PatchResult {
  success: boolean;
  packageName: string;
  packageVersion: string;
  appliedPatches: string[];
  failedPatches: { name?: string; patch?: string; error?: string }[];
}

export async function patch(tools: Tools, app: App, arch: Arch, input: string, output: string, signing: Signing): Promise<PatchResult> {
  const resultFile = `${output}.result.json`;
  const args = ["patch", "-p", tools.patches];
  for (const name of app.include) args.push("-e", name);
  for (const name of app.exclude) args.push("-d", name);
  args.push("--striplibs", arch);
  args.push(
    "--continue-on-error",
    "-r", resultFile,
    "-o", output,
    "--keystore", signing.keystore,
    "--keystore-password", signing.storePassword,
    "--keystore-entry-alias", signing.alias,
    "--keystore-entry-password", signing.keyPassword,
    "--signer", signing.signer,
    input,
  );
  const res = await morphe(tools, args, false);
  const result = JSON.parse(await readFile(resultFile, "utf8").catch(() => "null")) as PatchResult | null;
  if (res.code !== 0 || !result?.success) {
    throw new Error(`Patching failed (exit ${res.code})`);
  }
  return result;
}

export interface Signing {
  keystore: string;
  storePassword: string;
  alias: string;
  keyPassword: string;
  signer: string;
}
