import { stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { apkInfo, sha256 } from "./apkinfo.ts";
import { ROOT, sourceRepo, type App, type Arch } from "./config.ts";
import type { PatchResult, Tools } from "./morphe.ts";
import { log, run, runOk, versionSlug } from "./util.ts";

export interface Build {
  arch: Arch;
  apk: string;
  result: PatchResult;
}

/**
 * build.json, attached to every release: what the portal and the updater app
 * read. The installed package can differ from the Play one (patched YouTube
 * installs as app.morphe.android.youtube), and versionCode may be forced to
 * the maximum by a patch, so the updater compares versionName + build id.
 */
export interface BuildManifest {
  schema: 1;
  build: string;
  app: string;
  name: string;
  package: string;
  originalPackage: string;
  versionName: string;
  versionCode: number;
  builtAt: string;
  patches: { repo: string; version: string; applied: string[]; failed: string[]; extras?: { repo: string; name: string; version: string }[] };
  files: Partial<Record<Arch, { name: string; size: number; sha256: string }>>;
}

async function buildManifest(app: App, tag: string, tools: Tools, builds: Build[], patchesRepo: string): Promise<BuildManifest> {
  const info = await apkInfo(builds[0]!.apk);
  const files: BuildManifest["files"] = {};
  for (const b of builds) {
    files[b.arch] = { name: basename(b.apk), size: (await stat(b.apk)).size, sha256: await sha256(b.apk) };
  }
  const result = builds[0]!.result;
  return {
    schema: 1,
    build: tag,
    app: app.id,
    name: app.name,
    package: info.package,
    originalPackage: app.package,
    versionName: info.versionName,
    versionCode: info.versionCode,
    builtAt: new Date().toISOString(),
    patches: {
      repo: patchesRepo,
      version: tools.patchesVersion,
      applied: result.appliedPatches,
      failed: result.failedPatches.map((p) => p.name ?? p.patch ?? "unknown"),
      extras: tools.extras.map((e) => ({ repo: sourceRepo(e.source), name: e.source.name, version: e.version })),
    },
    files,
  };
}

export function releaseTag(app: App, version: string, tools: Tools): string {
  // Extra bundles join the tag so a new version of them makes a new release.
  return `${app.id}-v${versionSlug(version)}-p${tools.patchesVersion}${tools.extras.map((e) => `-${e.source.id}${e.version}`).join("")}`;
}

export async function releaseExists(repo: string, tag: string): Promise<boolean> {
  const res = await run("gh", ["release", "view", tag, "--repo", repo, "--json", "tagName"], { quiet: true });
  return res.code === 0;
}

export async function deleteRelease(repo: string, tag: string): Promise<void> {
  await runOk("gh", ["release", "delete", tag, "--repo", repo, "--yes", "--cleanup-tag"], { quiet: true });
}

function notes(app: App, version: string, tools: Tools, builds: Build[]): string {
  // Patch results are the same for every CPU type; report the first.
  const result = builds[0]!.result;
  const failed = result.failedPatches.map((p) => `- ${p.name ?? p.patch ?? JSON.stringify(p)}`);
  const missing = app.arches.filter((a) => !builds.some((b) => b.arch === a));
  return [
    `**${app.name} ${version}** (\`${app.package}\`)`,
    "",
    `| | |`,
    `|---|---|`,
    `| CPU types | ${builds.map((b) => `\`${b.arch}\``).join(", ")} |`,
    `| Patches | [${tools.patchesVersion}](${tools.patchesUrl}) |`,
    ...tools.extras.map((e) => `| ${e.source.name} | [${e.version}](${e.url}) |`),
    `| Patcher | Morphe CLI ${tools.cliVersion} |`,
    `| Applied | ${result.appliedPatches.length} |`,
    `| Failed | ${result.failedPatches.length} |`,
    "",
    "Which file? Most phones from 2017 on: `arm64-v8a`. Older or budget 32-bit phones: `armeabi-v7a`.",
    "",
    missing.length ? `> Not built this time: ${missing.join(", ")} (Google Play did not provide it).\n` : "",
    failed.length ? `### Failed patches\n${failed.join("\n")}\n` : "",
    `<details><summary>Applied patches</summary>\n\n${result.appliedPatches.map((p) => `- ${p}`).join("\n")}\n</details>`,
    "",
    "Licensing: patched with GPLv3 patches; see the attached NOTICE.",
  ].join("\n");
}

export async function publishRelease(opts: {
  repo: string;
  app: App;
  version: string;
  tools: Tools;
  builds: Build[];
  workDir: string;
  patchesRepo: string;
}): Promise<string> {
  const { repo, app, version, tools, builds, workDir, patchesRepo } = opts;
  const tag = releaseTag(app, version, tools);
  const notesFile = join(workDir, "notes.md");
  await writeFile(notesFile, notes(app, version, tools, builds));
  const manifestFile = join(workDir, "build.json");
  await writeFile(manifestFile, `${JSON.stringify(await buildManifest(app, tag, tools, builds, patchesRepo), null, 2)}\n`);
  log(`Creating release ${tag} on ${repo}`);
  const res = await runOk("gh", [
    "release", "create", tag,
    "--repo", repo,
    "--title", `${app.name} ${version} (patches ${tools.patchesVersion})`,
    "--notes-file", notesFile,
    ...builds.map((b) => b.apk),
    manifestFile,
    join(ROOT, "NOTICE"),
  ], { quiet: true });
  return res.stdout.trim();
}
