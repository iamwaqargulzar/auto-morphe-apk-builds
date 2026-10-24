# APK Builds — Architecture (draft v1)

Portal: **https://apk.iamwaqargulzar.com**
Everything runs on GitHub (public repo, standard runners): **no server, no cost.**

---

## 1. Overview

```
            ┌──────────────────────── GitHub (public repo) ─────────────────────────┐
            │                                                                       │
 schedule ──▶  check.yml ──▶ "what changed?" ──▶ build.yml (matrix, 1 job per app)  │
 manual   ──▶     │            (patch release,       │                              │
            │     │             app version)         ├─ fetch patch tool + patches  │
            │     │                                  ├─ fetch original APK          │
            │     ▼                                  ├─ patch + sign (own key)      │
            │  state/manifest.json ◀── commit ───────┴─ upload to Releases          │
            │                                                 │                     │
            │                     site.yml ◀──────────────────┘                     │
            │                        │ builds static portal                         │
            │                        ▼                                              │
            │                   GitHub Pages ──▶ apk.iamwaqargulzar.com             │
            │                                                                       │
 visitor ──▶  Issue form "Request an app" ──▶ request.yml (checks it can be patched)│
            │                                   └─ you add label `approved` → PR    │
            └───────────────────────────────────────────────────────────────────────┘
 phone ──▶ Obtainium ──▶ reads the repo's Releases directly (one entry per app)
```

## 2. Starter app catalog

| # | App | Package | Patch source | Status |
|---|-----|---------|--------------|--------|
| 1 | YouTube | `com.google.android.youtube` | MorpheApp/morphe-patches (official) | starter |
| 2 | YouTube Music | `com.google.android.apps.youtube.music` | MorpheApp/morphe-patches (official) | starter |
| 3 | Reddit | `com.reddit.frontpage` | MorpheApp/morphe-patches (official) | starter |
| 4 | X / Twitter | `com.twitter.android` | crimera/piko-newx | starter |
| 5 | Instagram | `com.instagram.android` | SysAdminDoc/HushGram | starter |
| 6 | Threads | `com.instagram.barcelona` | SysAdminDoc/HushThreads | starter |
| 7 | Telegram | `org.telegram.messenger` | SysAdminDoc/HushTelegram | starter |

Easy to add later (sources already looked at): Gboard (jasonwu1994/Gboard-patches),
Duolingo / SoundCloud / Proton VPN / CamScanner and ~50 more (hoo-dles/morphe-patches),
Pinterest (SysAdminDoc/HushPinterest), Brave (kveld9).

All builds: **arm64-v8a**, signed with **our own key**.

## 3. Repo layout

```
apps/<app-id>.yml        one file per app: package, patch source, APK sources, patch include/exclude, enabled
sources/<source>.yml     patch repos: owner/repo, asset pattern, tool version
state/manifest.json      last built: app version + patch version + checksum (committed by CI)
tool/                    our TypeScript builder (written from scratch, see STACK.md)
  resolve.ts             pick newest app version the patches support (via `list-patches`)
  fetch/                 APK downloaders (one module per store)
  patch.ts               run Morphe CLI (patch + sign + striplibs), read result JSON
  release.ts             create GitHub release + assets
  catalog.ts             generate site data + obtainium.json
site/                    portal (Astro, static, built in CI → Pages)
.github/
  workflows/check.yml    schedule + manual; decides what to build
  workflows/build.yml    matrix build, one job per app
  workflows/site.yml     rebuild portal after releases
  workflows/request.yml  handle app requests
  workflows/cleanup.yml  keep last N releases per app
  ISSUE_TEMPLATE/request-app.yml
NOTICE                   Morphe NOTICE (required, see §8)
```

## 4. Build pipeline

1. **check.yml** (cron, e.g. daily 02:00 UTC, + "Run workflow" button with inputs `app`, `force`)
   - For each enabled app: latest patch release tag + newest supported app version.
   - Compare with `state/manifest.json` → list of apps that need a build. Nothing changed → stop (≈1 min of runner time).
2. **build.yml** (matrix, runs in parallel, `fail-fast: false`)
   - Download patch tool jar + patch bundle (cached).
   - Download original APK, trying stores in order. We'll write our own fetchers; candidates: APKMirror, APKPure, Uptodown, APKCombo, GitHub. Google Play is optional via a token secret, using a throwaway Google account only.
   - Verify the APK: package name, version, arch, and signature of the original publisher.
   - Patch → if fingerprint errors, retry with the next-older supported version.
   - Sign with our keystore (stored as a repo **secret**, never committed).
   - Release: tag `<app-id>-v<appver>-p<patchver>`, title `<App Name> <appver>`, assets: APK + `NOTICE` + changelog.
3. **finalize** (after matrix): update `state/manifest.json`, commit (also keeps the repo active; GitHub disables cron after 60 idle days), trigger site.yml.
4. **cleanup.yml**: keep the last 3 releases per app.

## 5. Portal (GitHub Pages)

Static site, rebuilt after each build, with custom domain + HTTPS.
- App cards: icon, current version, patch version, build date, Download, **Add to Obtainium** button.
- Per-app page: changelog, applied patches, failed patches, older versions.
- "Import all into Obtainium" (`obtainium.json`).
- "Request an app" → link to the issue form.
- Build status (last run, success/fail per app).

Tech: small static generator (Vite + plain components, or Astro); data comes from JSON produced by `catalog.py`. No backend.

## 6. Obtainium integration

Obtainium reads the GitHub repo directly (no scraping of our site):
- source URL: `https://github.com/<owner>/<repo>`
- `filterReleaseTitlesByRegEx`: `^YouTube \d` (one per app, so a shared repo works)
- `fallbackToOlderReleases`: on
- `apkFilterRegEx`: `\.apk$`
- `versionExtractionRegEx` on the release title → app version

The portal generates one deep-link button per app and one bulk `obtainium.json`.

## 7. App requests (free, no server)

1. Visitor opens **Issues → "Request an app"** (form: app name, package name or Play Store link, optional preferred patch source).
2. **request.yml** runs automatically:
   - extracts the package name,
   - searches the patch lists of known sources for that package,
   - comments: ✅ "supported by X, latest supported version Y" or ❌ "no patches found yet"; labels `supported` / `unsupported`.
3. **You** decide: add label `approved` → workflow opens a PR adding `apps/<app-id>.yml` → you merge → next build includes it.
   Nobody can add apps without your approval.

## 8. Licensing / notices

- Our code: written from scratch, our own license (MIT).
- **Required (not optional):** Morphe patches are GPLv3 with a Section 7b NOTICE that *all derivative binaries must include*. Patched APKs contain their code, so every release ships the `NOTICE` file, and the site links to the patch source repos. Same for the community patch repos (GPLv3).
- Don't use the "Morphe" name/logo as our branding (their 7e trademark clause).

## 9. Cost safeguards

- Repo **public**, runners `ubuntu-latest` only (never "larger runners").
- No payment method on the GitHub account → overage is impossible.
- APKs stored in **Releases** (free); Actions artifacts avoided or set to 1-day retention.
- Incremental builds: only changed apps are built.

## 10. Secrets needed

| Secret | Purpose |
|---|---|
| `KEYSTORE_B64`, `KEYSTORE_PASS`, `KEY_ALIAS`, `KEY_PASS` | signing key (generated once, **back it up**: losing it means users must reinstall) |
| `GPLAY_TOKEN` (optional) | Google Play downloads via throwaway account |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (optional) | build notifications |

## 11. Open decisions

- Repo: `iamwaqargulzar/auto-morphe-apk-builds` (decided).
- Build schedule (daily vs every 2 days; with incremental builds daily is fine).
- Notifications: Telegram, Discord, or none.
- Stack: TypeScript + Astro recommended (see STACK.md), pending confirmation.

## 12. Build order

1. Repo, signing key, secrets, one app (YouTube) end to end → release.
2. Add the other 6 apps + check/incremental logic.
3. Portal + custom domain + Obtainium buttons.
4. Request flow, cleanup, notifications.
