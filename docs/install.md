# Install it on your phone

The app isn't in the App Store or Play Store. You build it yourself with GitHub Actions, which takes one command and about 10 to 20 minutes. You need the [`gh` CLI](https://cli.github.com/) installed and signed in (`gh auth login`).

GitHub builds the latest commit on `main` that you've pushed, so push your changes first.

## Before you build: the sync server

You sign in to use the app, and sign-in goes through a Cloudflare Worker. The build uses the server set in `expo.extra.apiBaseUrl` in `mobile/app.json`, which points at the repo owner's server. To use your own, set up a free Cloudflare account and deploy the Worker first. [development.md](development.md#run-your-own-sync-server) walks through it. You don't need an API key: Wrangler signs in through your browser.

## iPhone

```bash
cd mobile
npm run ipa:gh
```

This downloads an unsigned `.ipa` into `mobile/builds/`. To install it:

1. Open [Sideloadly](https://sideloadly.io/) (or a similar tool) and connect your iPhone.
2. Drop in the `.ipa` and sign in with your Apple ID. A free one works.
3. When it asks about the app extension (`RestTimerWidget`, the Live Activity), keep it. It uses one more App ID.

With a free Apple ID, the app stops opening after 7 days. Install it again to renew it. Your data stays on the phone.

## Android

```bash
cd mobile
npm run apk:gh
```

This downloads a `.apk` into `mobile/builds/`. It's already signed, so you can install it straight away: copy it to the phone and open it, or run `adb install <file>.apk`.

## Good to know

- Each run replaces the previous `.ipa` or `.apk` in `mobile/builds/` (gitignored).
- To build the Debug variant instead, start the workflow by hand from the Actions tab on GitHub.
- To build with Expo's EAS service instead, see [development.md](development.md#eas).
