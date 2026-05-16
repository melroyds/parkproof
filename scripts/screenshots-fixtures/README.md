# Screenshot fixtures

Inputs consumed by `scripts/screenshots.mjs`. Re-running `npm run screenshots`
re-uses whatever is in this directory — no rebuild needed when you swap a fixture.

| File | What it's for | How to replace |
|---|---|---|
| `parking-sign.png` | Fake "uploaded sign photo" injected via `input.setInputFiles()`. Currently a placeholder (a copy of `public/og-image.png`). | Drop a real photo of a Melbourne parking sign here, same filename. Keeps the on-screen "View the photo" expander looking authentic. JPG/JPEG also accepted — the script tries `parking-sign.{jpg,jpeg,png}` in that order. |

The mocked Claude API response, geocode response, and pre-seeded localStorage
fixtures all live inline in `scripts/screenshots.mjs` rather than separate
files — they're tiny and easier to edit alongside the flow they belong to.
