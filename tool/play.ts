import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { App } from "./config.ts";
import { log, retry, runOk } from "./util.ts";
import { lookupVersionCode, recordVersionCode } from "./versioncodes.ts";

// Google Play downloader (anonymous token via goopdl), pinned for reproducibility.
const GOOPDL = process.env.GOOPDL ?? "goopdl@1.2.2";

const DEVICE: Record<App["arch"], string> = {
  "arm64-v8a": "arm64",
  "armeabi-v7a": "armv7",
  x86_64: "x86_64",
  universal: "arm64",
};

/** Play's current version of a package, e.g. { version: "21.43.523", code: 1561307650 }. */
export async function playLatest(app: App): Promise<{ version: string; code: number }> {
  return retry("Google Play info", 4, 20_000, async () => {
    const res = await runOk("uvx", [GOOPDL, "info", app.package, "--arch", DEVICE[app.arch]], { quiet: true });
    const m = res.stdout.match(/Version\s*│\s*(\S+)\s+\((\d+)\)/);
    if (!m) throw new Error(`Could not read version from goopdl info output`);
    return { version: m[1]!, code: Number(m[2]) };
  });
}

/** Version code for `version`: from our map, or from Play if it is the current version. */
export async function resolveVersionCode(app: App, version: string): Promise<number> {
  const latest = await playLatest(app);
  if (await recordVersionCode(app.package, latest.version, latest.code)) {
    log(`Recorded Play's current version ${latest.version} (${latest.code})`);
  }
  if (latest.version === version) return latest.code;
  const known = await lookupVersionCode(app.package, version);
  if (known) return known;
  throw new Error(
    `No version code known for ${app.package} ${version} (Play is on ${latest.version}). ` +
      `Add it to state/version-codes.json (APKMirror's release page lists it).`,
  );
}

/**
 * Download `pkg` at `version` from Google Play, including split APKs.
 * Returns a single .apk, or an .apks bundle (base.apk + split_*.apk) that
 * Morphe accepts directly.
 */
export async function downloadFromPlay(app: App, version: string, workDir: string): Promise<string> {
  const code = await resolveVersionCode(app, version);
  log(`Google Play: ${app.package} ${version} (version code ${code})`);
  const dlDir = join(workDir, "play");
  await retry("Google Play download", 5, 30_000, async () => {
    await rm(dlDir, { recursive: true, force: true });
    await mkdir(dlDir, { recursive: true });
    await runOk("uvx", [
      GOOPDL, "download", app.package,
      "-v", String(code),
      "-a", DEVICE[app.arch],
      "--splits", "--no-extras",
      "-o", dlDir,
    ], { quiet: true });
  });

  const files = (await readdir(dlDir)).filter((f) => f.endsWith(".apk")).sort();
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
  const bundle = join(workDir, `${app.id}.apks`);
  await rm(bundle, { force: true });
  await runOk("zip", ["-0", "-q", "-j", bundle, ...staged]);
  return bundle;
}
