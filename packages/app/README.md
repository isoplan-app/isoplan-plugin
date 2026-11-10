# Isoplan desktop app

The machine's runner as a desktop app (ADR 0007, 8 Nov update): an [Electrobun](https://electrobun.dev) app whose Bun main process supervises the runner's worker and shows the Isoplan icon in the Windows tray or the macOS menu bar. The menu says whether Isoplan is running and each office's link, with the email of the person who approved this computer's pairing with it (`connected as …`), and lists this computer's sessions: a headless one has a submenu this computer's runner acts on over its pipe: one driven from the floor has Close session, which ends its process as the floor's Close session does (the floor's next instruction opens it again), and End and remove, which also removes it, so it is never opened again and its agent leaves the floor; a fork or a take's first turn has Close. One in a terminal or the Claude app is only listed. It has Open pairing… and Quit. It opens no window by itself.

- `src/bun/engine.ts`: the supervisor. It takes the runner's lock (stopping a node runner first) and runs the runner copy the plugin installs, `<claude dir>/isoplan/runner/app/dist/runner.mjs --worker`, on the app's own Bun. So a plugin update brings new runner code without a new app release.
- `src/bun/menu.ts`: what the menu and the pairing window say, from `runner/status.json` (`packages/mod/src/runner/status.ts`).
- `src/bun/index.ts`: the tray and the pairing window. `src/pairing/`: the window (Vue).
- The plugin installs it (`packages/mod/src/install/app.ts`). `packages/mod/app-release.json` names the app version the plugin wants. Without one for the computer, the runner runs on node as before.

Its settings are in `packages/mod/runner.json`, and a person can override them in `~/.claude/isoplan/runner.json`: `desktopApp` (false keeps the runner on node), `appDownloadSeconds`, `appRetryHours`, `appStartSeconds`, `officeUnreachableSeconds`, `trayRefreshSeconds`, and `drivenCloseSeconds`: a Close, Close session or End and remove from the menu waits twice that, or twice the 10 s a driven session gets to end if that is longer. It logs to `~/.claude/isoplan/logs/app.log`.

If the app doesn't become the runner within `appStartSeconds` of being opened (blocked by Defender, SmartScreen or Gatekeeper, say), or its runner keeps crashing on its Bun, the plugin runs the runner on node instead and says why in `~/.claude/isoplan/logs/runner.log`. It doesn't open that app version again for `appRetryHours`, or until another version is installed.

## Build it locally

```sh
pnpm install
cd packages/app
npx electrobun prepare    # projects Electrobun's toolchain into .hutch/
pnpm test                 # the engine and the menu
pnpm run typecheck:app    # the Electrobun parts too
pnpm run build:app        # unsigned build: artifacts/<channel>-<os>-<arch>-Isoplan*.tar.zst
```

Use PowerShell on Windows, not Git Bash, whose `tar` breaks Electrobun's fallback installer. If GitHub answers 504 when the toolchain downloads, set `ELECTROBUN_RELEASES_BASE_URL` to a mirror. The root `pnpm build` doesn't build the app.

## Release it

1. Bump `version` in `packages/app/package.json`, and set the same version in `packages/mod/app-release.json` so the plugin asks for it. The plugin version that carries the change is what rolls it out.
2. Publish a release tagged `app-v<version>`:

   ```sh
   gh release create app-v0.1.0 --repo isoplan-app/isoplan-plugin --title "Desktop app 0.1.0" --notes "..."
   ```

`.github/workflows/app-release.yml` builds Windows on `windows-latest` and macOS on the self-hosted MacBook, in two independent jobs. It signs each when its secrets are set; without them, it builds unsigned and says so in a warning. Each job uploads its own files to the release as soon as it is done, so Windows doesn't wait for the Mac: `isoplan-app-<version>-<platform>-<arch>.tar.gz`, its `.sha256`, and last `isoplan-app-<platform>-<arch>.json`, the manifest the plugin reads. Until a platform's manifest is there, its machines keep the runner on node and try again after `appRetryHours`.

Only one Mac build runs at a time. The macOS job is in the concurrency group `app-release-mac`, which cancels an older Mac build, queued or running, when a newer release starts one. The Windows job has no such group.

### Rebuild one platform

GitHub drops a job that waits more than 24 hours for the self-hosted Mac, for example while the MacBook is off. To build it again for the release that exists, run the workflow by hand with the app's version and the platform (`windows`, `macos` or `both`):

```sh
gh workflow run app-release.yml --repo isoplan-app/isoplan-plugin -f version=0.1.0 -f platform=macos
```

It builds the `app-v<version>` tag and replaces that platform's files on the release.

## One-time setup

### The MacBook as a self-hosted runner

The macOS build runs on `runs-on: [self-hosted, macOS, isoplan]`.

1. On the MacBook, install the Xcode command line tools: `xcode-select --install`. They provide `codesign`, `iconutil` and `xcrun notarytool`. Install the GitHub CLI too (`brew install gh`), which uploads the build to the release; it needs no sign-in, as the workflow gives it its token. Node comes from the workflow.
2. On GitHub, open isoplan-app/isoplan-plugin → Settings → Actions → Runners → New self-hosted runner. Pick macOS and the MacBook's architecture (x64 for the Intel MacBook), and run the download and `config.sh` commands it shows, adding the label:

   ```sh
   ./config.sh --url https://github.com/isoplan-app/isoplan-plugin --token <token from that page> --labels isoplan --name isoplan-macbook
   ./svc.sh install && ./svc.sh start    # runs it as a service, so it survives a restart
   ```

   To register it on the organisation instead, use isoplan-app → Settings → Actions → Runner groups. Put it in a group that is restricted to the isoplan-plugin repository, with "Allow public repositories" on and "Selected workflows" limited to `.github/workflows/app-release.yml`.
3. Restrict it. The repository is public, so keep code from strangers off the MacBook. Under Settings → Actions → General → "Fork pull request workflows from outside collaborators", choose "Require approval for all external contributors". No workflow here runs on pull requests, and only `app-release.yml` asks for the `isoplan` label.

The MacBook builds for its own CPU, so an Intel MacBook makes `darwin-x64` only. Apple Silicon Macs keep the runner on node until a `darwin-arm64` build is added.

### Secrets

Add these under isoplan-app/isoplan-plugin → Settings → Secrets and variables → Actions, or with `gh secret set <NAME> --repo isoplan-app/isoplan-plugin`. Windows signs only when both of its secrets are set. macOS signs when the .p12 and its password are set, and notarizes only when the three App Store Connect secrets are set too.

**Windows (code signing certificate)**

| Secret | What it is | How to make it |
| --- | --- | --- |
| `WINDOWS_CERT_PFX_BASE64` | The code signing certificate with its private key, as a .pfx, base64-encoded | Export the certificate as .pfx with its private key (certmgr.msc → Personal → the certificate → All Tasks → Export → Yes, export the private key). Then, in PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) \| gh secret set WINDOWS_CERT_PFX_BASE64 --repo isoplan-app/isoplan-plugin` |
| `WINDOWS_CERT_PASSWORD` | The password set on that .pfx when it was exported | `gh secret set WINDOWS_CERT_PASSWORD --repo isoplan-app/isoplan-plugin` (it asks for the value) |

signtool signs `launcher.exe`, `bun.exe`, `bspatch.exe`, `zig-zstd.exe`, `ElectrobunCore.dll`, `libNativeWrapper.dll`, `libasar.dll` and `Resources\uninstall`, timestamped with DigiCert. A certificate that lives on a hardware token or in a cloud HSM can't be exported as a .pfx. Signing with one needs a different signing step.

**macOS (Developer ID and notarization)**

| Secret | What it is | How to make it |
| --- | --- | --- |
| `MAC_DEVELOPER_ID_P12_BASE64` | The "Developer ID Application" certificate with its private key, as a .p12, base64-encoded | Create the certificate at developer.apple.com → Certificates → + → Developer ID Application, and install it. Then in Keychain Access, select it under My Certificates, choose File → Export Items, and save it as .p12 with a password. Upload it with `base64 -i devid.p12 \| gh secret set MAC_DEVELOPER_ID_P12_BASE64 --repo isoplan-app/isoplan-plugin` |
| `MAC_DEVELOPER_ID_P12_PASSWORD` | The password set on that .p12 | `gh secret set MAC_DEVELOPER_ID_P12_PASSWORD --repo isoplan-app/isoplan-plugin` |
| `APPLE_TEAM_ID` | The ten-character team ID. The workflow checks that the certificate is this team's | developer.apple.com → Account → Membership details |
| `ASC_KEY_ID` | The App Store Connect API key's ID, which notarization uses | App Store Connect → Users and Access → Integrations → App Store Connect API → + (Developer access is enough). The Key ID column |
| `ASC_ISSUER_ID` | The issuer ID shown above that list of keys | Same page |
| `ASC_PRIVATE_KEY_BASE64` | The key's `AuthKey_<id>.p8`, which can be downloaded only once. Give the file itself or the file base64-encoded | `base64 -i AuthKey_XXXX.p8 \| gh secret set ASC_PRIVATE_KEY_BASE64 --repo isoplan-app/isoplan-plugin` |

The workflow imports the certificate into a throwaway keychain, the only one searched while the job runs, and deletes the keychain, the .p12 and the .p8 at the end, even when the build or the import fails. Electrobun signs the app with it (`ELECTROBUN_DEVELOPER_ID`), then notarizes and staples it with the API key. If the certificate is set but the API key isn't, the app is signed but not notarized.

## Memory

Electrobun issue #571 reports a Windows tray app whose memory grew over days. We watch the app's memory until the first signed release. On Windows, check `bun.exe` under `%LOCALAPPDATA%\Programs\Isoplan`. On macOS, check `Isoplan`.
