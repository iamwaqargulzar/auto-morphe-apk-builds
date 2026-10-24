import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compareVersions, runOk } from "./util.ts";

export interface ApkInfo {
  package: string;
  versionCode: number;
  versionName: string;
  label: string;
}

let aapt2: string | undefined;

/** aapt2 from the newest Android SDK build-tools ($ANDROID_HOME, also preinstalled on GitHub runners). */
async function findAapt2(): Promise<string> {
  if (aapt2) return aapt2;
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("ANDROID_HOME is not set; aapt2 is needed to read APK metadata");
  const versions = (await readdir(join(sdk, "build-tools"))).sort(compareVersions);
  const newest = versions.at(-1);
  if (!newest) throw new Error(`No build-tools in ${sdk}`);
  aapt2 = join(sdk, "build-tools", newest, "aapt2");
  return aapt2;
}

export async function apkInfo(apk: string): Promise<ApkInfo> {
  const { stdout } = await runOk(await findAapt2(), ["dump", "badging", apk], { quiet: true });
  const pkg = stdout.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m);
  if (!pkg) throw new Error(`aapt2 could not read ${apk}`);
  return {
    package: pkg[1]!,
    versionCode: Number(pkg[2]),
    versionName: pkg[3]!,
    label: stdout.match(/^application-label:'([^']*)'/m)?.[1] ?? "",
  };
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
