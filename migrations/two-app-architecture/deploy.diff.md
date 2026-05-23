# scripts/deploy.sh — changes for the two-app cutover

Two additions, both inserted **between** the existing `[4/6] Build
frontend` block and the existing `[5/6] S3 bucket + upload` block.

The first copies the marketing landing into `dist/` so it sits at the
root (Vite's build now lives at `dist/app/`, leaving `dist/` empty at
the top level). The second drops the SW eviction shim at `dist/sw.js`
so browsers carrying the old root-scope SW clean up on their next visit.

After these changes, the existing `aws s3 sync dist/ s3://$BUCKET
--delete` line at line 433 sweeps the whole tree to S3 in one shot —
no separate sync commands, no race conditions, atomic-ish from S3's
perspective.

---

## Where the edits go

**Find this block** (around lines 390-401):

```bash
# ───── [4/6] Build frontend ─────────────────────────────────────────────────
echo "▶ [4/6] Building frontend"
# Bake the Cognito identifiers + API URL + VAPID public key into the
# bundle. These are public values (anyone inspecting the JS bundle can see
# them); not secrets. The VAPID PRIVATE key stays Lambda-side only.
VITE_API_URL="$API_URL" \
VITE_COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-}" \
VITE_COGNITO_APP_CLIENT_ID="${COGNITO_APP_CLIENT_ID:-}" \
VITE_COGNITO_REGION="${COGNITO_REGION:-ap-southeast-2}" \
VITE_COGNITO_HOSTED_UI_DOMAIN="${COGNITO_HOSTED_UI_DOMAIN:-}" \
VITE_VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}" \
  npm run build --silent
```

**Insert AFTER it, BEFORE the `# ───── [5/6] S3 bucket + upload ─────`
line**, this new block:

```bash
# ───── [4.5/6] Compose the two-surface layout ───────────────────────────────
# After vite build (with base: '/app/' + outDir: 'dist/app'), dist/ looks
# like this:
#   dist/
#     app/
#       index.html, sw.js, manifest.webmanifest, assets/, locales/, ...
#
# Now we add the marketing landing on top so the final layout is:
#   dist/
#     index.html              ← marketing landing (Claude Design)
#     sw.js                   ← eviction shim (clears old root-scope SW)
#     <landing assets>        ← images/fonts inlined by Claude Design
#     app/
#       index.html, sw.js, manifest.webmanifest, assets/, locales/, ...

echo "▶ [4.5/6] Layering marketing landing + SW shim into dist/"

LANDING_SRC="migrations/two-app-architecture/landing-from-claude-design"
if [[ ! -f "$LANDING_SRC/index.html" ]]; then
  echo "✗ Landing not found at $LANDING_SRC/index.html"
  echo "  Unzip the Claude Design output into that directory before deploying."
  exit 1
fi

# Copy every file from the landing folder into dist/ root. The landing's
# index.html, landing-styles.css, landing-demo.js, assets/ etc. all land
# alongside dist/app/.
cp -R "$LANDING_SRC"/. dist/

# Strip the meta files that ride along inside the landing folder but
# shouldn't ship to the live site:
#   - DEPLOY.md is Claude Design's own deployment notes (not for visitors)
#   - .gitkeep is our placeholder so the directory survives in git when
#     the landing isn't unpacked yet
# Using `rm -f` over an `rsync --exclude` chain because rsync isn't
# guaranteed on Git Bash for Windows; cp + rm is universally available.
# `-f` silences "no such file" if the user already removed them manually.
rm -f dist/DEPLOY.md dist/.gitkeep

# Drop the SW eviction shim at dist/sw.js, overwriting anything Vite's PWA
# plugin might have put there (it shouldn't — vite-plugin-pwa now writes
# its SW under dist/app/sw.js because of the base rewrite). The shim is
# idempotent and safe to deploy on every run.
cp "migrations/two-app-architecture/public-sw-shim.js" dist/sw.js

echo "  • landing files: $(find "$LANDING_SRC" -type f | wc -l | tr -d ' ')"
echo "  • sw shim:        dist/sw.js (evicts old root-scope SW)"
```

---

## CloudFront's 404 handler — one manual change

The existing `deploy.sh` configures the distribution's
`CustomErrorResponses` to rewrite 403/404 → `/index.html`. With the
two-app architecture, this is actually fine for the marketing landing
(typos like `/parking` bounce to the landing — acceptable). **But**
inside the React app at `/app/`, that same rewrite would bounce a stale
deep link to the *marketing* landing instead of the app shell.

The React app doesn't use URL routing (App.tsx is a state machine), so
this only fires if someone hand-types a wrong `/app/...` URL. Acceptable
for v1.

If you ever add React Router or hash-based deep links inside `/app/`,
you'll need to set up a CloudFront Function that conditionally rewrites
404s based on path prefix: `/app/*` → `/app/index.html`, else →
`/index.html`. That's a v2 problem, not a cutover blocker.

**No deploy.sh change required for CloudFront error handling on cutover
day.** If you decide later to switch, do it in the AWS Console under
the distribution's "Error pages" tab — distribution config is hard to
edit programmatically once it exists.

---

## Sanity check after editing

After saving the edited `deploy.sh`:

```bash
# Don't actually deploy yet — just run the build and verify the layout.
bash scripts/deploy.sh
```

…actually, the script doesn't have a `--dry-run`. The safest manual
check is to inspect `dist/` after a `npm run build`:

```bash
npm run build
ls dist/                      # should show: app/ index.html sw.js asset_*.png ...
ls dist/app/                  # should show: index.html sw.js manifest.webmanifest assets/ ...
```

If `dist/app/index.html` exists AND `dist/index.html` exists AND they
have different content (one is the React app shell, the other is the
marketing landing), you're set. Run `deploy.sh` to push to production.
