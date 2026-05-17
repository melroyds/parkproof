# Screenshot fixtures

Inputs consumed by `scripts/screenshots.mjs`. Re-running `npm run screenshots`
re-uses whatever is in this directory — no rebuild needed when you swap a fixture.

| File | What it's for | How to replace |
|---|---|---|
| `parking-sign.jpg` | The "uploaded sign photo" injected via `input.setInputFiles()` on the scan screen, then echoed back through clarify, result, session-detail, and the appeal-flow ticket-capture step. A real Melbourne parking sign with stacked rules (`Permit Zone` + `1/4P` + `2P`) so the mocked Claude clarification (`mockTranslateResponse()`) reads as honest. | Drop a different photo at the same filename. JPG/JPEG/PNG all accepted — the script tries `parking-sign.{jpg,jpeg,png}` in that order. Portrait orientation reads best in the "View the photo" expander. |
| `car-photo.jpg` | The "car-at-the-spot" photo injected on the Session Logger screen so the saved session has both a sign and a car (PDF evidence + Session Detail both reference it). Used for any portrait-vehicle shot of a parked car. Rego on the source image was blurred before commit. | Replace at the same filename. If you swap in a photo with a visible rego plate, **redact it first** — the repo is public. The blur in the committed copy was applied with Pillow's `GaussianBlur` over a hand-fitted box. |
| `ticket.jpg` | The "infringement notice" photo injected on the Appeal Flow ticket-capture step. Used to demonstrate the AI-drafted-appeal pipeline against a real-looking council notice. Personal data (infringement number, rego, officer ID, date, location) was blurred before commit. | Replace at the same filename. If the new ticket has identifying detail, **redact it first**. Suburb, council name, code, penalty amount, and due date can stay — they're not personally identifying. |

The mocked Claude API responses (`mockTranslateResponse()` + `MOCK_APPEAL_DRAFT`),
geocode response, and pre-seeded localStorage fixtures all live inline in
`scripts/screenshots.mjs` rather than separate files — they're tiny and easier
to edit alongside the flow they belong to.
