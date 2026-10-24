import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, type App, type Arch } from "./config.ts";
import type { PatchResult, Tools } from "./morphe.ts";
import { log, run, runOk } from "./util.ts";

export interface Build {
  arch: Arch;
  apk: string;
  result: PatchResult;
}

export function releaseTag(app: App, version: string, tools: Tools): string {
  return `${app.id}-v${version}-p${tools.patchesVersion}`;
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
}): Promise<string> {
  const { repo, app, version, tools, builds, workDir } = opts;
  const tag = releaseTag(app, version, tools);
  const notesFile = join(workDir, "notes.md");
  await writeFile(notesFile, notes(app, version, tools, builds));
  log(`Creating release ${tag} on ${repo}`);
  const res = await runOk("gh", [
    "release", "create", tag,
    "--repo", repo,
    "--title", `${app.name} ${version} (patches ${tools.patchesVersion})`,
    "--notes-file", notesFile,
    ...builds.map((b) => b.apk),
    join(ROOT, "NOTICE"),
  ], { quiet: true });
  return res.stdout.trim();
}
