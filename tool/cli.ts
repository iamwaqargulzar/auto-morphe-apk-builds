import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ROOT, loadApp, loadApps, loadSource, type App } from "./config.ts";
import { fetchTools, patch, supportedVersions, type Signing } from "./morphe.ts";
import { downloadFromPlay } from "./play.ts";
import { deleteRelease, publishRelease, releaseExists, releaseTag } from "./release.ts";
import { log } from "./util.ts";

const USAGE = `Usage:
  apkb plan [--app <id>]               print enabled apps as a JSON build matrix
  apkb build <app> [options]           download, patch, sign and release one app
    --force                            rebuild even if the release already exists
    --no-release                       only produce the APK in out/
    --repo <owner/name>                target repo (default: $GITHUB_REPOSITORY)
  apkb versions <app>                  list versions the patches support`;

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
    signer: process.env.SIGNER_NAME ?? "apk-builds",
  };
}

async function resolveVersion(app: App, tools: Awaited<ReturnType<typeof fetchTools>>): Promise<string> {
  if (app.version !== "auto") return app.version;
  const versions = await supportedVersions(tools, app.package);
  const best = versions[0];
  if (!best) throw new Error(`Patches ${tools.patchesVersion} list no supported versions for ${app.package}`);
  log(`Supported versions: ${versions.map((v) => `${v.version} (${v.patches})`).join(", ")}`);
  return best.version;
}

async function build(appId: string, opts: { force: boolean; release: boolean; repo?: string }): Promise<void> {
  const app = await loadApp(appId);
  const source = await loadSource(app.source);
  const repo = opts.repo ?? process.env.GITHUB_REPOSITORY;
  if (opts.release && !repo) throw new Error("No target repo: pass --repo or set GITHUB_REPOSITORY");

  const signing = await signingFromEnv();
  const tools = await fetchTools(source);
  log(`Patcher ${tools.cliVersion}, patches ${source.patches.repo}@${tools.patchesVersion}`);

  const version = await resolveVersion(app, tools);
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

  const workDir = join(ROOT, ".cache", "work", app.id);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  const input = await downloadFromPlay(app, version, workDir);
  const patched = join(workDir, "patched.apk");
  const result = await patch(tools, app, input, patched, signing);

  if (result.packageName !== app.package || result.packageVersion !== version) {
    throw new Error(`Downloaded ${result.packageName} ${result.packageVersion}, expected ${app.package} ${version}`);
  }
  log(`Patched: ${result.appliedPatches.length} applied, ${result.failedPatches.length} failed`);

  const outDir = join(ROOT, "out");
  await mkdir(outDir, { recursive: true });
  const apk = join(outDir, `${app.id}-${version}-${app.arch}.apk`);
  await rename(patched, apk);
  log(`Output: ${apk}`);

  if (opts.release && repo) {
    const url = await publishRelease({ repo, app, version, tools, result, apk, workDir });
    log(`Released: ${url}`);
  }
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
      for (const v of await supportedVersions(tools, app.package)) console.log(`${v.version}\t${v.patches} patches`);
      break;
    }
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err: Error) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
