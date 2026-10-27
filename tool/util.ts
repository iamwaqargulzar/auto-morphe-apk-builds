import { spawn } from "node:child_process";

export function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command, streaming output to the console while also capturing it. */
export function run(cmd: string, args: string[], opts: { quiet?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...opts.env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d;
      if (!opts.quiet) process.stdout.write(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d;
      if (!opts.quiet) process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function runOk(cmd: string, args: string[], opts: { quiet?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  const res = await run(cmd, args, opts);
  if (res.code !== 0) {
    const tail = (res.stderr || res.stdout).trim().split("\n").slice(-15).join("\n");
    throw new Error(`${cmd} ${args[0] ?? ""} exited with ${res.code}\n${tail}`);
  }
  return res;
}

/** A version name safe for tags and file names ("343.12 - Stable" → "343.12-Stable"). */
export const versionSlug = (version: string) => version.replace(/\s+/g, "");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry with exponential backoff: delays of base, 2*base, 4*base...
 * Errors matching `fatal` are rethrown at once (e.g. bad credentials).
 */
export async function retry<T>(
  label: string,
  attempts: number,
  baseMs: number,
  fn: (attempt: number) => Promise<T>,
  fatal?: RegExp,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i === attempts || fatal?.test((err as Error).message)) break;
      const wait = baseMs * 2 ** (i - 1);
      log(`${label}: attempt ${i}/${attempts} failed (${(err as Error).message.split("\n")[0]}); retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** Compare dotted version strings numerically (21.20.405 > 21.16.256). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
