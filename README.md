# apk-builds

Automated patched Android builds, made with GitHub Actions and published to
[Releases](../../releases). Portal: <https://apk.iamwaqargulzar.com> (coming soon).

| App | Package | Patches |
|---|---|---|
| YouTube | `com.google.android.youtube` | [MorpheApp/morphe-patches](https://github.com/MorpheApp/morphe-patches) |

YouTube needs [MicroG-RE](https://github.com/MorpheApp/MicroG-RE) installed to sign in with a Google account.

## How it works

1. `apps/<id>.yml` says which app to build and with which patch source (`sources/<id>.yml`).
2. The build picks the newest app version the patches support, downloads it from Google Play,
   patches it with the Morphe CLI, signs it with this project's key and creates a release.
3. Builds run daily and on demand (Actions → Build → Run workflow).

## Local use

Needs Node 22+, Java 21, [uv](https://docs.astral.sh/uv/) and `zip`.

```bash
npm ci
npm run apkb -- versions youtube
KEYSTORE_PATH=... KEYSTORE_PASSWORD=... KEY_ALIAS=... KEY_PASSWORD=... \
  npm run apkb -- build youtube --no-release
```

## License

The build tooling in this repository is MIT licensed. Released APKs are built with
third-party GPLv3 patches; each release includes their [NOTICE](NOTICE).
