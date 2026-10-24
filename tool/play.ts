import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, type App, type Arch } from "./config.ts";
import { compareVersions, log, retry, runOk, type RunResult } from "./util.ts";
import { lookupVersionCode, recordVersionCode } from "./versioncodes.ts";

// Google Play downloader (goopdl), pinned for reproducibility. Uses the
// account in GOOPDL_ACCOUNT_EMAIL / GOOPDL_AAS_TOKEN when set, else anonymous.
const GOOPDL = process.env.GOOPDL ?? "goopdl@1.2.2";

// Credential problems won't fix themselves; don't spend minutes retrying them.
// A wrong-CPU split means the version code belongs to another CPU type, which
// another device profile won't change.
const AUTH_FATAL = /BadAuthentication|Missing required environment variable|must start with aas_et/;
const DOWNLOAD_FATAL = new RegExp(`${AUTH_FATAL.source}|WRONG_ABI|doesn't serve`);

// goopdl device type per CPU type.
const DEVICE: Record<Arch, string> = {
  "arm64-v8a": "arm64",
  "armeabi-v7a": "armv7",
};

// Device profiles to download with, tried in order. goopdl's armv7 pool also
// holds 64-bit phones, and Play gives those the arm64 split, so 32-bit
// downloads must use a device that is 32-bit only.
const PROFILES: Record<Arch, (string | undefined)[]> = {
  "arm64-v8a": [undefined],
  "armeabi-v7a": ["Gj", "IV", "XK"], // Samsung A13 5G, Realme 5 Pro, Samsung J5 Prime
};

/** The target version isn't on Google Play (yet); the build waits for it instead of failing. */
export class NotOnPlayError extends Error {}

let uvDirs: NodeJS.ProcessEnv | undefined;

/**
 * Run goopdl with its own HOME per CPU type + profile. goopdl caches login
 * tokens in ~/.config/goopdl and reuses them across profiles, so a token from
 * a 64-bit device would otherwise leak into 32-bit downloads. uv's cache and
 * Python stay shared so goopdl isn't reinstalled per call.
 */
async function goopdl(args: string[], arch: Arch, profile?: string): Promise<RunResult> {
  if (!uvDirs) {
    const [cache, python] = await Promise.all([
      runOk("uv", ["cache", "dir"], { quiet: true }),
      runOk("uv", ["python", "dir"], { quiet: true }),
    ]);
    uvDirs = { UV_CACHE_DIR: cache.stdout.trim(), UV_PYTHON_INSTALL_DIR: python.stdout.trim() };
  }
  const home = join(ROOT, ".cache", "goopdl-home", `${arch}-${profile ?? "default"}`);
  await mkdir(home, { recursive: true });
  return runOk("uvx", [GOOPDL, ...args], { quiet: true, env: { ...uvDirs, HOME: home } });
}

// Split names use underscores: config.arm64_v8a, config.armeabi_v7a.
const splitAbi = (arch: Arch) => arch.replace(/-/g, "_");

/** Play's current version of a package, e.g. { version: "21.43.523", code: 1561307650 }. */
export async function playLatest(app: App, arch: Arch): Promise<{ version: string; code: number }> {
  const profile = PROFILES[arch][0];
  return retry("Google Play info", 4, 20_000, async () => {
    const res = await goopdl(["info", app.package, "--arch", DEVICE[arch], ...(profile ? ["--profile", profile] : [])], arch, profile);
    const m = res.stdout.match(/Version\s*│\s*(\S+)\s+\((\d+)\)/);
    if (!m) throw new Error(`Could not read version from goopdl info output`);
    return { version: m[1]!, code: Number(m[2]) };
  }, AUTH_FATAL);
}

/**
 * APKPure's public version-history API (the one its app uses) lists version
 * codes for roughly the 20 newest releases. Used only to learn codes; the APK
 * itself still comes from Google Play.
 */
async function apkPureVersionCode(pkg: string, version: string, arch: Arch): Promise<number | undefined> {
  try {
    const res = await fetch(`https://tapi.pureapk.com/v3/get_app_his_version?package_name=${encodeURIComponent(pkg)}&hl=en`, {
      headers: { "Ual-Access-Businessid": "projecta", "Ual-Access-ProjectA": '{"device_info":{"os_ver":"34"}}' },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      version_list?: { version_name?: string; version_code?: string | number; native_code?: string[] }[];
    };
    // Some apps use a different code per CPU type; prefer an exact match.
    const same = data.version_list?.filter((v) => v.version_name === version) ?? [];
    const hit = same.find((v) => v.native_code?.length === 1 && v.native_code[0] === arch) ?? same.find((v) => !v.native_code?.length || v.native_code.includes(arch));
    return hit?.version_code ? Number(hit.version_code) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Version code for `version` on `arch`, in order: the code the patches list,
 * Play's current version, our map, APKPure's version list.
 */
export async function resolveVersionCode(app: App, arch: Arch, version: string, hint?: number): Promise<number> {
  if (hint) {
    await recordVersionCode(app.package, version, hint, arch);
    return hint;
  }
  const latest = await playLatest(app, arch);
  if (await recordVersionCode(app.package, latest.version, latest.code, arch)) {
    log(`Recorded Play's current version ${latest.version} (${latest.code}) for ${arch}`);
  }
  if (latest.version === version) return latest.code;
  const known = await lookupVersionCode(app.package, version, arch);
  if (known) return known;
  const fromApkPure = await apkPureVersionCode(app.package, version, arch);
  if (fromApkPure) {
    await recordVersionCode(app.package, version, fromApkPure, arch);
    log(`Recorded version code ${fromApkPure} for ${version} from APKPure's version list`);
    return fromApkPure;
  }
  const why = compareVersions(version, latest.version) > 0 ? "newer than Play's, so it isn't rolled out yet" : "no version code known";
  throw new NotOnPlayError(
    `${app.package} ${version}: ${why} (Play is on ${latest.version}). ` +
      `For older versions, add the code to state/version-codes.json or set "experimental: true".`,
  );
}

/**
 * Download `pkg` at `version` from Google Play, including split APKs.
 * Returns a single .apk, or an .apks bundle (base.apk + split_*.apk) that
 * Morphe accepts directly.
 */
export async function downloadFromPlay(app: App, arch: Arch, version: string, workDir: string, hint?: number): Promise<string> {
  const code = await resolveVersionCode(app, arch, version, hint);
  log(`Google Play: ${app.package} ${version} for ${arch} (version code ${code})`);
  const dlDir = join(workDir, "play");
  const profiles = PROFILES[arch];
  const files = await retry("Google Play download", 5, 30_000, async (attempt) => {
    const profile = profiles[(attempt - 1) % profiles.length];
    await rm(dlDir, { recursive: true, force: true });
    await mkdir(dlDir, { recursive: true });
    await goopdl([
      "download", app.package,
      "-v", String(code),
      "-a", DEVICE[arch],
      ...(profile ? ["--profile", profile] : []),
      "--splits", "--no-extras",
      "-o", dlDir,
    ], arch, profile).catch((err: Error) => {
      if (/does not serve version/.test(err.message)) throw new NotOnPlayError(`Google Play doesn't serve ${app.package} ${version} (${code})`);
      throw err;
    });
    const got = (await readdir(dlDir)).filter((f) => f.endsWith(".apk")).sort();
    // An ABI split for another CPU type means Play treated us as another device.
    const abiSplits = got.filter((f) => /-config\.(arm64_v8a|armeabi_v7a|x86|x86_64)\.apk$/.test(f));
    if (abiSplits.length && !abiSplits.some((f) => f.endsWith(`-config.${splitAbi(arch)}.apk`))) {
      throw new Error(`WRONG_ABI: Play sent ${abiSplits.join(", ")} instead of ${arch} for version code ${code}`);
    }
    return got;
  }, DOWNLOAD_FATAL);

  const base = files.find((f) => !f.includes("-config.") && !f.includes("-split"));
  if (!base) throw new Error(`No base APK in Play download: ${files.join(", ")}`);
  log(`Play: ${files.length} file(s): ${files.join(", ")}`);

  if (files.length === 1) return join(dlDir, base);

  // Bundle as .apks: base.apk + split_<name>.apk
  const stage = join(workDir, "bundle");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const staged: string[] = [];
  for (const f of files) {
    const target = join(stage, f === base ? "base.apk" : `split_${f.slice(f.lastIndexOf("-") + 1)}`);
    await copyFile(join(dlDir, f), target);
    staged.push(target);
  }
  const bundle = join(workDir, `${app.id}-${arch}.apks`);
  await rm(bundle, { force: true });
  await runOk("zip", ["-0", "-q", "-j", bundle, ...staged]);
  return bundle;
}
