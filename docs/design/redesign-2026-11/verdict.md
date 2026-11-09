# ParkProof redesign: which direction

**My pick: Direction A, Plain Sign, built without its bottom dock.** It's the only one of the three where colour, shape and the dark vault each mean one thing. It also has the best single idea in the review: the verdict as a road-sign plate. B is a close second and the safer option. C is competent, but it doesn't get to "make it look amazing".

---

## Read this first: the letters moved

The folders don't use the brief's letters. Keep this straight when you talk about it later.

| Folder | Name | What it is | Closest option in the brief |
|---|---|---|---|
| direction-a | **Plain Sign** | Warm light base, ink primary, the verdict as a sign plate, vault only on signed records, Overpass numerals, bottom dock | Brief B (Daylight + Vault), taken further with brief C's sign grammar |
| direction-b | **Vault, lit** | The vault as a header stage on every screen, paper sheets for reading, a white "pass" card for records | A hybrid, not the brief's B. The vault is on every screen, so it can't mean "signed" |
| direction-c | **Vault, tightened** | Dark everywhere, semantic tokens, a light primary button, same component tree | Brief A (Vault, refined) |

---

## Scores

Scale is 1 to 10, higher is better. For effort and risk, 10 means cheapest and safest.

| | A, Plain Sign | B, Vault, lit | C, Vault, tightened |
|---|---|---|---|
| Fixes the top problems | 9 | 8 | 6 |
| Trust and premium feel | 9 | 8 | 6 |
| Accessibility and contrast | 9 | 8 | 7 |
| Long strings, 9 locales | 7 | 8 | 7 |
| Build effort and risk | 3 | 6 | 8 |
| Portfolio signal (10 seconds) | 9 | 7 | 5 |
| **Total** | **46** | **45** | **39** |

A and B are close because both are good. The brief's deciding question settles it: is the dark green the brand, or is the seal? A goes all the way with "the seal". B answers "both", and its own designer spells out what that costs.

---

## 1. A, Plain Sign (recommended)

**Why it wins**

- **The verdict plate.** Go is a green rounded square with a P, the shape of an Australian permitted-parking sign. A condition is a yellow diamond with an ink edge. Unsure is a dashed ? under caution tape. Stop is a red slashed P. The state shows in shape, colour and words together. That's the strongest answer to problem 1 and to the "never colour alone" constraint. Compare shot 24, where "go" is black text next to a pale tick.
- **Colour finally means something.** The UI stops using green as the brand colour. Ink does the everyday work (primary button at 17.3:1). Green means go, red means stop, yellow means a condition, and the vault, mint and seal only appear on signed things. Landing on dark green means "this is signed". That's the brief's idea, delivered in full.
- **The signed pass.** Vault background, one cut corner, a ticket perforation, the seal at full size, the signing time in full, and phone times labelled as phone times. Shot 62 shows a raw base64 prefix, "Cryptographically signed" and "logged as an unsigned spot". The pass reads like a document you'd keep.
- **Best in bright sun.** Every surface you read from is light, and every contrast ratio I checked matched its claim.
- **Best interview story.** "The dark brand colour only appears on signed records. The everyday screens borrow road-sign grammar, so drivers already know what each colour means." A hiring PM gets that in one sentence.
- **It doesn't look like a council app** in the mocks. The warm kerb background and the large editorial numerals keep it consumer.

**What's wrong with it**

- **The bottom dock is the expensive, risky part.** The App.tsx state machine has no tabs today. It's also the file where the OAuth callback landing and the post-sync re-render have broken before (the `useMemo` attempt blanked the whole React tree). Drop the dock and use B's docked "Check a sign" button instead: same thumb spot, no tabs.
- **The signature wording falls short of the spec.** The pass only says "It doesn't show they're true". The saved moment leaves out "when it arrived or left". The spec says to state the whole thing wherever signed material appears. B gets this right.
- **Two data dependencies it doesn't list.** The red "in force now" chips need a per-rule flag (B calls it `in_force_now`, A doesn't mention it). The unsure state highlights the hidden end time on a crop of the photo, which needs region coordinates the model doesn't return. Until it does, show the plain sign thumbnail.
- **The Hindi chips leave "Right arrow" and "Both directions" in English.** The mock justifies this as quoting the pole, but those are scope labels, not text on the sign. Localise them.
- **Night.** A light-only app is glaring at an 11 pm kerb, and the record in shot 62 is stamped 11:05 pm. The night tokens are drafted but sit in Tier 3. Move them to Tier 2.
- **Overpass has no Greek or Devanagari,** so headlines in el, hi and pa fall back to Inter and Noto. Numbers stay in Overpass in every locale, and that's the part that matters. Acceptable.
- **Status bar.** The installed iPhone app has to change from `black-translucent` to `default` in the same commit as the background change. Otherwise you get a white clock on a light page.

---

## 2. B, Vault, lit (strong second)

**What it does well**

- **Keeps the identity you just shipped.** The vault stays at the top of every screen, so ParkProof still looks like ParkProof. The status bar doesn't change, and the OG image and landing keep working.
- **The most careful copy of the three.** It's the only direction that carries the spec's full signature sentence on the record and on the saved moment. It also found real bugs in today's locale files: the masculine "करूँगा" in hi, and em-dashes in el and hi.
- **Cheap, smart engineering ideas.** Digits are mapped to Inter through `unicode-range`, so Space Grotesk's flagged "1" disappears everywhere. The "until" string is split around its time, so Hindi word order works. In the expired state, "I've left" becomes the screen's one primary and Check a sign drops back.
- **It looks like a premium Australian fintech.** A Kmart or Sinch PM would call it polished.

**Why it's second**

- **With the vault on every screen, it can't mean "signed".** The designer says so plainly. The evidence story then rests on a white card with one cut corner and a guilloché, which is a much quieter signal.
- **Two greens share every result screen.** The go band sits against the vault at 2.68:1, under the 3:1 floor for boundaries. It only works because the band is attached to a white card.
- **Less ownable.** It's the best-built version of a look plenty of apps already have.
- **One visible bug in the mock.** The Arrived / Signed / Left grid on the record screen draws stray vertical lines through every cell (`.times div` should be `.times > div`). Small, but it's on the screen a hiring PM would study most closely.

**Choose B instead if** keeping the vault identity matters more to you than the evidence story, or if you want to save about a week.

---

## 3. C, Vault, tightened (weakest)

It isn't broken. On numbers it's the most rigorous of the three: every contrast ratio on its sheet matched my check to two decimals. It fixes real failures too. The primary goes from 1.57:1 to 12.1:1, Delete goes from 1.49:1 to 6.23:1, and disabled buttons are no longer brighter than enabled ones. But:

- **It doesn't answer the brief.** By its own count it fully fixes 7 problems, mostly fixes 2 and partly fixes 6. The vault still means nothing, home and every list stay dark green at noon, and go-green still sits in the same family of greens as the brand.
- **It looks like a tidied-up dark mode.** That's better than today, but it isn't "amazing". Its expired card, salmon on dark green, is the weakest single screen across all three sets.
- **The 4.5-day estimate isn't credible.** The other two plans cost the same scope at 15 to 17 days: four verdict states, merging logging into Start parking, the record pass, history, a legal copy pass in nine locales, plus landing and verify. Its stop state also shows "You can park from 6:30 pm". That needs the next-legal-time field the other two flag, and C never mentions it. A realistic estimate is 8 to 10 days.
- **It puts a green "You can park from 6:30 pm" pill inside a red stop card.** Green inside a stop answer muddies the one rule all three directions agree on.

---

## Numbers I checked

| Claim | Stated | Measured | Note |
|---|---|---|---|
| A: ink primary on a white plate | 17.3 | 17.33 | Matches |
| A: go and stop on a white plate | 6.2 / 6.2 | 6.21 / 6.19 | Matches |
| A: ink on warn yellow | 11.1 | 11.10 | Matches. Yellow against white is only 1.56, so yellow must never be text or a shape without an edge |
| B: vault primary on paper | 12.6 | 11.62 | Overstated, still far above AA |
| B: white text on the go band | 4.5 or more | 4.71 | Passes, with little margin |
| B: go band against the vault | 2.7 | 2.68 | Under 3:1, and B says so |
| C: light primary on the vault | 12.1 | 12.13 | Matches |
| C: stop text on the vault / on a row | 6.23 / 5.07 | 6.23 / 5.07 | Matches |
| C: row surface against the vault | not stated | 1.23 | Rows are recognised by their text and chevrons, not their edges |
| Today: pine button on the vault | 1.57 | 1.57 | The problem all three fix |

**Effort, realistically and on the same scope:**

| Direction | Stated | Realistic | Why |
|---|---|---|---|
| A, without the dock | 25 to 31 days, Tier 1 to 3 | 22 to 25 days for the whole app, landing and verify included | Its estimate is honest, and dropping the dock saves about 2 days |
| B | 15 to 18 days | 19 to 22 days | 1.5 days for every secondary screen won't hold |
| C | 4.5 days | 8 to 10 days | See above |

The real gap between A and B is about 3 to 5 days, not 10.

---

## Ideas to graft onto A

1. **From B: a docked "Check a sign" button in place of the tab dock.** It sits in the same thumb spot on every top-level screen. Parking records moves to a row on home and a link in the header, and App.tsx gets no tabs.
2. **From B: the full signature sentence.** Use it on the pass, the saved moment, the footnote in history and the PDF: "A signature shows these details existed, unchanged, by the signed time. It doesn't show they're true, who was driving, where the car was, or when it arrived or left."
3. **From B: both schema fields,** `next_can_park_at` and a per-rule `in_force_now`, with B's fallbacks (hide the line, keep chips neutral). That way nothing ships an invented time.
4. **From B: flip the hierarchy when a park expires.** "I've left" becomes the screen's primary and Check a sign drops to secondary.
5. **From B: the split "until" string and the fix for the masculine first person in hi.**
6. **From C: `scripts/lint-copy.mjs` in the definition of done.** It fails on em-dashes and banned words in every locale. Keep C's table of measured ratios as the record of contrast.
7. **From C: the 20px side gutter.** It gives Greek and Hindi 8px more line width.
8. **From C: no colour in the calm state.** A shows the calm countdown in go-green. Make it ink and let the bar carry the green, so amber and red hit harder when they arrive.
9. **From C: the order of work.** Ship the parts that don't depend on the look first (see below).

---

## What isn't being said

- **The legal copy can't wait in a queue.** These breach your own spec on a public site today: "VERIFIED RECORD" on the landing and the first-run hero, "Strong evidence" and "Strong case." on appeal review, "Reset to AI draft", "covers when and where", "Council-ready", and "It softens a council review". That's half a day's work, and it's the same whichever direction you pick. Do it now, not after the builds.
- **The em-dash problem is bigger than any designer found.** `en` and `zh-CN` are clean. The other seven locales have 307 between them (hi 65, vi 64, pa 53, el 39, it 31, id 29, ko 26). B spotted three. The spec bans them "anywhere", so the lint will fail on day one. Budget about a day of locale rewrites, done properly rather than by regex.
- **About 40 percent of the work doesn't depend on the look.** The verdict-state logic, one shared urgency function, the Start parking merge (once the reminders branch lands), actions that change with record state, and sorting history are logic and copy. All of it can start before you choose a look.
- **A surface change can't ship half done.** With A or B, if Settings, sign-in, appeal, About and verify stay on the old vault while the main flow goes light, you've recreated problem 13. Build on a branch, and ship once the secondary screens are done too.
- **This is three to four weeks on a shipped piece.** That's worth it only if ParkProof stays your lead portfolio piece through the next interview round. If the interviews need something sooner, do the legal pass and the logic now, and take on the look later.
- **All three landings keep "Works offline"** next to "Check a sign", but checking a sign needs a connection. A's landing also says "about 12 seconds" while its own loading screen says "up to 40". Fix both in the copy pass.

---

## Next move

1. **This week:** the legal copy pass, the em-dash cleanup across all locales and `lint-copy.mjs`. About a day and a half, whichever direction you pick.
2. **Once the reminders branch merges:** build the logic layer (verdict states, urgency, Start parking, record actions). Then choose A or B with that work in hand. My vote stays A, without the dock.
