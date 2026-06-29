# Sign-translation accuracy eval

A fixed, ground-truthed corpus of real parking signs you can re-run after any
prompt change, so "the translator is accurate" is **measured**, not asserted.
This is the offline complement to the in-app feedback telemetry (which only
produces signal once there are real users).

## Run

```bash
cd lambda && npm ci   # one-time: translateSign pulls the AWS SDK from lambda/
cd ..
npm run eval
```

Needs `ANTHROPIC_API_KEY` in `.env`. Each sign is a real Claude call (~$0.03–0.05),
so a 40-sign corpus costs ~$1.50–2 to run. Time is pinned per sign
(`scanContext.datetime`), so results are deterministic given the prompt.

Output: overall pass rate (verdict **and** leave-by both correct), plus a
breakdown of `verdict wrong` vs `leave-by wrong`, and a per-sign failure list
that is your prompt-iteration worklist. Exit code is non-zero if any verdict
is wrong, so it works as a CI regression gate once populated.

## Add a sign

Drop a matched pair into `eval/corpus/`:

```
eval/corpus/lygon-st-2p-clearway.jpg          # the photo
eval/corpus/lygon-st-2p-clearway.json         # the ground truth
```

```jsonc
{
  "id": "lygon-st-2p-clearway",
  "image": "lygon-st-2p-clearway.jpg",
  "scanContext": {
    "lat": -37.7980,
    "lng": 144.9675,
    "datetime": "2026-05-20T14:30:00+10:00"   // pin the moment you're testing
  },
  "expected": {
    "can_park_now": true,
    "until": "2026-05-20T16:00:00+10:00",       // the correct leave-by (ISO, local tz)
    "duration_minutes": 90,
    "note": "2P Mon-Fri 8-6; scanned 2:30pm Tue → leave by 4pm"
  }
}
```

Aim for **30–50 signs** spanning the hard cases the product exists for: stacked
multi-rule poles, side-specific arrows, clearway transitions, permit-zone
overlays, paid-vs-free-by-time-of-day, and a few that should read
`can_park_now: false`. Label `until` to the minute; the eval allows ±1 min.

The corpus images are real Melbourne signs and are safe to commit, having a
visible, versioned eval set is itself the point. Keep PII (number plates,
faces) out of frame.
