# Sign-reading accuracy eval

A fixed set of real parking sign photos, each labelled by a person with the
right answer, that you can re-run after any change to the prompt, the schema
or the model. It makes "the sign reader is accurate" a measured claim, with
an honest range around it. It complements the in-app feedback telemetry,
which only produces signal once there are real users.

The method and the published numbers live on the public page
`migrations/two-app-architecture/landing-from-claude-design/accuracy/`
(served at `/accuracy/`).

## Run

```bash
cd lambda && npm ci          # one-time: translateSign pulls the AWS SDK from lambda/
cd ..
npm run eval                 # the dev split, one run per photo
npm run eval -- --dry-run    # no model calls: checks the labels and the plumbing
```

Real runs need `ANTHROPIC_API_KEY` in `.env` and cost a few cents per photo
per run. The harness sends each photo through `translateSign` in
`lambda/index.js`, the code the app uses, with the clock pinned to the
labelled moment, so a run is repeatable given the prompt.

| Option | What it does |
|---|---|
| `--split dev\|test\|all` | Which photos to run. Default `dev`. |
| `--runs N` | Read each photo N times (1 to 20). The model can answer differently each time. |
| `--json FILE` | Also write the results as JSON (see "Results file" below). |
| `--dry-run` | No network and no key needed. Answers come from the labels, so every photo should score as right. Use it to check new labels. |
| `--corpus DIR` | Labelled photos somewhere other than `eval/corpus/`. |
| `--show-failures` | Print failure details for the test split too (see the split rule). The JSON never has them. |
| `--verbose` | Keep the sign reader's own timing log lines. |

The report shows each rate with a 95% range, a failure list for the dev
split (your prompt worklist), time per read and cost. Progress prints `.`
for a right answer, `F` for a wrong one and `x` for an error. Test photos
print `-` whatever the result (see the split rule).

Exit codes: 0 when every verdict was right, 1 when any verdict was wrong or a
read errored (so it works as a CI gate), 2 when a label is invalid or an
option is wrong.

## The dev and test split (the rule)

Every photo belongs to one of two sets:

- **dev**: for prompt work. Run it as often as you like, read every failure,
  change the prompt.
- **test**: held out. Never used for prompt work. Only test numbers are
  published.

The rule:

1. Choose the split when you add the photo, before it is ever run. Put about
   one photo in three in `test`, spread across the tags, so the test set has
   the same mix of hard cases as the dev set.
2. Never move a photo between splits after it has been run.
3. Don't run `--split test` while you're changing the prompt. Run it when a
   version is finished, to report it.
4. Which test photos were right or wrong is hidden by default, so it can't
   steer prompt work: the report lists no test failures, the progress line
   prints `-` for every test read, and in the JSON a test photo's row keeps
   only its id, split, tags and number of reads, with no rates by tag.
   Only the totals are reported. `--show-failures` shows everything on
   screen, but the JSON stays cut down even then, because the JSON is what
   gets published. If you do look and then change the prompt because of
   it, those photos are spent: move them to dev and label fresh test photos.

A label with no `split` (every version 1 label) counts as dev, never test.

## Add a photo

1. Take the photo the way a driver would: the whole pole, every plate on it,
   from where you'd stand next to the car. Don't crop out other signs.
2. Keep number plates and faces out of frame, and remove the photo's
   location metadata before committing (for example `exiftool -all= photo.jpg`).
   The label carries the location the reader needs.
3. Resize to at most 1200 px on the long edge, JPEG quality about 80, which
   is what the app sends after `resizeImageFile`.
4. Save it as `eval/corpus/<id>.jpg` and write the label as
   `eval/corpus/<id>.json`. Use a short kebab-case id that says where and
   what: `lygon-st-2p-clearway`.
5. Run `npm run eval -- --dry-run` to check the label.

## Label format (version 2)

```jsonc
{
  "format": 2,
  "id": "lygon-st-2p-clearway",
  "image": "lygon-st-2p-clearway.jpg",
  "split": "dev",                                // "dev" or "test", chosen before any run
  "tags": ["stacked", "clearway", "arrows"],
  "scanContext": {
    "lat": -37.7980,
    "lng": 144.9675,
    "datetime": "2026-05-20T14:30:00+10:00"      // the moment being tested, with the offset
  },
  "expected_variant": ["Right side", "Right"],   // optional: which spot the answer is for
  "expected_sign_status": "readable",            // optional
  "expected": {
    "can_park_now": true,
    "until": "2026-05-20T16:00:00+10:00",        // null = no time to leave by
    "duration_minutes": 90,                      // null = no limit
    "note": "You're on the right of the pole at 2:30 pm Wednesday. The 2P runs to 4:30 pm but the clearway starts at 4 pm, so you leave by 4 pm."
  },
  "expected_flags": {                            // optional: only what you're sure of
    "requires_ticket": true,
    "payment_methods": ["meter", "easypark"],
    "requires_disabled_permit": false,
    "is_permit_zone": false,
    "permit_area": null,
    "is_area_sign": false
  }
}
```

In a format 2 label, `expected.until` and `expected.duration_minutes` are
required: write `null` when there's none, so a missing key can't quietly
switch the leave-by check off.

Version 1 labels (no `format`, `split`, `tags` or `expected_*` fields) still
load, as dev photos, and may leave `until` out. A label the harness can't
score stops the run with exit 2 and says what to fix. Unknown keys print a
warning, so typos show up.

## Labelling rubric

Read the sign as a careful driver would, then write down what the app should
say. If you aren't sure what a sign means, leave the photo out. A label you
couldn't defend is worse than no label.

**Write labels in the second person.** Notes speak to the driver, the way
the app does: "You're on the right of the pole at 2:30 pm. You can stay
until 4 pm, when the clearway starts." Labelling what *you* must do keeps the
label about the question the app answers, not about the sign in the
abstract.

**The moment** (`scanContext.datetime`): pick a time that tests something,
such as just inside a window, just before a clearway, a weekend on a weekday
sign, or overnight before a morning limit. Write the time on the clock at
the spot with that zone's offset on that date (+11:00 in Melbourne in
daylight saving time, +10:00 in Brisbane all year), the way the app sends
it. The reader is told this is the local time, so the harness looks up the
zone from `lat` and `lng` (Melbourne without them, as the app does) and
stops with exit 2 when the offset is wrong for that moment, when the time
is in UTC (`Z`), or when the time never shows on the clock (2:30 am on the
morning daylight saving starts). The message gives the right offset.

**`can_park_now`**: can you leave the car here at that moment? "You can
park" means a driver who meets the sign's conditions can park, for example
by paying or by holding the right permit.

- Paid parking inside its hours: `true` (and `requires_ticket: true`).
- A permit zone or an accessible parking bay in force: `true`, with
  `is_permit_zone` or `requires_disabled_permit` set. The app asks the
  driver to confirm the permit; the answer itself is "you can park".
- No Stopping, No Standing, Clearway, Loading Zone, Bus Zone or Taxi Zone in
  force: `false`.

**`until`**: the earliest moment you'd have to move the car, across every
rule on the pole, to the minute. A time limit runs from the moment (or from
when its window next opens), capped by the next prohibition. `null` when
you can't park now, or when nothing on the sign ever makes you move. It
must be after the moment. The harness accepts one minute either way. A
`null` label is checked too: an answer that makes up a leave-by time fails.

**`duration_minutes`**: minutes from the moment to `until`, to within a
minute (the harness checks the two agree). `null` when `until` is null.

**`expected_variant`**: only when the answer depends on where you're parked
(arrows pointing different ways, numbered bays, an accessible bay beside
general parking). Name the spot the label's answer is for, with any other
wording the app might use (`["Right side", "Right"]`; matching ignores case
and spacing). The harness scores the option with that label, the way the
app uses the option the driver taps. If the model asks but offers none of
these labels, the read counts as wrong; if the right spot was offered under
another name, add that name.

**`expected_flags`**: only the details you're sure of. Leave out the rest.

- `requires_ticket`: you must pay right now (inside the paid hours).
- `payment_methods`: every way to pay shown on the pole or its stickers,
  whatever the time: `meter`, `ticket machine`, `paystay`, `easypark`,
  `wilson`, `carepark`, `pay-by-plate`. Compared as a set; `null` and `[]`
  both mean "no paid parking".
- `requires_disabled_permit`: an accessible parking bay in force now.
- `is_permit_zone`: a resident or business permit zone in force now.
- `permit_area`: the area as printed on the plate (`"25"`, `"12A"`), or
  `null`.
- `is_area_sign`: the sign governs an area, not a length of road. Scored once
  the model returns it.

**`expected_sign_status`**: `readable`, `partially_obscured`, `missing`,
`contradictory` or `not_a_parking_sign`. Scored once the model returns a
sign status; until then the report says it wasn't scored.

**Photos with no readable parking sign** (`expected_sign_status` of
`missing` or `not_a_parking_sign`, tag `no-sign`): label `can_park_now:
false`, `until: null` and `duration_minutes: null`, which is what the reader
is told to answer when in doubt. Once the model returns a sign status, the
app shows "We couldn't find a readable parking sign" for these photos
instead of a verdict, so the harness scores that instead: the read is right
when the model says there's no readable sign, and these photos are left out
of both false-answer rates. A photo of a real sign that the model calls
signless counts as wrong, because the driver gets no answer.

**Tags**: describe what makes the photo hard, so results can be broken down.
Suggested: `stacked`, `arrows`, `clearway`, `paid`, `permit-zone`,
`accessible`, `area-sign`, `loading-zone`, `night`, `glare`, `obscured`,
`angle`, `no-sign`, and the state (`vic`, `nsw`, `qld`).

Aim for 30 to 50 photos covering the hard cases the product exists for, with
a few where the answer is "you can't park".

## What the numbers mean

- **Answer right** (the headline): the verdict matches and, when the label
  has an `until` (including `null`), so does the leave-by time. Errors and a
  position question without the labelled spot count as wrong.
- **Said you can park when you can't**: of the reads on signs where you
  can't park, the share that said you can. One of the mistakes that can
  cost a fine. A missed payment or permit condition shows under the sign
  details instead, and a late leave-by time under "Leave-by time later than
  the label", because "you can park" assumes the driver meets the sign's
  conditions.
- **Said you can't park when you can**: the reverse. It can send you
  looking for another spot when you didn't need to.
- **Leave-by time right** and **Minutes right**: among reads on signs where
  you can park that rightly said so, including labels with no leave-by time.
  Can't-park signs are left out, since "no leave-by time" is right there
  whenever the verdict is.
- **Leave-by time later than the label**: among the same reads, the share
  whose leave-by time was later than the label's, or missing when the label
  has one.
- **Sign details**, **Sign condition**: per labelled field.
- **Position**: of the reads on photos with an `expected_variant`, the share
  where the model asked and offered the labelled spot. Errors are left out
  (they count as wrong in the headline).
- **By confidence**: answer right, grouped by the confidence the model gave.
- **95% range**: a Wilson score interval. Rates are counted per sign, not
  per run: each sign counts once, weighted by its share of right runs, and
  the interval uses the number of signs, because repeat runs of one photo
  aren't independent.
- **Time per read**: nearest-rank p50 and p90 of the wall time of each read
  on the machine running the eval.
- **Cost**: list price for each read's `usage` (input, output including
  thinking, cache writes and reads). Prices live in
  `scripts/eval-lib/stats.mjs`; add a row when the model changes.

## Results file and publishing

`--json FILE` writes `schema: "parkproof-accuracy-v1"` with the date, the git
sha (and whether the tree had uncommitted changes, not counting the results
file itself), the model, sha256 hashes of the request as actually sent (the
system prompt as `prompt_sha256`, the instruction text in the user turn with
each photo's zone and time swapped for placeholders as
`user_prompt_sha256`, and the response schema as `schema_sha256`), the
thinking and effort settings, the price used, corpus counts and tags, every
metric, rates by tag, and one row per photo. For test photos the rows and
the rates by tag are cut down as the split rule says, with or without
`--show-failures`.

To publish:

1. Commit everything: the prompt, the code and the labelled photos. The
   page names the commit as the app version, so it won't show a run made
   with uncommitted changes.
2. Run the test split for real and write the file next to the page:

   ```bash
   npm run eval -- --split test --runs 3 --json migrations/two-app-architecture/landing-from-claude-design/accuracy/results.json
   ```

3. The first time, add `hidden` to the `#accuracy-empty` card in
   `accuracy/index.html`, so the page doesn't say "No numbers yet" without
   JavaScript, and add the in-app link to the page in `result.aiCaveat` and
   `landing.accuracyNote` (all 9 locales, one i18n script).

The page shows only a real run of the test split on committed code; a dry
run, a dev run, a run with uncommitted changes or a file that names which
test photos were right or wrong leaves its "no numbers yet" message in
place. Tests in `scripts/eval-lib/accuracy-page.test.mjs` check
that the card, the in-app links in every locale and the results file go
together.

## Code

- `scripts/eval-accuracy.mjs`: the CLI.
- `scripts/eval-lib/corpus.mjs`: loading and checking labels.
- `scripts/eval-lib/score.mjs`: scoring one read, summing runs.
- `scripts/eval-lib/stats.mjs`: Wilson intervals, per-sign rates, percentiles, cost.
- `scripts/eval-lib/run.mjs`: the run loop, the recording and dry-run model clients, the fingerprint.
- `scripts/eval-lib/report.mjs`: the results file and the text report.

Tests sit next to each file (`npx vitest run scripts`).
