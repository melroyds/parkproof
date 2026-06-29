# ParkProof translation-quality review

_8 non-English locales, reviewed by a fluent native speaker per language, then every critical/high finding re-checked by a second independent native speaker tasked to catch overcorrections. Audience assumption throughout: diaspora drivers resident in Australia (a Vietnamese-Australian, a Punjabi-Australian, etc.), so a known English loan term can be legitimate where it is what the community actually says._

## Bottom line

The translations are better than machine output. Every locale is genuinely human-edited in the long-form copy, and the hardest single concept in the app, **"tamper-evident", landed correctly in all 8 languages** (rendered as "changes are detectable", never the wrong "changes are prevented"). The problems are concentrated, not pervasive: one systemic civic term ("council"), gendered self-reference in the four gendered languages, and informal/formal register drift. **One locale (Punjabi) has a real correctness bug on the legal surface and should not be leaned on until fixed. One (Hindi) looks careless on the council term.** The rest are acceptable-to-strong and want a light native pass, not a rebuild.

## Scoreboard

| Locale | Verdict | Trust-undermining | Worst issue | Fix volume |
|---|---|---|---|---|
| **pa** Punjabi | **Below acceptable** | **Yes (confirmed by both)** | "council" = ਨਗਰ ਨਿਗਮ (India's "Municipal Corporation", wrong country) on the PDF evidence + signature; ਪੱਥਰੀ ("pebble") for "stacked signs" | High |
| **hi** Hindi | Acceptable | Borderline (careless-looking) | "council" rendered 4 ways across the file | Medium |
| **it** Italian | Acceptable | No | Masculine-gendered "Sono andato" excludes female users on buttons; one broken string | Medium |
| **el** Greek | Acceptable | No | Pervasive informal/formal "you" flip-flop (~15 strings) + masculine gendering | Medium-High |
| **id** Indonesian | Acceptable | No | "melodgekan" is a fabricated non-word on a legal disclaimer | Low |
| **vi** Vietnamese | Acceptable | No | "No posted restrictions" narrowed to "no prohibition sign" | Low |
| **ko** Korean | Acceptable | **No** (first reviewer said yes, verify overturned) | "council" = 시청 is imprecise (city-hall), but comprehensible | Low-Medium |
| **zh-CN** Chinese | **Natural** | No | One grammar slip (开具市政府) + minor term drift | Low |

## Priority order

1. **pa (Punjabi)** — correctness + trust. Fix before relying on it.
2. **hi (Hindi)** — council consistency; reads careless on a civic product.
3. **it (Italian)** — gender exclusion affects ~half of users on real buttons; one broken string.
4. **el (Greek)** — biggest polish volume (register normalisation).
5. **id (Indonesian)** — one fabricated word + a register flip.
6. **vi (Vietnamese)** — one semantic narrowing + term consistency.
7. **ko (Korean)** — term precision only (and not the fix the first reviewer proposed).
8. **zh-CN (Chinese)** — strongest file; one grammar fix.

---

## Cross-cutting patterns (fix these once, across locales)

1. **"council" is the single highest-value civic term and the most error-prone.** It is the institution the whole product points at. State of play: **pa** uses ਨਗਰ ਨਿਗਮ (an Indian body that does not exist in Australia) on the legal/PDF surfaces — this is wrong, not just inconsistent. **ko** uses 시청 (city-hall, the wrong level/kind of government). **hi** uses four different renderings. **zh** and **vi** are merely inconsistent (2-3 variants each). Decide one canonical term per language and sweep it. Verify's recommended targets (which correct the first reviewers): pa → ਕੌਂਸਲ (already used elsewhere in the file); ko → 지자체 / 지방자치단체 for legal copy, **not** the casual 카운슬 the first reviewer suggested; hi → नगर पालिका (formal, already the majority spelling), **not** the transliteration; zh → unify on 市政府; vi → unify on hội đồng địa phương.

2. **Gendered self-reference assumes male users.** The "I've left", "Currently parked", and "Signed in as" strings are masculine in the gendered languages: **it** ("Sono andato", "Arrivato", and the unflagged confirm strings "sei andato"), **el** ("ΠΑΡΚΑΡΙΣΜΕΝΟΣ ΤΩΡΑ", "Συνδεδεμένος ως", "Εγγεγραμμένος"), **pa** (a four-way slash "ਮੈਂ ਚਲਾ/ਚਲੀ ਗਿਆ/ਗਈ ਹਾਂ"), **hi** (slash form). A female driver is misgendered by her own app. Fix with impersonal/neutral phrasings (e.g. it "Ho lasciato il posto"; el "ΣΕ ΣΤΑΘΜΕΥΣΗ ΤΩΡΑ"; pa "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ"), which also shortens the buttons.

3. **Informal/formal "you" drift.** English is uniformly informal-warm. **el** flip-flops εσύ/εσείς across ~15 strings (worst case: two registers on one result card). **id** flips kamu/Anda on the donation card and legal acks. **zh** mixes 你/您. **hi** mixes informal/formal imperatives. Pick the informal register per language and normalise.

4. **"suburb" calqued as "outskirts".** **zh** (郊区), **id** (pinggiran kota), **ko** (교외) all render the Australian address-field "suburb" as "fringe/outskirts", which is wrong for an inner-city locality. Use a neutral "area/locality" word or keep the loan "suburb".

5. **A positive worth banking: the new copy translated well.** "tamper-evident", "parking record", and the `<accent>` hero all came through correctly in every locale. The recent batches did not degrade quality.

---

## Per-locale detail

Severity and a verify ruling on each serious finding. `confirmed` = real error; `partial` = real but milder or better-fixed differently; `overcorrection` = the original was fine.

### pa — Punjabi · Below acceptable · TRUST-UNDERMINING

The only locale a second native reviewer downgraded rather than upheld. All nine flagged findings confirmed, zero overcorrections.

| Key | Issue | Fix | Sev · Verify |
|---|---|---|---|
| `appeal.captureIntro`, `appeal.captureIntroStandalone`, `pdf.evidence.statement`, `pdf.signature.intro`, `session.howToVerify`, `session.noteHelp`, `about.evidence.items[2]`, `about.appeal.items[1]` | "council" = ਨਗਰ ਨਿਗਮ, India's "Municipal Corporation", which does not exist in Australia. On the KMS-signed PDF it reads "Australian Indian municipal corporation". The same file already uses the correct ਕੌਂਸਲ elsewhere. | Sweep ਨਗਰ ਨਿਗਮ → ਕੌਂਸਲ everywhere (with feminine agreement, e.g. ਕਰ ਸਕਦੀ ਹੈ) | High · **confirmed ×8** |
| `about.scan.lead` | ਪੱਥਰੀ means "pebble / kidney-stone", gibberish for "stacked signs", on the flagship About hero | ਉਲਝੇ, ਇੱਕ ਉੱਤੇ ਇੱਕ ਲੱਗੇ ਚਿੰਨ੍ਹ | High · **confirmed** |
| `active.iveLeft`, `session.endSession` | Four gender forms slashed into one button ("ਮੈਂ ਚਲਾ/ਚਲੀ ਗਿਆ/ਗਈ ਹਾਂ"); clumsy + overflow | Impersonal ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ | Medium |
| `reminders.*`, `about.push.body` | "reminder" drifts ਰਿਮਾਈਂਡਰ vs ਯਾਦਾਂ ("memories") vs ਯਾਦਦਾਸ਼ਤ ("recollection"); one gender-agreement error | Standardise ਰਿਮਾਈਂਡਰ | Medium |

Verify's verdict: _"NOT acceptable as-is; needs the ਨਗਰ ਨਿਗਮ → ਕੌਂਸਲ sweep plus the ਪੱਥਰੀ rewrite."_ This is the one locale where a user could attach a PDF to a real dispute and have it name the wrong country's institution.

### hi — Hindi · Acceptable · Trust: borderline

| Key | Issue | Fix | Sev · Verify |
|---|---|---|---|
| `about.evidence.items[2]`, `about.appeal.items`, `pdf.evidence.statement`, `result.permitZone.copy`, `session.howToVerify` | "council" rendered 4 ways: नगर पालिका ×7, नगर निगम ×2, कौंसिल ×2, काउंसिल ×1 (two spellings of the transliteration). Comprehensible, but looks careless on a civic product. | Standardise on **नगर पालिका** (formal, already the majority) — verify rejected the first reviewer's कौंसिल as too casual for the signed PDF | High · **partial** (real, severity overstated; comprehension intact) |
| `language.tooltipPrefix` | "ऐप की भाषा बदलकर करें" is grammatically broken as a prefix | ऐप की भाषा बदलें: | High · **confirmed, but dead code** (string is not referenced anywhere in the app today; fix before it is ever wired up) |
| `about.scan.lead` | तानें ("to aim a weapon") is the wrong verb for "point your phone"; plus an informal/formal register break in this section | फोन रखें + align imperatives | Medium |
| `common.*Confidence` | विश्वास ("faith") reads off as an AI-confidence badge and disagrees with the PDF's विश्वसनीयता | विश्वसनीयता | Low |

Verify softened the first reviewer: trust-undermining is "fair" because four spellings of one civic term looks sloppy, but every variant is understood and the broken string is dead code, so it is a polish issue, not an emergency.

### it — Italian · Acceptable · Trust: no

| Key | Issue | Fix | Sev · Verify |
|---|---|---|---|
| `active.iveLeft`, `session.endSession` | "Sono andato" is masculine; a female driver is misgendered on the button | Ho lasciato il posto | High · **confirmed** |
| _(also)_ `active.iveLeftConfirm`, `session.endConfirm` | "sei andato", same masculine bias, **not flagged by the first reviewer** — verify caught it; fix in the same pass or a woman is still misgendered one tap later | neutral rephrase | High · verify add |
| `reminders.noSign.browserCopy` | "nella tab più sul sistema operativo" is broken ("più" is a literal calque of English "plus") | nella scheda e anche sul sistema operativo | High · **confirmed** |
| `active.moveBy`, `time.moveNow`, `pdf.evidence.guidanceFree` | "Sposta" is transitive with no object ("move [what?]") | **Spostati entro le {{time}}** (verify's reflexive beats the first reviewer's "Riparti") | High → Medium · **partial** |
| `session.arrived` | "Arrivato" masculine; the PDF already uses neutral "Arrivo" | Arrivo {{when}} | Medium |
| `reminders.pushScheduled.*` | "un ping" is developer jargon; `active.nextPing` already correctly uses "promemoria" | promemoria | Medium |

### el — Greek · Acceptable · Trust: no

The most internally inconsistent register, but no broken strings. All findings were medium/low, so none hit the verify threshold (correctly).

- **Pervasive εσύ/εσείς flip-flop (~15 strings):** whole sections are informal (home, scanner, time, auth) while others switch to polite-plural (`result.payRequired.*`, `result.permitZone.*`, `scanner.noSign*`, `feedback.*`, `errors.complexSignTimeout`, the appeal CTAs). Worst case: `result.logCta` (neutral) sits one line from `result.logCtaBlocked` (polite-plural) on the same card. Normalise to **εσύ**.
- **Masculine gendering:** `active.currentlyParked`/`allActiveHeader` ("ΠΑΡΚΑΡΙΣΜΕΝΟΣ"), `settings.signedInAs`, `settings.pushSubscribed`. Use neutral "ΣΕ ΣΤΑΘΜΕΥΣΗ".
- **Term drift:** "council" three ways (δήμος / δημοτική αρχή / τοπικός δήμος); "appeal" split ένσταση vs προσφυγή. Standardise on δήμος and ένσταση.
- **Grammar:** `reminders.chipMin` has no `_one`, so count=1 renders "1 λεπτά" (should be "1 λεπτό"). Add the plural key.
- **Minor:** `feedback.emailPlaceholder` "esy@..." is clumsy Greeklish.

### id — Indonesian · Acceptable · Trust: no

| Key | Issue | Fix | Sev · Verify |
|---|---|---|---|
| `appeal.reviewDisclaimer` | "melodgekan" is a fabricated word (English "lodge" + Indonesian affixes), on a legal disclaimer | tidak mengajukan bandingnya untukmu | High · **confirmed** |
| `about.support.body`, `result.*.ack`, `about.support.button` | Register flip to formal "Anda"/"saya"/"tilang" while the app is informal "kamu"/"denda" | normalise to kamu/denda | Medium-Low |
| `about.gates.title` | "Tunggu sebentar yang lembut" is a literal calque of "A gentle wait a second" | Sedikit pengingat sebelum kamu pergi | Low |
| `logger.captured` | "Tertangkap" (caught/apprehended) is the wrong sense of "Captured" | Tersimpan | Low |

Otherwise solid; the informal "kamu" register is a good fit for the warm voice.

### vi — Vietnamese · Acceptable · Trust: no

| Key | Issue | Fix | Sev · Verify |
|---|---|---|---|
| `active.noPostedRestrictions` | "Không có biển cấm" = "no prohibition sign", narrower (and legally weaker) than "No posted restrictions"; every sibling string correctly uses "hạn chế" | Không có biển báo hạn chế | High · **confirmed** |
| `appeal.captureIntro` + others | "council" three ways (hội đồng địa phương / hội đồng thành phố / bare hội đồng) | unify on hội đồng địa phương | Medium |
| `pdf.appeal.ticketPhotoHeader` + others | "ticket" three ways (vé phạt / phiếu phạt / giấy phạt) | pick one | Medium |
| `about.evidence.lead` + others | "parking" flips đỗ xe / đậu xe (North/South) like two translators | standardise on đỗ xe | Medium |

A few literal calques (`quá thiếu chính xác`, `không trong suốt`, `qua đẩy`) are low-severity polish.

### ko — Korean · Acceptable · Trust: NO (first reviewer's flag overturned)

The clearest example of the verify stage doing its job. The first reviewer called 시청-for-council trust-undermining and prescribed replacing it with 카운슬 everywhere. The second native reviewer ruled **partial** and rejected the fix:

- 시청 ("city-hall") is genuinely imprecise (Australian councils are often shires/boroughs, not cities), but the referent is recoverable and one string already hedges with 호주 지방 시청. Not comprehension-breaking, so **not** trust-undermining.
- The proposed 카운슬 is casual diaspora code-switching and would read jarringly informal next to 법원 (court) and 보험사 (insurer) on the KMS evidence statement. The first reviewer's fallback 지방의회 is also wrong (that is the elected council *chamber*, not the administration).
- Correct fix: **지자체 / 지방자치단체** in legal/evidence copy, 시·구청 in friendly body copy.

Other real findings: `about.scan.lead` "휴대폰을 향하세요" inverts "point your phone at" (medium); `교외` for "suburb" = outskirts (medium); `appeal.supportingEvidence` "지원 증거" is a calque, should be 뒷받침 증거 (medium); em-dash-as-clause-break carried over from English reads MT-ish in several strings.

### zh-CN — Chinese · Natural · Trust: no

The strongest file; reads human-written, with idiomatic touches a native writer would actually use. One real grammar slip and some term drift.

| Key | Issue | Fix | Sev · Verify |
|---|---|---|---|
| `appeal.captureIntro`, `appeal.captureIntroStandalone` | "开具市政府" is ungrammatical (开具 needs an object; reads "issue-the-council") | 开具该通知的市政府 | High · **confirmed** |
| `session.noSignDescription` | First clause is a verbless fragment | 是在没有停车标志的地点登记的 | Medium |
| `pdf.evidence.statement`, `pdf.signature.intro` | "council" drifts to 议会/地方议会 (leans "parliament") in the PDF vs 市政府 on every screen | unify on 市政府 | Medium |
| `logger.addressPlaceholder` etc. | 郊区 ("outskirts") wrong for "suburb" | 城区 / 区 | Medium |
| `about.gates.items[0]` | 仪表 ("gauge/dial") wrong for parking meter; `result.payRequired` correctly uses 停车计时器 | 停车计时器 | Medium |
| whole file | 您/你 mixed across screens | standardise on 你 | Low |

---

## Which locales still want a human native pass

**All 8 reviewers asked for one**, but they are not equal:

- **Must fix before launch / before leaning on the locale:** **pa** (correctness bug on the legal surface), and **hi** (council looks careless). These two carry the trust risk.
- **Should fix soon (real, user-visible):** **it** (gender exclusion + one broken string), **el** (register normalisation is real polish on many strings), **id** (one fabricated word).
- **Light pass, acceptable as-is in the meantime:** **vi**, **ko**, **zh-CN**. One or two fixes each; none embarrassing.

A practical sequence if you want to spend the least and de-risk the most: do the **cross-cutting council decision** (one canonical term per language) plus the **gender-neutral self-reference** strings first, since those two patterns account for most of the trust-relevant findings across pa, hi, ko, it, el at once. Everything after that is polish.

_Reviewers were instructed to avoid rubber-stamping and to separate real errors from dialect preference; the verify pass overturned one verdict (ko) and refined three fixes (ko, hi, it), so the findings above are calibrated, not a first-pass opinion._
