# ParkProof Landing Page · S3 + CloudFront deployment

This bundle is a static site. Drop it into your existing S3 + CloudFront setup
the same way you deploy the current parkproof.com.au.

## Files

```
index.html              ← the page itself (was "Landing Page.html")
landing-styles.css      ← stylesheet
landing-demo.js         ← hero phone animation
assets/                 ← logo, sign photo, app screenshots, etc.
```

## Deploy via AWS CLI

```bash
# from inside the bundle folder
aws s3 sync . s3://YOUR-BUCKET-NAME \
  --delete \
  --exclude "*.DS_Store" \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

# index.html with a shorter cache so deploys propagate fast
aws s3 cp index.html s3://YOUR-BUCKET-NAME/index.html \
  --cache-control "public,max-age=60,must-revalidate" \
  --content-type "text/html; charset=utf-8"

# CloudFront invalidation so visitors see it immediately
aws cloudfront create-invalidation \
  --distribution-id YOUR-CF-DISTRIBUTION-ID \
  --paths "/index.html" "/landing-styles.css" "/landing-demo.js"
```

## Notes

- All paths are relative — works at any URL prefix.
- `index.html` is the default root object; configure your S3 bucket /
  CloudFront origin to serve it at `/`.
- Page loads ~1.3 MB of compressed PNGs (the app screenshots in the hero
  demo). If page weight matters, convert them to AVIF/WebP after deploy.
- Fonts (Fraunces, Inter, JetBrains Mono) load from Google Fonts. No
  bundling required.

## Verifying after deploy

1. Visit parkproof.com.au — confirm the new hero with the phone-cycling demo.
2. Scroll through 7 sections: hero · the problem · how it works · reasoning ·
   evidence · privacy · final CTA.
3. The PDF screenshot in the Evidence section should display the real
   ParkProof — Parking Evidence document.

## Reverting

Keep a tagged S3 version of your previous index.html before this deploy.
S3 versioning + a single CLI restore returns to the old landing in seconds.
