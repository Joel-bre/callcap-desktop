# Callcap Desktop Recorder

Electron app that records both sides of a call (microphone + system audio) and uploads to your Callcap account.

## One-time setup (5 minutes)

1. Install the GitHub CLI: https://cli.github.com (`brew install gh` on macOS).
2. Sign in once: `gh auth login` → GitHub.com → HTTPS → browser.
3. From inside this `desktop-recorder/` folder, run:

   ```bash
   ./bootstrap.sh
   ```

   That creates the public `callcap/desktop` repo, pushes the code, and tags `v0.1.0` — which kicks off the GitHub Actions workflow that builds the macOS / Windows / Linux installers and publishes them as a GitHub Release. Watch progress at `https://github.com/callcap/desktop/actions`.

4. (Optional, macOS only) Add repository secrets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD` to enable signing + notarization. Without them the macOS build is unsigned (users right-click → Open the first time).

## Cutting a release

After the first bootstrap, future releases are just a new tag from inside the cloned `callcap/desktop` repo:

```bash
git tag v0.1.1
git push --tags
```

GitHub Actions builds installers for macOS / Windows / Linux and publishes a GitHub Release with:
- `Callcap.dmg` (macOS)
- `Callcap-Setup.exe` (Windows, unsigned)
- `Callcap.AppImage` (Linux)

The dashboard's `/download` page points at `releases/latest/download/...` so it always serves the newest build.

## Local dev

```bash
npm install
npm start
```

## How pairing works

1. User opens dashboard → `/pair` → clicks "Pair this device".
2. Browser opens `callcap://pair?token=<short-lived-token>`.
3. OS hands the URL to this app (registered protocol handler).
4. App POSTs the token to `/api/public/recorder/pair` → receives long-lived `device_token`.
5. Token is stored in `app.getPath('userData')/config.json` and used as `Bearer` on every upload.