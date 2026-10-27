import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CLI_ASSET, CLI_REPO, PROJECT, ROOT, type App, type Arch, type Source } from "./config.ts";
import { downloadAsset, latestRelease, pickAsset } from "./github.ts";
import { compareVersions, log, run, runOk } from "./util.ts";

const CACHE = join(ROOT, ".cache", "tools");
const java = process.env.JAVA_BIN ?? (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", "java") : "java");

export interface Tools {
  cliJar: string;
  cliVersion: string;
  patches: string;
  patchesVersion: string;
  patchesUrl: string;
  patchesNotes: string;
  // Bundles from the app's extraSources, applied on top.
  extras: Bundle[];
}

export interface Bundle {
  source: Source;
  file: string;
  version: string;
  url: string;
  notes: string;
}

export async function fetchTools(source: Source, extraSources: Source[] = []): Promise<Tools> {
  const cliRel = await latestRelease(CLI_REPO);
  const cliAsset = pickAsset(cliRel, CLI_ASSET);
  const cliJar = await downloadAsset(cliAsset, join(CACHE, cliAsset.name));
  const main = await fetchBundle(source, cliJar);
  const extras: Bundle[] = [];
  for (const extra of extraSources) extras.push(await fetchBundle(extra, cliJar));
  return {
    cliJar,
    cliVersion: cliRel.tag_name.replace(/^v/, ""),
    patches: main.file,
    patchesVersion: main.version,
    patchesUrl: main.url,
    patchesNotes: main.notes,
    extras,
  };
}

/** Latest release of a patch repo, or a local Gradle project built against the CLI jar. */
async function fetchBundle(source: Source, cliJar: string): Promise<Bundle> {
  if ("path" in source.patches) {
    const dir = join(ROOT, source.patches.path);
    const props = await readFile(join(dir, "gradle.properties"), "utf8");
    const version = props.match(/^version\s*=\s*(\S+)/m)?.[1];
    if (!version) throw new Error(`${dir}/gradle.properties has no version`);
    log(`Building ${source.name} ${version}`);
    await runOk(join(dir, "gradlew"), ["-p", dir, "--no-daemon", "-q", "build", `-PmorpheJar=${cliJar}`]);
    const url = `https://github.com/${PROJECT.repo}/tree/main/${source.patches.path}`;
    return { source, file: join(dir, "build", "libs", `patches-${version}.mpp`), version, url, notes: "" };
  }
  const rel = await latestRelease(source.patches.repo);
  const asset = pickAsset(rel, new RegExp(source.patches.asset));
  const file = await downloadAsset(asset, join(CACHE, source.id, asset.name));
  return { source, file, version: rel.tag_name.replace(/^v/, ""), url: rel.html_url, notes: rel.body ?? "" };
}

// Morphe keeps its data folder next to the jar, so it stays inside .cache.
function morphe(tools: Tools, args: string[], quiet = true) {
  return run(java, ["-jar", tools.cliJar, ...args], { quiet });
}

/**
 * Versions the patches support for a package, best first: most compatible
 * patches, then newest.
 */
export interface SupportedVersion {
  version: string;
  patches: number;
  // Google Play version codes per CPU type, when the patch authors list them.
  codes: Partial<Record<Arch, number>>;
}

const ABI_NAMES: Record<string, Arch> = { ARM64_V8A: "arm64-v8a", ARMEABI_V7A: "armeabi-v7a" };

export async function supportedVersions(tools: Tools, pkg: string, experimental = false): Promise<SupportedVersion[]> {
  const res = await morphe(tools, ["list-versions", "--patches", tools.patches, "-f", pkg, ...(experimental ? ["-x"] : [])]);
  if (res.code !== 0) throw new Error(`list-versions failed:\n${res.stderr || res.stdout}`);
  // Lines look like "\t452.1.0.53.64 [versionCodes: ARM64_V8A=385811006] (109 patches)".
  // Some version names have spaces (Discord: "343.12 - Stable").
  const out: SupportedVersion[] = [];
  for (const m of res.stdout.matchAll(/^\s+(\S.*?)(?: \[versionCodes: ([^\]]+)\])? \((\d+) patch(?:es)?\)$/gm)) {
    const codes: Partial<Record<Arch, number>> = {};
    for (const pair of (m[2] ?? "").split(/,\s*/)) {
      const [abi, code] = pair.split("=");
      const arch = abi ? ABI_NAMES[abi.trim()] : undefined;
      if (arch && code) codes[arch] = Number(code);
    }
    out.push({ version: m[1]!, patches: Number(m[3]), codes });
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
  const args = ["patch", "-p", tools.patches, ...tools.extras.flatMap((e) => ["-p", e.file])];
  if (app.exclusive) args.push("--exclusive");
  if (app.force) args.push("-f");
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
