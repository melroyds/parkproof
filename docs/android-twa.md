# Android (Play Store) via Trusted Web Activity

The July plan is **Android before Apple.** ParkProof is already an installable
PWA; a Trusted Web Activity (TWA) wraps it in a thin native shell for a Play
Store listing with **no rewrite** — the PWA at `/app/` stays the single source
of truth. iOS follows later (the App Store review bar and the address-disclosure
surface make it the second step, not the first).

## Why TWA, not a native rebuild or a WebView

- A TWA is Chrome rendering the live PWA full-screen with no browser chrome, _if_
  Digital Asset Links verify the app owns the domain. It is not a WebView (no
  cookie/storage split, no "this is a webpage" banner).
- Updates ship by deploying the PWA, the same `scripts/deploy.sh` flow. The Play
  build only changes when the shell config or icons change.
- Cost is a one-time $25 Play Console registration + the build below.

## Build steps (Bubblewrap)

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://www.parkproof.com.au/app/manifest.webmanifest
#   host:        www.parkproof.com.au
#   start path:  /app/
#   app name:    ParkProof
#   package id:  au.com.parkproof        (matches the au.com.parkproof.* Apple IDs)
#   theme/bg:    brand #275BFF / paper #F2F4F7  (match the web manifest)
bubblewrap build          # produces app-release-signed.apk + .aab and a signing key
```

Keep the generated signing keystore safe and out of git (it's the app identity;
losing it means you can never update the listing).

## The one gotcha: Digital Asset Links

The TWA only goes chrome-less if the domain serves an `assetlinks.json` that
matches the app's signing-key SHA-256 fingerprint. After `bubblewrap build`:

1. Get the fingerprint: `bubblewrap fingerprint` (or from Play Console once the
   AAB is uploaded — prefer the **Play App Signing** key fingerprint).
2. Publish it at **`https://www.parkproof.com.au/.well-known/assetlinks.json`**:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "au.com.parkproof",
       "sha256_cert_fingerprints": ["<SHA256 from step 1>"]
     }
   }]
   ```
   That path is served by the same private-S3-behind-CloudFront origin as the
   rest of the site; add the file to `dist/.well-known/` in `deploy.sh`'s landing
   layer step (alongside where `sw.js` / the landing files are copied), so the
   `aws s3 sync` ships it. The CloudFront URI-rewrite function must NOT rewrite
   `/.well-known/*` to `index.html` — verify that path passes through.
3. Without a matching assetlinks.json the app still works, but Chrome shows the
   URL bar (the "this is a website" tell). It's the single most common TWA miss.

## Decisions to make before publishing

- **Address disclosure.** The Play listing exposes a developer name/address by
  default; the role alias and de-identification work done for the web (see
  CLAUDE.md) should carry to the Play account.
- **Permissions.** The TWA inherits the PWA's camera + geolocation prompts; no
  extra Android permissions are needed. Don't add any, the listing copy can lean
  on "no tracking, anonymous by default."
- **What stays web-only.** Web Push already works through the PWA service worker;
  the TWA does not need FCM. Keep the push pipeline as-is.

## Not in scope for this step

- App Store / iOS (second step).
- Any native code beyond the generated shell.
- A separate Android codebase — there isn't one, and that's the point.
