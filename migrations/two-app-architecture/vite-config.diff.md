# vite.config.ts — changes for the two-app cutover

These are the **manual edits** to make to `vite.config.ts` during the
cutover. Until you apply them, the Vite build behaves exactly as it does
today.

Three logical changes:

1. Set `base: '/app/'` so the build emits URLs prefixed with `/app/`.
2. Set `build.outDir: 'dist/app'` so the build's output lands inside an
   `app/` subdirectory of `dist/`, leaving room for the marketing landing
   at `dist/` root.
3. Update the inline PWA manifest's `start_url` and `scope` to `'/app/'`,
   and prefix every icon `src` with `/app/`.

---

## 1. Add `base` and `build` to the top-level config

**Find this** (around line 383):

```ts
export default defineConfig({
  // amazon-cognito-identity-js was written before browser ESM was a thing —
  // ...
  define: {
    global: 'globalThis',
    'process.env': '{}',
  },
  plugins: [
    react(),
    tailwindcss(),
    signTranslateApi(),
    VitePWA({
```

**Replace with**:

```ts
export default defineConfig({
  // The app now ships under /app/ — marketing landing lives at /. Every
  // built URL (asset imports, manifest, SW registration) is rewritten
  // to start with /app/ at build time.
  base: '/app/',
  build: {
    // Park the Vite output in dist/app/ so the marketing landing can
    // sit at dist/ root without colliding. deploy.sh syncs dist/ -> S3,
    // so this naturally puts the React app under s3://bucket/app/.
    outDir: 'dist/app',
    emptyOutDir: true,
  },
  // amazon-cognito-identity-js was written before browser ESM was a thing —
  // ...
  define: {
    global: 'globalThis',
    'process.env': '{}',
  },
  plugins: [
    react(),
    tailwindcss(),
    signTranslateApi(),
    VitePWA({
```

---

## 2. Update the PWA manifest

**Find this** (around line 410):

```ts
      manifest: {
        name: 'ParkProof',
        short_name: 'ParkProof',
        description:
          'Aussie parking, decoded. Photograph a sign, get a plain-English answer, save evidence in case of a wrongful ticket.',
        theme_color: '#275BFF',
        background_color: '#F2F4F7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
```

**Replace with**:

```ts
      manifest: {
        name: 'ParkProof',
        short_name: 'ParkProof',
        description:
          'Aussie parking, decoded. Photograph a sign, get a plain-English answer, save evidence in case of a wrongful ticket.',
        theme_color: '#275BFF',
        background_color: '#F2F4F7',
        display: 'standalone',
        orientation: 'portrait',
        // Two-app cutover: the PWA's installable surface lives under /app/.
        // Installed users always land on the scan flow, never on the
        // marketing landing. Visiting `/` (the landing) doesn't show the
        // install prompt because the manifest's scope excludes it.
        start_url: '/app/',
        scope: '/app/',
        icons: [
          { src: '/app/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: '/app/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/app/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/app/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
```

Note: the icon paths are **absolute** (leading `/`) because the manifest
itself will be served at `/app/manifest.webmanifest`, but the icons are
referenced by the browser from a context where Vite's `base` rewriting
doesn't apply. Absolute paths from the origin root are the safe choice.

---

## Sanity check after editing

Run `npm run build`. Expected output:

```
dist/
  app/
    index.html              ← React app shell
    sw.js                   ← workbox SW (scope /app/)
    manifest.webmanifest    ← start_url: /app/
    assets/
      *.js, *.css           ← chunked JS + CSS
    locales/
      en.json, etc.         ← i18n bundles
    pwa-*.png               ← install icons
    (etc — every static asset that was in dist/ before)
```

If `dist/index.html` exists at the **root** after `npm run build`, you
forgot the `build.outDir: 'dist/app'` line. The build won't fail, but
the cutover deploy will be wrong.

Open `dist/app/index.html` in a text editor — every `<script src="...">`
and `<link href="...">` should start with `/app/`. If any still start
with just `/`, the `base: '/app/'` change didn't take effect.

If both checks pass, you're ready for `deploy.diff.md`.
