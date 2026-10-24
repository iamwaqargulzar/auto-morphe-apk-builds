import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ROOT, loadApp, loadApps, loadSource, type App, type Arch } from "./config.ts";
import { fetchTools, patch, supportedVersions, type Signing, type SupportedVersion, type Tools } from "./morphe.ts";
import { writeCatalog } from "./catalog.ts";
import { NotOnPlayError, downloadFromPlay } from "./play.ts";
import { deleteRelease, publishRelease, releaseExists, releaseTag, type Build } from "./release.ts";
import { log, runOk } from "./util.ts";
import { mergeVersionCodes } from "./versioncodes.ts";

const USAGE = `Usage:
  apkb plan [--app <id>]               print enabled apps as a JSON build matrix
  apkb build <app> [options]           download, patch, sign and release one app
    --force                            rebuild even if the release already exists
    --no-release                       only produce the APK in out/
    --repo <owner/name>                target repo (default: $GITHUB_REPOSITORY)
  apkb versions <app>                  list versions the patches support
  apkb catalog                         write the portal's data (site/src/data/catalog.json)
  apkb merge-codes <files...>          merge version-codes.json files into state/`;

async function signingFromEnv(): Promise<Signing> {
  let keystore = process.env.KEYSTORE_PATH;
  if (!keystore && process.env.KEYSTORE_B64) {
    keystore = join(ROOT, ".cache", "release.keystore");
    await mkdir(join(ROOT, ".cache"), { recursive: true });
    await writeFile(keystore, Buffer.from(process.env.KEYSTORE_B64, "base64"), { mode: 0o600 });
  }
  const { KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD } = process.env;
  if (!keystore || !KEYSTORE_PASSWORD || !KEY_ALIAS || !KEY_PASSWORD) {
    throw new Error("Signing needs KEYSTORE_PATH or KEYSTORE_B64, plus KEYSTORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD");
  }
  return {
    keystore,
    storePassword: KEYSTORE_PASSWORD,
    alias: KEY_ALIAS,
    keyPassword: KEY_PASSWORD,
    signer: process.env.SIGNER_NAME ?? "Auto Murph APK Builds",
  };
}

async function resolveVersion(app: App, tools: Tools): Promise<SupportedVersion> {
  if (app.version !== "auto") {
    const listed = (await supportedVersions(tools, app.package, true)).find((v) => v.version === app.version);
    return listed ?? { version: app.version, patches: 0, codes: {} };
  }
  const versions = await supportedVersions(tools, app.package, app.experimental);
  const best = versions[0];
  if (!best) throw new Error(`Patches ${tools.patchesVersion} list no supported versions for ${app.package}`);
  log(`Supported versions: ${versions.map((v) => `${v.version} (${v.patches})`).join(", ")}`);
  return best;
}

async function build(appId: string, opts: { force: boolean; release: boolean; repo?: string }): Promise<void> {
  const app = await loadApp(appId);
  const source = await loadSource(app.source);
  const repo = opts.repo ?? process.env.GITHUB_REPOSITORY;
  if (opts.release && !repo) throw new Error("No target repo: pass --repo or set GITHUB_REPOSITORY");

  const signing = await signingFromEnv();
  const tools = await fetchTools(source);
  log(`Patcher ${tools.cliVersion}, patches ${source.patches.repo}@${tools.patchesVersion}`);

  const target = await resolveVersion(app, tools);
  const version = target.version;
  const tag = releaseTag(app, version, tools);
  log(`${app.name}: target version ${version} (tag ${tag})`);

  if (opts.release && repo && (await releaseExists(repo, tag))) {
    if (!opts.force) {
      log(`Release ${tag} already exists; nothing to do (use --force to rebuild)`);
      return;
    }
    log(`--force: deleting existing release ${tag}`);
    await deleteRelease(repo, tag);
  }

  const workRoot = join(ROOT, ".cache", "work", app.id);
  await rm(workRoot, { recursive: true, force: true });
  const outDir = join(ROOT, "out");
  await mkdir(outDir, { recursive: true });

  const builds: Build[] = [];
  for (const [i, arch] of app.arches.entries()) {
    try {
      builds.push(await buildArch(app, arch, version, target.codes[arch], tools, signing, join(workRoot, arch), outDir));
    } catch (err) {
      // The first CPU type is required; the others are best effort.
      if (i === 0 && err instanceof NotOnPlayError) {
        log(`Skipping ${app.name} for now: ${err.message}`);
        if (process.env.GITHUB_ACTIONS) console.log(`::notice title=${app.name} waiting for Google Play::${err.message}`);
        return;
      }
      if (i === 0) throw err;
      log(`WARNING: skipping ${arch}: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  if (opts.release && repo) {
    const url = await publishRelease({ repo, app, version, tools, builds, workDir: workRoot, patchesRepo: source.patches.repo });
    log(`Released: ${url}`);
  }
}

/** CPU types with native code in an .apk (lib/<abi>/) or .apks bundle (split_config.<abi>.apk). */
async function abisIn(file: string): Promise<Set<string>> {
  const { stdout } = await runOk("unzip", ["-Z1", file], { quiet: true });
  const abis = new Set<string>();
  for (const line of stdout.split("\n")) {
    const m = line.match(/^lib\/([^/]+)\//) ?? line.match(/^split_config\.(arm64_v8a|armeabi_v7a|x86_64|x86)\.apk$/);
    if (m) abis.add(m[1]!.replace(/_/g, "-").replace("x86-64", "x86_64"));
  }
  return abis;
}

async function buildArch(
  app: App,
  arch: Arch,
  version: string,
  codeHint: number | undefined,
  tools: Tools,
  signing: Signing,
  workDir: string,
  outDir: string,
): Promise<Build> {
  log(`--- ${app.name} ${version} ${arch} ---`);
  await mkdir(workDir, { recursive: true });
  const input = await downloadFromPlay(app, arch, version, workDir, codeHint);
  const abis = await abisIn(input);
  if (abis.size && !abis.has(arch)) {
    throw new Error(`Download has native code for ${[...abis].join(", ")} only, not ${arch}`);
  }
  const patched = join(workDir, "patched.apk");
  const result = await patch(tools, app, arch, input, patched, signing);

  if (result.packageName !== app.package || result.packageVersion !== version) {
    throw new Error(`Downloaded ${result.packageName} ${result.packageVersion}, expected ${app.package} ${version}`);
  }
  log(`Patched ${arch}: ${result.appliedPatches.length} applied, ${result.failedPatches.length} failed`);

  const apk = join(outDir, `${app.id}-${version}-${arch}.apk`);
  await rename(patched, apk);
  log(`Output: ${apk}`);
  return { arch, apk, result };
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      app: { type: "string" },
      force: { type: "boolean", default: false },
      "no-release": { type: "boolean", default: false },
      repo: { type: "string" },
    },
  });
  const [cmd, arg] = positionals;

  switch (cmd) {
    case "plan": {
      const apps = (await loadApps()).filter((a) => a.enabled && (!values.app || a.id === values.app));
      console.log(JSON.stringify({ app: apps.map((a) => a.id) }));
      break;
    }
    case "build":
      if (!arg) throw new Error(USAGE);
      await build(arg, { force: values.force, release: !values["no-release"], repo: values.repo });
      break;
    case "versions": {
      if (!arg) throw new Error(USAGE);
      const app = await loadApp(arg);
      const tools = await fetchTools(await loadSource(app.source));
      for (const v of await supportedVersions(tools, app.package, app.experimental)) console.log(`${v.version}\t${v.patches} patches`);
      break;
    }
    case "merge-codes": {
      const added = await mergeVersionCodes(positionals.slice(1));
      log(`Merged ${added} new version code(s)`);
      break;
    }
    case "catalog":
      await writeCatalog();
      break;
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err: Error) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
