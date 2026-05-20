# ParkProof — Testing Strategy

> Not a coverage-percentage game. A *risk-targeted* test suite that defends
> the parts of the system that would actually hurt users if they broke.

## What we test, and why

The test suite is intentionally narrow. Each file in the table below was
selected because a silent regression there would manifest as user-visible
harm — a wrong leave-by time, a saved session that vanishes under quota
pressure, a timezone shift on the evidence PDF that undermines its legal
standing. The cost of writing the test is small; the cost of *not* having
the test is paid by a real user with a real ticket.

| Module | Why it's tested | Risk if it breaks |
|---|---|---|
| `lib/countdown.ts` | Pure-function minute/hour math drives every active-session colour, the result-card urgency band, and the home countdown card | "Move now" shown when there's still an hour left, or the reverse |
| `lib/storage.ts` | 3-phase localStorage quota recovery — strip car photo → strip sign photo → evict expired session | New session save silently fails on a phone with ~5MB of stored data; user thinks they logged it, didn't |
| `lib/time-format.ts` | Timezone-aware date formatting (DST boundaries, multi-day expiry, midnight wrap) | PDF says "expires Mon 18 May" when it expires "Mon 19 May" — a council reviewer reads this as inconsistent evidence |
| `lib/walk-back.ts` | Haversine distance + walk-time ETA | User walks to the wrong block at 11pm because the card said "120m away" when it was 1.2km |
| `lambda/index.js` (refresh-mode) | Text-only reasoning over prior rules — same prompt as fresh translate but no vision call. Pure logic, easy to test, high stakes (this path skips the human visual sanity check) | Smart re-scan returns wrong can_park_now on a session the user trusts to be "the same as last time" |

## What we deliberately don't test

These are exclusions on purpose, not gaps to backfill:

- **React component rendering details.** Testing that `<button>` renders text is theatre. The DOM is already tested by React itself; our test would just couple us to JSX structure and slow down refactors.
- **Snapshot tests.** Same reason — they fail on any markup change and teach nothing about whether the feature works.
- **The actual Claude API call.** Mocking the model defeats the test (you're testing the mock). The model's behaviour is exercised by smoke-test scripts and live feedback events, not unit tests.
- **End-to-end browser flows.** `scripts/screenshots.mjs` (Playwright) already drives every screen for documentation purposes. Layering an E2E test framework on top would be premature.
- **AWS-side things (DynamoDB, S3, Cognito).** These are AWS's job to keep working. Our smoke-test-auth script verifies our use of them is wired correctly; that's enough until we have real users.

## Running tests

```bash
npm test               # one-shot
npm run test:watch     # auto-rerun on file change (TDD mode)
npm run test:coverage  # generates HTML report at coverage/index.html
```

CI runs `npm test` on every push to `main` (see `.github/workflows/test.yml`).
The badge in the README reflects the latest run.

## File layout

Tests live next to source as `*.test.ts` — Vite/Vitest convention. The
co-location is deliberate: when you refactor `countdown.ts`, the test file
shows up in the same git diff, and the failure case is one keystroke away.

```
src/lib/
  countdown.ts
  countdown.test.ts          ← complete
  storage.ts
  storage.test.ts            ← skeleton, fill in tomorrow
  time-format.ts
  time-format.test.ts        ← skeleton
  walk-back.ts
  walk-back.test.ts          ← skeleton

lambda/
  index.js
  refresh.test.ts            ← skeleton — tests the refresh-mode pure
                               text reasoning path
```

## Philosophy in one paragraph

A test suite is a *promise to your future self*. The promise it makes is
"if you change this, you'll be told if you broke a thing the user cares
about". Anything more than that is overhead. Anything less is theatre. The
right size for a portfolio-grade MVP is "covers the failure modes a senior
engineer would worry about, plus a CI badge that says it's green". This
suite is sized exactly to that.
