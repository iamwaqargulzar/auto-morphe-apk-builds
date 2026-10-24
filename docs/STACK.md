# Stack evaluation

Question: is Java + Python the best stack, or is there a better one?

Short answer: **Java is not a choice, it's a requirement** (the patcher is JVM-only).
**Python is a choice**, and a better fit for this project is **TypeScript (Node 22/24)** for all our own code.

---

## 1. Parts of the system and what decides their language

| Part | Who writes it | Language decided by |
|---|---|---|
| Patching engine (apply patches to the APK) | Morphe (third party) | **Fixed: JVM.** Morphe Desktop CLI is Kotlin, needs Java 21+. Patches (`.mpp`) are compiled JVM bytecode, so only a JVM can run them. ReVanced, the other ecosystem, is also Kotlin/JVM. No Rust/Go/JS patcher exists that can run these patches. |
| Signing, lib stripping, split-APK merging | Morphe CLI does it | Fixed: built in (`--keystore`, `--striplibs`, accepts `.apkm/.xapk/.apks`) |
| Patch bundle download | Morphe CLI can do it | `-p https://github.com/<owner>/<repo>` downloads the latest `.mpp` itself |
| Version resolution, APK download, releases, catalog, request bot | **Us** | **Free choice.** This is the "glue" |
| Portal | **Us** | Free choice (static site) |

So the real question is only: **which language for the glue + portal?**

## 2. What Morphe CLI already gives us

Today `morphe-desktop-<v>-all.jar patch` supports:
- `-p <file|dir|github url>` (repeatable, multiple bundles in one run)
- input `.apk`, `.apkm`, `.xapk`, `.apks` (no need for our own split merging)
- `--keystore …` signing, `--striplibs arm64-v8a`
- `-e/-d` enable/disable patches, `-O` options, `--options-file`
- `-r result.json` (applied + failed patches as JSON, so no log scraping)
- `list-patches --with-packages --with-versions` (compatible versions, which tells us which APK version to fetch)

Our glue shrinks to: **pick version → download APK → call CLI → publish → update catalog.**

## 3. The hard part is APK downloading, not the language

| Source | Specific older version? | Works from GitHub runners? | Notes |
|---|---|---|---|
| Google Play | **No, latest only** | Yes (token) | Patches usually target an *older* version (e.g. YouTube 20.51.39), so Play often can't give the right one. Account ToS risk. |
| APKMirror | Yes, best catalog | **Unreliable**: Cloudflare blocks datacenter IPs at times | |
| APKPure | Yes | Mostly | JSON API usable |
| Uptodown | Yes | Mostly | HTML scrape |
| APKCombo | Partly | Sometimes blocked | |
| `apkeep` (EFF, Rust, 2.1k★, active) | APKPure / F-Droid by version; Play latest | Yes | Prebuilt binary, usable from any language |

**Tested 2026-10-24 (from a home IP):**
- APKMirror: version pages load, download pages return a Cloudflare challenge. Not used (we don't automate around bot checks).
- Uptodown: has full version history, but downloads now sit behind a Cloudflare Turnstile CAPTCHA. Not used.
- APKPure API: works, but only lists the latest 20 releases (YouTube 21.20.405 no longer listed).
- **Google Play direct (via `goopdl`, anonymous token): works, and serves older version codes.** YouTube 21.20.405 (vc 1561173354) base + 3 splits in ~22 s → Morphe patched it in ~8 s: 104 patches applied, 0 failed. The shared anonymous token dispenser often returns HTTP 429, so CI should retry and ideally use our own throwaway Google account token.

**Decision: Google Play is the primary source**, APKPure API is the fallback for recent versions, manual APK URL input is the last resort.

Implications:
- We need **several sources with fallback**, plus verification of package name, version and original signature (stops tampered downloads).
- None of this favours Python specifically. HTTP + HTML/JSON parsing is equally good in TS, Go, Python.

## 4. Glue language options

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **TypeScript (Node)** | **One language for glue + portal + request bot + Actions scripts**; Node is preinstalled on runners; `fetch`, `cheerio` (HTML), `octokit` (GitHub API), `zod` (config validation); strong typing of config/manifest; `actions/github-script` for the request bot | Node dependency install (~5 s with cache) | **Recommended** |
| Python | Good scraping libs | Second language next to the portal (TS/JS); weaker typing; requirements/venv handling | Fine, not better |
| Kotlin (JVM) | Same runtime as patcher; could call `morphe-patcher` library directly instead of CLI | Library API is internal and changes often (CLI is the stable interface); slow builds/startup; portal still needs TS | Not worth it |
| Go | Single static binary, fast, great concurrency | Portal still TS; more code for HTML scraping; nothing to gain at 7–17 apps | Overkill |
| Bash + jq | Zero deps | Scrapers/fallbacks/retries become fragile | No |
| Rust | Fast, `apkeep` is Rust | Heavy dev cost for glue | No |

Performance is irrelevant for choosing: each build job is ~95% APK download + Java patching; glue overhead is seconds in any language.

## 5. Portal options (static, GitHub Pages)

| Option | Notes | Verdict |
|---|---|---|
| **Astro** | Static-first, ships ~zero JS, reads our JSON at build time, TS-native | **Recommended** |
| Vite + React | More JS shipped for a mostly static page | OK |
| Plain HTML generated by script | Smallest, but templating by hand gets messy | OK for MVP |
| Hugo / 11ty | Fast; Hugo is Go templates (another language) | No real gain |

## 6. Alternative architectures considered

| Idea | Why not (now) |
|---|---|
| On-device patching with Morphe Manager (no CI at all) | Each phone patches itself; no portal/Obtainium feed; user wants central builds |
| Docker image built once, run in Actions | Adds image build/push; `setup-java` + cached jar is already ~10 s |
| Self-hosted runner on Coolify | Puts load back on the home server; free hosted runners suffice |
| Cloudflare Workers/R2 for portal/storage | Extra account; GitHub Pages + Releases are free and enough |

## 7. Recommended stack

| Layer | Choice |
|---|---|
| Patching | Morphe Desktop CLI jar, **Java 21** (Temurin via `actions/setup-java`), version pinned + cached |
| Glue / CLI tool | **TypeScript on Node 22 LTS**, run with `tsx` (no build step), `zod`, `cheerio`, `octokit` |
| APK download | Own TS fetchers (APKMirror, APKPure, Uptodown, APKCombo, GitHub) + optional `apkeep` binary for Play/APKPure |
| CI | GitHub Actions, `ubuntu-latest` only |
| Storage | GitHub Releases |
| Portal | **Astro** on GitHub Pages, custom domain `apk.iamwaqargulzar.com` |
| Request bot | Issue form + `actions/github-script` / our TS tool |
| Config | YAML per app, validated by zod schemas |
| Tests | Vitest |

Local dev needs **Java 21** (this machine has 17) and **Node 22**.
