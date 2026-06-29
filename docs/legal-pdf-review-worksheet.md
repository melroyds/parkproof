# Legal-PDF review worksheet

The legal terms a driver attaches to a real council dispute. **All 8 languages have now been verified against real Australian council / government pages**, so the high-risk part of this check is done. What remains for a human pass is the precision read of the signature claim wording (see "five things" below).

## Verified against real council pages

✅ = matches official usage · ◻ = acceptable variant · "fixed/updated" = ParkProof was changed.

### Chinese (zh-CN) · Punjabi (pa) · Hindi (hi) · Korean (ko)
| Concept | Chinese | Punjabi | Hindi | Korean |
|---|---|---|---|---|
| council | 市议会 ✅ fixed | ਕੌਂਸਲ ✅ | परिषद ✅ fixed | 의회 ✅ upgraded |
| fine | 罚款 ✅ | ਜੁਰਮਾਨਾ ✅ | जुर्माना ✅ | 벌금 ✅ fixed |
| review/appeal | 复核/申诉 ◻ | ਸਮੀਖਿਆ ✅ | समीक्षा ✅ | 이의신청 — |
| accessible parking permit | 无障碍停车许可证 ✅ updated | ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ ✅ updated | सुलभ पार्किंग परमिट ✅ updated | 장애인 주차 허가증 ◻ (natural KR term) |

_Sources: Greater Shepparton City Council (zh), Fines Victoria (zh/pa portals), City of Melbourne (hi), Cumberland City Council + Korean Consulate Sydney (ko), accessibleparking.vic.gov.au._

### Vietnamese (vi) · Indonesian (id) · Italian (it) · Greek (el)
Web-verified against council pages; council/fine/review terms all **match official usage** (no fix needed); permit renamed to the accessible framing.

| Concept | Vietnamese | Indonesian | Italian | Greek |
|---|---|---|---|---|
| council | hội đồng ✅ | dewan kota ✅ | comune ✅ | δήμος ✅ |
| fine | tiền phạt ✅ | denda ✅ | multa ✅ | πρόστιμο ✅ |
| review/appeal | xem xét ✅ | banding ✅ | ricorso ✅ | ένσταση/αναθεώρηση ✅ |
| accessible parking permit | giấy phép đỗ xe tiếp cận ✅ | izin parkir aksesibel ✅ | permesso di parcheggio accessibile ✅ | άδεια προσβάσιμης στάθμευσης ✅ |

_Sources: DFAT Indonesian / Australian Greens VIC (id), Fines Victoria + Victoria Police language pages + Boroondara + Greater Dandenong (el, vi, it)._

## Resolved

Both items that were previously left for your decision are now done:

1. **"Disability permit" → "Accessible Parking Permit"** applied across en.json + all 9 locales (Victoria renamed the scheme in May 2021; this is the current, respectful name). Each locale uses its natural accessible/barrier-free term; Korean keeps 장애인 (no natural euphemism in Korean).
2. **Korean council 지자체 → 의회** applied (the council's own word).

## The five things to check on a human pass (optional, low residual)

1. **The signature claim says DETECTION, not PREVENTION** (highest risk, and the one thing not term-checkable above). `pdf.signature.intro` + the badge must say the signature lets someone *verify the record was not altered*, never that it cannot be altered.
2. Council / fine / appeal terms — **done** (verified above).
3. The accessible-parking-permit consequence ($400, an offence) is accurate and not moralising.
4. The evidence statement names the right body and claims only what is true.
5. The appeal disclaimer is clear it's a draft, not legal advice, and ParkProof does not lodge it.

---

## Full string-by-string worksheet

### Chinese (Simplified) (`zh-CN`)

_council 市议会, permit 无障碍停车许可证 — verified_

**Signature claim — MOST IMPORTANT** — `pdf.signature.intro`
> EN: This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification.
>
> zh-CN: 本证据记录在保存时由 ParkProof 的 AWS KMS 托管私钥进行签名。任何第三方(市议会、法院、保险公司)均可通过该签名验证下方的元数据和照片哈希自 signed_at 时间戳以来未被篡改。私钥从未离开 AWS;公钥已公开发布以供验证。
>
> ☐ Check: Must say the signature lets a third party VERIFY the record HAS NOT BEEN ALTERED (detection). It must NOT say the record cannot be altered / is unchangeable (prevention).

**Signature appendix title** — `pdf.signature.title`
> EN: Cryptographic signature
>
> zh-CN: 数字签名
>
> ☐ Check: A precise term for a cryptographic/digital signature.

**"Signed" badge** — `session.cryptoSigned`
> EN: Cryptographically signed
>
> zh-CN: 已数字签名
>
> ☐ Check: Same precise signature term, consistent with the appendix.

**Evidence-record statement** — `pdf.evidence.statement`
> EN: This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.
>
> zh-CN: 本记录由 ParkProof 在停车时自动生成。到达时间戳、GPS 坐标、标志翻译和照片,共同构成一份同期形成的证据记录,可附于向澳大利亚相关地方市议会提交的停车罚单复核申请。
>
> ☐ Check: Names the correct council body; matches what a real council calls the review process; claims only what is true.

**Full-export statement** — `pdf.fullExport.intro`
> EN: This document gathers every parking record saved to this ParkProof account. Each record was captured at the moment of parking with GPS, photographs, and an AI-translated reading of the parking sign. Where a record was signed with the ParkProof KMS key, the badge on that section indicates a verifiable cryptographic signature exists (export the individual record PDF for the full signature appendix).
>
> zh-CN: 本文档汇集了该 ParkProof 账户保存的所有停车记录。每条记录都在停车时通过 GPS、照片和 AI 翻译的停车标志解读进行了记录。若某条记录使用 ParkProof KMS 密钥进行了签名,该部分的徽章表示存在可验证的加密签名(请导出单条记录的 PDF 以获取完整的签名附录)。
>
> ☐ Check: Same checks as the evidence statement.

**Driver-note disclaimer** — `pdf.evidence.driverNoteUnsigned`
> EN: Added by the driver. This note is not covered by the cryptographic signature.
>
> zh-CN: 由驾驶员添加。此备注不在加密签名的覆盖范围内。
>
> ☐ Check: Correctly says the free-text note is NOT covered by the signature.

**Accessible-parking-permit gate** — `result.permitRequired.copy`
> EN: Parking here without a valid accessible parking permit clearly displayed is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot.
>
> zh-CN: 在这里停车却没有清楚出示有效的无障碍停车许可证属于违法。在维多利亚州,罚款 $400 起,而这个车位是留给真正需要的人的。如果你没有许可证,请换个车位扫描。
>
> ☐ Check: States the offence and the $400 figure accurately; the permit term is current and respectful; no moralising.

**Permit-zone gate** — `result.permitZone.copy`
> EN: This is a residential or business permit zone. You can park here only if you hold a valid permit for this area. Council inspectors check the permit number against the area. A permit for the next block over doesn't count.
>
> zh-CN: 这是居民或商业许可证区域。只有持有该区域有效许可证的车辆才能停车。市政执法人员会核对许可证编号与区域,邻近街区的许可证不算数。
>
> ☐ Check: States the permit-zone rule accurately.

**KMS signing explainer** — `privacy.signingCopy`
> EN: When you sign in (or stay anonymous, both work), each record is signed by an AWS KMS-managed ECDSA P-256 key. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> for anyone (a council, court, insurer) to verify the evidence chain using <code>openssl dgst</code>. See the appendix in any exported PDF for the step-by-step.
>
> zh-CN: 无论你登录还是保持匿名(两种都行),每条记录都由 AWS KMS 托管的 ECDSA P-256 密钥签名。私钥从不离开 AWS。公钥公开发布在 <a>/parkproof-public-key.pem</a>,任何人(市议会、法院、保险公司)都可以用 <code>openssl dgst</code> 验证这条证据链。任何导出的 PDF 里都有一份分步说明的附录。
>
> ☐ Check: The public-key / verify-the-chain explanation is accurate and does not overclaim.

**Appeal disclaimer** — `appeal.reviewDisclaimer`
> EN: The AI draft is a starting point. Read carefully, edit the letter to match your voice and circumstances, and verify every claim before sending. ParkProof doesn't lodge the appeal for you.
>
> zh-CN: AI 草稿只是个起点。请仔细读一遍,按你的语气和实际情况改写,寄出前核实每一处事实。ParkProof 不会替你递交申诉。
>
> ☐ Check: Clear that this is a starting draft, not legal advice, and that ParkProof does not lodge the appeal.

---

### Punjabi (`pa`)

_council ਕੌਂਸਲ, permit ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ — verified_

**Signature claim — MOST IMPORTANT** — `pdf.signature.intro`
> EN: This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification.
>
> pa: ਇਹ ਸਬੂਤ ਰਿਕਾਰਡ ਸੰਭਾਲਣ ਵੇਲੇ ParkProof ਦੀ AWS KMS-ਪ੍ਰਬੰਧਿਤ ਨਿੱਜੀ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰਿਤ ਕੀਤਾ ਗਿਆ ਸੀ। ਹਸਤਾਖਰ ਕਿਸੇ ਵੀ ਤੀਜੀ ਧਿਰ (ਕੌਂਸਲ, ਅਦਾਲਤ, ਬੀਮਾ ਕੰਪਨੀ) ਨੂੰ ਇਹ ਤਸਦੀਕ ਕਰਨ ਦਿੰਦਾ ਹੈ ਕਿ ਹੇਠਾਂ ਦਿੱਤੇ ਮੈਟਾਡੇਟਾ ਅਤੇ ਫੋਟੋ ਹੈਸ਼ signed_at ਟਾਈਮਸਟੈਂਪ ਤੋਂ ਬਾਅਦ ਬਦਲੇ ਨਹੀਂ ਗਏ। ਨਿੱਜੀ ਕੁੰਜੀ ਕਦੇ AWS ਨਹੀਂ ਛੱਡਦੀ; ਜਨਤਕ ਕੁੰਜੀ ਤਸਦੀਕ ਲਈ ਖੁੱਲ੍ਹੇ ਤੌਰ 'ਤੇ ਪ੍ਰਕਾਸ਼ਿਤ ਹੈ।
>
> ☐ Check: Must say the signature lets a third party VERIFY the record HAS NOT BEEN ALTERED (detection). It must NOT say the record cannot be altered / is unchangeable (prevention).

**Signature appendix title** — `pdf.signature.title`
> EN: Cryptographic signature
>
> pa: ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਹਸਤਾਖਰ
>
> ☐ Check: A precise term for a cryptographic/digital signature.

**"Signed" badge** — `session.cryptoSigned`
> EN: Cryptographically signed
>
> pa: ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਤੌਰ 'ਤੇ ਹਸਤਾਖਰਿਤ
>
> ☐ Check: Same precise signature term, consistent with the appendix.

**Evidence-record statement** — `pdf.evidence.statement`
> EN: This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.
>
> pa: ਇਹ ਰਿਕਾਰਡ ParkProof ਦੁਆਰਾ ਪਾਰਕਿੰਗ ਦੇ ਸਮੇਂ ਆਪਣੇ ਆਪ ਤਿਆਰ ਕੀਤਾ ਗਿਆ ਸੀ। ਪਹੁੰਚਣ ਦਾ ਟਾਈਮਸਟੈਂਪ, GPS ਨਿਰਦੇਸ਼ਾਂਕ, ਚਿੰਨ੍ਹ ਦਾ ਅਨੁਵਾਦ, ਅਤੇ ਫੋਟੋਆਂ ਮਿਲ ਕੇ ਇੱਕ ਸਮਕਾਲੀ ਸਬੂਤ ਰਿਕਾਰਡ ਬਣਾਉਂਦੇ ਹਨ ਜੋ ਸਬੰਧਤ ਆਸਟ੍ਰੇਲੀਆਈ ਸਥਾਨਕ ਕੌਂਸਲ ਨੂੰ ਪਾਰਕਿੰਗ ਉਲੰਘਣਾ ਸਮੀਖਿਆ ਅਰਜ਼ੀ ਨਾਲ ਨੱਥੀ ਕਰਨ ਲਈ ਢੁਕਵਾਂ ਹੈ।
>
> ☐ Check: Names the correct council body; matches what a real council calls the review process; claims only what is true.

**Full-export statement** — `pdf.fullExport.intro`
> EN: This document gathers every parking record saved to this ParkProof account. Each record was captured at the moment of parking with GPS, photographs, and an AI-translated reading of the parking sign. Where a record was signed with the ParkProof KMS key, the badge on that section indicates a verifiable cryptographic signature exists (export the individual record PDF for the full signature appendix).
>
> pa: ਇਹ ਦਸਤਾਵੇਜ਼ ਇਸ ParkProof ਖਾਤੇ ਵਿੱਚ ਸੰਭਾਲੇ ਹਰ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਨੂੰ ਇਕੱਠਾ ਕਰਦਾ ਹੈ। ਹਰ ਰਿਕਾਰਡ ਪਾਰਕਿੰਗ ਦੇ ਪਲ 'ਤੇ GPS, ਫੋਟੋਆਂ, ਅਤੇ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਦੀ AI-ਅਨੁਵਾਦਿਤ ਰੀਡਿੰਗ ਨਾਲ ਕੈਪਚਰ ਕੀਤਾ ਗਿਆ। ਜਿੱਥੇ ਕੋਈ ਰਿਕਾਰਡ ParkProof KMS ਕੁੰਜੀ ਨਾਲ ਦਸਤਖਤ ਕੀਤਾ ਗਿਆ ਸੀ, ਉਸ ਭਾਗ 'ਤੇ ਬੈਜ ਦਰਸਾਉਂਦਾ ਹੈ ਕਿ ਪੁਸ਼ਟੀਯੋਗ ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਦਸਤਖਤ ਮੌਜੂਦ ਹੈ (ਪੂਰੀ ਦਸਤਖਤ ਅੰਤਿਕਾ ਲਈ ਵਿਅਕਤੀਗਤ ਰਿਕਾਰਡ PDF ਨਿਰਯਾਤ ਕਰੋ)।
>
> ☐ Check: Same checks as the evidence statement.

**Driver-note disclaimer** — `pdf.evidence.driverNoteUnsigned`
> EN: Added by the driver. This note is not covered by the cryptographic signature.
>
> pa: ਡਰਾਈਵਰ ਵੱਲੋਂ ਜੋੜਿਆ ਗਿਆ। ਇਹ ਨੋਟ ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਦਸਤਖਤ ਵਿੱਚ ਸ਼ਾਮਲ ਨਹੀਂ ਹੈ।
>
> ☐ Check: Correctly says the free-text note is NOT covered by the signature.

**Accessible-parking-permit gate** — `result.permitRequired.copy`
> EN: Parking here without a valid accessible parking permit clearly displayed is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot.
>
> pa: ਜਾਇਜ਼ ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ ਨੂੰ ਸਪਸ਼ਟ ਤੌਰ 'ਤੇ ਦਿਖਾਏ ਬਿਨਾਂ ਇੱਥੇ ਪਾਰਕਿੰਗ ਕਰਨਾ ਅਪਰਾਧ ਹੈ। ਵਿਕਟੋਰੀਆ ਵਿੱਚ ਜੁਰਮਾਨਾ $400 ਜਾਂ ਇਸ ਤੋਂ ਵੱਧ ਹੈ, ਅਤੇ ਇਹ ਥਾਂ ਉਨ੍ਹਾਂ ਲਈ ਰਾਖਵੀਂ ਹੈ ਜਿਨ੍ਹਾਂ ਨੂੰ ਇਸਦੀ ਲੋੜ ਹੈ। ਜੇ ਤੁਹਾਡੇ ਕੋਲ ਨਹੀਂ ਹੈ, ਤਾਂ ਕੋਈ ਹੋਰ ਥਾਂ ਸਕੈਨ ਕਰੋ।
>
> ☐ Check: States the offence and the $400 figure accurately; the permit term is current and respectful; no moralising.

**Permit-zone gate** — `result.permitZone.copy`
> EN: This is a residential or business permit zone. You can park here only if you hold a valid permit for this area. Council inspectors check the permit number against the area. A permit for the next block over doesn't count.
>
> pa: ਇਹ ਇੱਕ ਰਿਹਾਇਸ਼ੀ ਜਾਂ ਕਾਰੋਬਾਰੀ ਪਰਮਿਟ ਜ਼ੋਨ ਹੈ। ਤੁਸੀਂ ਇੱਥੇ ਸਿਰਫ਼ ਤਾਂ ਪਾਰਕ ਕਰ ਸਕਦੇ ਹੋ ਜੇ ਤੁਹਾਡੇ ਕੋਲ ਇਸ ਖੇਤਰ ਲਈ ਜਾਇਜ਼ ਪਰਮਿਟ ਹੈ। ਕੌਂਸਲ ਇੰਸਪੈਕਟਰ ਪਰਮਿਟ ਨੰਬਰ ਨੂੰ ਖੇਤਰ ਨਾਲ ਮਿਲਾ ਕੇ ਜਾਂਚਦੇ ਹਨ — ਨਾਲ ਦੇ ਬਲਾਕ ਦਾ ਪਰਮਿਟ ਨਹੀਂ ਚੱਲੇਗਾ।
>
> ☐ Check: States the permit-zone rule accurately.

**KMS signing explainer** — `privacy.signingCopy`
> EN: When you sign in (or stay anonymous, both work), each record is signed by an AWS KMS-managed ECDSA P-256 key. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> for anyone (a council, court, insurer) to verify the evidence chain using <code>openssl dgst</code>. See the appendix in any exported PDF for the step-by-step.
>
> pa: ਜਦੋਂ ਤੁਸੀਂ ਸਾਈਨ ਇਨ ਕਰਦੇ ਹੋ (ਜਾਂ ਗੁਮਨਾਮ ਰਹਿੰਦੇ ਹੋ — ਦੋਵੇਂ ਚੱਲਦੇ ਹਨ), ਹਰ ਰਿਕਾਰਡ AWS KMS ਵੱਲੋਂ ਪ੍ਰਬੰਧਿਤ ECDSA P-256 ਕੁੰਜੀ ਨਾਲ ਦਸਤਖਤ ਕੀਤਾ ਜਾਂਦਾ ਹੈ। ਨਿੱਜੀ ਕੁੰਜੀ ਕਦੇ AWS ਤੋਂ ਬਾਹਰ ਨਹੀਂ ਜਾਂਦੀ। ਜਨਤਕ ਕੁੰਜੀ <a>/parkproof-public-key.pem</a> 'ਤੇ ਪ੍ਰਕਾਸ਼ਿਤ ਹੈ ਤਾਂ ਜੋ ਕੋਈ ਵੀ (ਕੌਂਸਲ, ਅਦਾਲਤ, ਬੀਮਾਕਰਤਾ) <code>openssl dgst</code> ਵਰਤ ਕੇ ਸਬੂਤ-ਲੜੀ ਦੀ ਪੁਸ਼ਟੀ ਕਰ ਸਕੇ। ਕਦਮ-ਦਰ-ਕਦਮ ਤਰੀਕੇ ਲਈ ਕਿਸੇ ਵੀ ਨਿਰਯਾਤ ਕੀਤੇ PDF ਵਿੱਚ ਅੰਤਿਕਾ ਵੇਖੋ।
>
> ☐ Check: The public-key / verify-the-chain explanation is accurate and does not overclaim.

**Appeal disclaimer** — `appeal.reviewDisclaimer`
> EN: The AI draft is a starting point. Read carefully, edit the letter to match your voice and circumstances, and verify every claim before sending. ParkProof doesn't lodge the appeal for you.
>
> pa: AI ਦਾ ਖਰੜਾ ਸ਼ੁਰੂਆਤੀ ਬਿੰਦੂ ਹੈ। ਧਿਆਨ ਨਾਲ ਪੜ੍ਹੋ, ਆਪਣੀ ਆਵਾਜ਼ ਅਤੇ ਹਾਲਾਤ ਅਨੁਸਾਰ ਪੱਤਰ ਸੰਪਾਦਿਤ ਕਰੋ, ਅਤੇ ਭੇਜਣ ਤੋਂ ਪਹਿਲਾਂ ਹਰ ਦਾਅਵੇ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ। ParkProof ਤੁਹਾਡੇ ਲਈ ਅਪੀਲ ਦਾਖਲ ਨਹੀਂ ਕਰਦਾ।
>
> ☐ Check: Clear that this is a starting draft, not legal advice, and that ParkProof does not lodge the appeal.

---

### Korean (`ko`)

_council 의회, fine 벌금 — verified (장애인 kept: the natural Korean term)_

**Signature claim — MOST IMPORTANT** — `pdf.signature.intro`
> EN: This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification.
>
> ko: 이 증거 기록은 저장 시 ParkProof의 AWS KMS 관리 개인 키로 서명되었습니다. 서명은 모든 제3자 (의회, 법원, 보험사)가 아래 메타데이터와 사진 해시가 signed_at 타임스탬프 이후 변경되지 않았음을 검증할 수 있게 합니다. 개인 키는 AWS를 떠나지 않습니다. 공개 키는 검증을 위해 공개적으로 게시됩니다.
>
> ☐ Check: Must say the signature lets a third party VERIFY the record HAS NOT BEEN ALTERED (detection). It must NOT say the record cannot be altered / is unchangeable (prevention).

**Signature appendix title** — `pdf.signature.title`
> EN: Cryptographic signature
>
> ko: 암호학적 서명
>
> ☐ Check: A precise term for a cryptographic/digital signature.

**"Signed" badge** — `session.cryptoSigned`
> EN: Cryptographically signed
>
> ko: 전자 서명됨
>
> ☐ Check: Same precise signature term, consistent with the appendix.

**Evidence-record statement** — `pdf.evidence.statement`
> EN: This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.
>
> ko: 이 기록은 주차하는 순간에 ParkProof가 자동으로 생성했습니다. 도착 타임스탬프, GPS 좌표, 표지판 번역, 사진은 해당 호주 의회의 주차 위반 검토 제출에 첨부하기 적합한, 그 시점에 작성된 증거 기록을 이룹니다.
>
> ☐ Check: Names the correct council body; matches what a real council calls the review process; claims only what is true.

**Full-export statement** — `pdf.fullExport.intro`
> EN: This document gathers every parking record saved to this ParkProof account. Each record was captured at the moment of parking with GPS, photographs, and an AI-translated reading of the parking sign. Where a record was signed with the ParkProof KMS key, the badge on that section indicates a verifiable cryptographic signature exists (export the individual record PDF for the full signature appendix).
>
> ko: 이 문서는 이 ParkProof 계정에 저장된 모든 주차 기록을 모은 것입니다. 각 기록은 주차하는 순간에 GPS, 사진, AI가 번역한 주차 표지판 판독과 함께 캡처되었습니다. 기록이 ParkProof KMS 키로 서명된 경우, 해당 섹션의 배지는 검증 가능한 암호화 서명이 존재함을 나타냅니다 (전체 서명 부록을 보려면 개별 기록 PDF를 내보내세요).
>
> ☐ Check: Same checks as the evidence statement.

**Driver-note disclaimer** — `pdf.evidence.driverNoteUnsigned`
> EN: Added by the driver. This note is not covered by the cryptographic signature.
>
> ko: 운전자가 추가함. 이 메모는 암호학적 서명의 보호 범위에 포함되지 않습니다.
>
> ☐ Check: Correctly says the free-text note is NOT covered by the signature.

**Accessible-parking-permit gate** — `result.permitRequired.copy`
> EN: Parking here without a valid accessible parking permit clearly displayed is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot.
>
> ko: 유효한 장애인 주차 허가증을 잘 보이게 두지 않고 여기 주차하면 위반입니다. Victoria에서는 벌금가 $400을 넘고, 이 자리는 정말 필요한 분들을 위한 곳이에요. 허가증이 없으시면 다른 자리를 스캔해보세요.
>
> ☐ Check: States the offence and the $400 figure accurately; the permit term is current and respectful; no moralising.

**Permit-zone gate** — `result.permitZone.copy`
> EN: This is a residential or business permit zone. You can park here only if you hold a valid permit for this area. Council inspectors check the permit number against the area. A permit for the next block over doesn't count.
>
> ko: 이곳은 주거 또는 사업용 허가 구역입니다. 이 구역의 유효한 허가증이 있어야만 주차할 수 있어요. 의회 단속원은 허가증 번호를 구역과 대조합니다. 옆 블록 허가증은 인정되지 않아요.
>
> ☐ Check: States the permit-zone rule accurately.

**KMS signing explainer** — `privacy.signingCopy`
> EN: When you sign in (or stay anonymous, both work), each record is signed by an AWS KMS-managed ECDSA P-256 key. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> for anyone (a council, court, insurer) to verify the evidence chain using <code>openssl dgst</code>. See the appendix in any exported PDF for the step-by-step.
>
> ko: 로그인하시든 익명으로 남으시든 (둘 다 작동합니다) 각 기록은 AWS KMS가 관리하는 ECDSA P-256 키로 서명됩니다. 개인 키는 AWS를 벗어나지 않습니다. 공개 키는 <a>/parkproof-public-key.pem</a>에 게시되어 있어, 누구나 (의회, 법원, 보험사) <code>openssl dgst</code>로 증거 체인을 검증할 수 있습니다. 단계별 안내는 내보낸 PDF의 부록을 참고하세요.
>
> ☐ Check: The public-key / verify-the-chain explanation is accurate and does not overclaim.

**Appeal disclaimer** — `appeal.reviewDisclaimer`
> EN: The AI draft is a starting point. Read carefully, edit the letter to match your voice and circumstances, and verify every claim before sending. ParkProof doesn't lodge the appeal for you.
>
> ko: AI 초안은 출발점일 뿐입니다. 꼼꼼히 읽고, 당신의 말투와 상황에 맞게 편지를 고치고, 보내기 전에 모든 주장을 직접 확인하세요. ParkProof가 이의신청을 대신 제출해드리지는 않습니다.
>
> ☐ Check: Clear that this is a starting draft, not legal advice, and that ParkProof does not lodge the appeal.

---

### Hindi (`hi`)

_council परिषद, permit सुलभ पार्किंग परमिट — verified_

**Signature claim — MOST IMPORTANT** — `pdf.signature.intro`
> EN: This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification.
>
> hi: यह सबूत रिकॉर्ड सेव होते समय ParkProof की AWS KMS-प्रबंधित निजी कुंजी द्वारा हस्ताक्षरित किया गया था। हस्ताक्षर किसी भी तृतीय पक्ष (परिषद, अदालत, बीमाकर्ता) को यह सत्यापित करने देता है कि नीचे दिए गए मेटाडेटा और फ़ोटो हैश signed_at टाइमस्टैम्प के बाद नहीं बदले गए। निजी कुंजी कभी AWS नहीं छोड़ती; सार्वजनिक कुंजी सत्यापन के लिए खुले तौर पर प्रकाशित है।
>
> ☐ Check: Must say the signature lets a third party VERIFY the record HAS NOT BEEN ALTERED (detection). It must NOT say the record cannot be altered / is unchangeable (prevention).

**Signature appendix title** — `pdf.signature.title`
> EN: Cryptographic signature
>
> hi: क्रिप्टोग्राफ़िक हस्ताक्षर
>
> ☐ Check: A precise term for a cryptographic/digital signature.

**"Signed" badge** — `session.cryptoSigned`
> EN: Cryptographically signed
>
> hi: क्रिप्टोग्राफिक रूप से हस्ताक्षरित
>
> ☐ Check: Same precise signature term, consistent with the appendix.

**Evidence-record statement** — `pdf.evidence.statement`
> EN: This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.
>
> hi: यह रिकॉर्ड ParkProof द्वारा पार्किंग के समय स्वचालित रूप से तैयार किया गया है। पहुँचने का समय, GPS निर्देशांक, साइन का अनुवाद और फ़ोटो एक समकालीन सबूत रिकॉर्ड बनाते हैं, जिसे संबंधित ऑस्ट्रेलियाई स्थानीय परिषद के पास पार्किंग चालान समीक्षा आवेदन के साथ संलग्न किया जा सकता है।
>
> ☐ Check: Names the correct council body; matches what a real council calls the review process; claims only what is true.

**Full-export statement** — `pdf.fullExport.intro`
> EN: This document gathers every parking record saved to this ParkProof account. Each record was captured at the moment of parking with GPS, photographs, and an AI-translated reading of the parking sign. Where a record was signed with the ParkProof KMS key, the badge on that section indicates a verifiable cryptographic signature exists (export the individual record PDF for the full signature appendix).
>
> hi: यह दस्तावेज़ इस ParkProof खाते में सहेजे हर पार्किंग रिकॉर्ड को एकत्र करता है। हर रिकॉर्ड पार्किंग के समय GPS, फ़ोटो और साइन की AI-अनुवादित रीडिंग के साथ दर्ज किया गया। जहाँ कोई रिकॉर्ड ParkProof KMS कुंजी से हस्ताक्षरित किया गया हो, उस अनुभाग पर बैज दर्शाता है कि एक सत्यापन-योग्य क्रिप्टोग्राफ़िक हस्ताक्षर मौजूद है (पूरे हस्ताक्षर परिशिष्ट के लिए व्यक्तिगत रिकॉर्ड का PDF निर्यात करें)।
>
> ☐ Check: Same checks as the evidence statement.

**Driver-note disclaimer** — `pdf.evidence.driverNoteUnsigned`
> EN: Added by the driver. This note is not covered by the cryptographic signature.
>
> hi: चालक द्वारा जोड़ा गया। यह नोट क्रिप्टोग्राफ़िक हस्ताक्षर के दायरे में नहीं आता।
>
> ☐ Check: Correctly says the free-text note is NOT covered by the signature.

**Accessible-parking-permit gate** — `result.permitRequired.copy`
> EN: Parking here without a valid accessible parking permit clearly displayed is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot.
>
> hi: वैध सुलभ पार्किंग परमिट साफ़ दिखाए बिना यहाँ पार्क करना अपराध है। विक्टोरिया में जुर्माना $400 या उससे ज़्यादा है, और यह जगह उन लोगों के लिए आरक्षित है जिन्हें इसकी ज़रूरत है। अगर आपके पास परमिट नहीं है, तो कोई दूसरी जगह स्कैन करें।
>
> ☐ Check: States the offence and the $400 figure accurately; the permit term is current and respectful; no moralising.

**Permit-zone gate** — `result.permitZone.copy`
> EN: This is a residential or business permit zone. You can park here only if you hold a valid permit for this area. Council inspectors check the permit number against the area. A permit for the next block over doesn't count.
>
> hi: यह आवासीय या व्यावसायिक परमिट क्षेत्र है। आप यहाँ तभी पार्क कर सकते हैं जब आपके पास इस क्षेत्र का वैध परमिट हो। निरीक्षक परमिट नंबर को क्षेत्र से मिलाकर जाँचते हैं — बगल वाले ब्लॉक का परमिट यहाँ नहीं चलता।
>
> ☐ Check: States the permit-zone rule accurately.

**KMS signing explainer** — `privacy.signingCopy`
> EN: When you sign in (or stay anonymous, both work), each record is signed by an AWS KMS-managed ECDSA P-256 key. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> for anyone (a council, court, insurer) to verify the evidence chain using <code>openssl dgst</code>. See the appendix in any exported PDF for the step-by-step.
>
> hi: जब आप साइन इन करते हैं (या गुमनाम रहते हैं — दोनों चलते हैं), तो हर रिकॉर्ड AWS KMS-प्रबंधित ECDSA P-256 कुंजी से हस्ताक्षरित होता है। निजी कुंजी AWS से कभी बाहर नहीं जाती। सार्वजनिक कुंजी <a>/parkproof-public-key.pem</a> पर प्रकाशित है, ताकि कोई भी (परिषद, अदालत या बीमाकर्ता) <code>openssl dgst</code> से सबूत श्रृंखला सत्यापित कर सके — चरण-दर-चरण तरीके के लिए किसी भी निर्यात की गई PDF का परिशिष्ट देखें।
>
> ☐ Check: The public-key / verify-the-chain explanation is accurate and does not overclaim.

**Appeal disclaimer** — `appeal.reviewDisclaimer`
> EN: The AI draft is a starting point. Read carefully, edit the letter to match your voice and circumstances, and verify every claim before sending. ParkProof doesn't lodge the appeal for you.
>
> hi: AI का मसौदा बस शुरुआती बिंदु है। ध्यान से पढ़ें, पत्र को अपनी भाषा और हालात के हिसाब से बदलें, और भेजने से पहले हर दावे की पुष्टि कर लें। ParkProof आपकी ओर से अपील दाख़िल नहीं करता।
>
> ☐ Check: Clear that this is a starting draft, not legal advice, and that ParkProof does not lodge the appeal.

---

### Vietnamese (`vi`)

_council/fine/review verified against council pages; permit giấy phép đỗ xe tiếp cận_

**Signature claim — MOST IMPORTANT** — `pdf.signature.intro`
> EN: This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification.
>
> vi: Hồ sơ bằng chứng này được ký bằng khóa riêng do AWS KMS của ParkProof quản lý tại thời điểm lưu. Chữ ký cho phép bất kỳ bên thứ ba nào (hội đồng địa phương, tòa án, công ty bảo hiểm) xác minh rằng siêu dữ liệu và mã băm ảnh bên dưới chưa bị thay đổi kể từ dấu thời gian signed_at. Khóa riêng không bao giờ rời khỏi AWS; khóa công khai được công bố rộng rãi để xác minh.
>
> ☐ Check: Must say the signature lets a third party VERIFY the record HAS NOT BEEN ALTERED (detection). It must NOT say the record cannot be altered / is unchangeable (prevention).

**Signature appendix title** — `pdf.signature.title`
> EN: Cryptographic signature
>
> vi: Chữ ký mã hóa
>
> ☐ Check: A precise term for a cryptographic/digital signature.

**"Signed" badge** — `session.cryptoSigned`
> EN: Cryptographically signed
>
> vi: Đã ký bằng mã hoá
>
> ☐ Check: Same precise signature term, consistent with the appendix.

**Evidence-record statement** — `pdf.evidence.statement`
> EN: This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.
>
> vi: Hồ sơ này được ParkProof tạo tự động tại thời điểm đỗ xe. Dấu thời gian đến nơi, tọa độ GPS, bản dịch biển báo và các ảnh chụp tạo thành một hồ sơ bằng chứng cùng thời điểm, phù hợp để đính kèm khi yêu cầu xem xét lại vé phạt đỗ xe gửi đến hội đồng địa phương Úc có thẩm quyền.
>
> ☐ Check: Names the correct council body; matches what a real council calls the review process; claims only what is true.

**Full-export statement** — `pdf.fullExport.intro`
> EN: This document gathers every parking record saved to this ParkProof account. Each record was captured at the moment of parking with GPS, photographs, and an AI-translated reading of the parking sign. Where a record was signed with the ParkProof KMS key, the badge on that section indicates a verifiable cryptographic signature exists (export the individual record PDF for the full signature appendix).
>
> vi: Tài liệu này tập hợp mọi bản ghi đỗ xe đã lưu vào tài khoản ParkProof này. Mỗi bản ghi được ghi nhận ngay lúc đỗ xe kèm GPS, ảnh chụp và bản dịch biển báo do AI thực hiện. Nếu một bản ghi đã được ký bằng khóa KMS của ParkProof, huy hiệu trên mục đó cho biết có chữ ký mã hóa có thể xác minh (xuất PDF cho từng bản ghi để xem phụ lục chữ ký đầy đủ).
>
> ☐ Check: Same checks as the evidence statement.

**Driver-note disclaimer** — `pdf.evidence.driverNoteUnsigned`
> EN: Added by the driver. This note is not covered by the cryptographic signature.
>
> vi: Do tài xế bổ sung. Ghi chú này không được chữ ký mã hóa bảo vệ.
>
> ☐ Check: Correctly says the free-text note is NOT covered by the signature.

**Accessible-parking-permit gate** — `result.permitRequired.copy`
> EN: Parking here without a valid accessible parking permit clearly displayed is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot.
>
> vi: Đỗ xe ở đây mà không có giấy phép đỗ xe tiếp cận hợp lệ được hiển thị rõ ràng là vi phạm. Tại Victoria, mức phạt là $400 trở lên, và chỗ đỗ này dành riêng cho người cần đến nó. Nếu bạn không có giấy phép, hãy quét một chỗ khác.
>
> ☐ Check: States the offence and the $400 figure accurately; the permit term is current and respectful; no moralising.

**Permit-zone gate** — `result.permitZone.copy`
> EN: This is a residential or business permit zone. You can park here only if you hold a valid permit for this area. Council inspectors check the permit number against the area. A permit for the next block over doesn't count.
>
> vi: Đây là khu vực giấy phép cho cư dân hoặc doanh nghiệp. Bạn chỉ đỗ được ở đây nếu có giấy phép hợp lệ cho khu vực này. Cán bộ hội đồng địa phương đối chiếu số giấy phép với khu vực — giấy phép của khu bên cạnh không được tính.
>
> ☐ Check: States the permit-zone rule accurately.

**KMS signing explainer** — `privacy.signingCopy`
> EN: When you sign in (or stay anonymous, both work), each record is signed by an AWS KMS-managed ECDSA P-256 key. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> for anyone (a council, court, insurer) to verify the evidence chain using <code>openssl dgst</code>. See the appendix in any exported PDF for the step-by-step.
>
> vi: Khi bạn đăng nhập (hoặc cứ giữ ẩn danh, cả hai đều được), mỗi bản ghi được ký bằng khoá ECDSA P-256 do AWS KMS quản lý. Khoá riêng không bao giờ rời khỏi AWS. Khoá công khai được công bố tại <a>/parkproof-public-key.pem</a> để bất cứ ai (hội đồng địa phương, toà án, công ty bảo hiểm) đều có thể xác minh chuỗi bằng chứng bằng <code>openssl dgst</code>. Xem phụ lục trong mỗi PDF đã xuất để biết hướng dẫn từng bước.
>
> ☐ Check: The public-key / verify-the-chain explanation is accurate and does not overclaim.

**Appeal disclaimer** — `appeal.reviewDisclaimer`
> EN: The AI draft is a starting point. Read carefully, edit the letter to match your voice and circumstances, and verify every claim before sending. ParkProof doesn't lodge the appeal for you.
>
> vi: Bản nháp do AI tạo chỉ là điểm khởi đầu. Hãy đọc kỹ, sửa thư cho hợp với giọng văn và hoàn cảnh của bạn, và kiểm chứng mọi điều trước khi gửi. ParkProof không nộp khiếu nại thay bạn.
>
> ☐ Check: Clear that this is a starting draft, not legal advice, and that ParkProof does not lodge the appeal.

---

### Indonesian (`id`)

_council dewan kota verified; permit izin parkir aksesibel_

**Signature claim — MOST IMPORTANT** — `pdf.signature.intro`
> EN: This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification.
>
> id: Catatan bukti ini ditandatangani oleh kunci privat AWS KMS ParkProof saat penyimpanan. Tanda tangan memungkinkan pihak ketiga mana pun (dewan kota, pengadilan, asuransi) memverifikasi bahwa metadata dan hash foto di bawah tidak diubah sejak stempel waktu signed_at. Kunci privat tidak pernah meninggalkan AWS; kunci publik diterbitkan terbuka untuk verifikasi.
>
> ☐ Check: Must say the signature lets a third party VERIFY the record HAS NOT BEEN ALTERED (detection). It must NOT say the record cannot be altered / is unchangeable (prevention).

**Signature appendix title** — `pdf.signature.title`
> EN: Cryptographic signature
>
> id: Tanda tangan kriptografis
>
> ☐ Check: A precise term for a cryptographic/digital signature.

**"Signed" badge** — `session.cryptoSigned`
> EN: Cryptographically signed
>
> id: Ditandatangani kriptografis
>
> ☐ Check: Same precise signature term, consistent with the appendix.

**Evidence-record statement** — `pdf.evidence.statement`
> EN: This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.
>
> id: Catatan ini dibuat secara otomatis oleh ParkProof saat parkir. Stempel waktu kedatangan, koordinat GPS, terjemahan rambu, dan foto-foto merupakan catatan bukti kontemporer yang sesuai untuk dilampirkan ke pengajuan tinjauan denda parkir dengan dewan kota lokal Australia yang relevan.
>
> ☐ Check: Names the correct council body; matches what a real council calls the review process; claims only what is true.

**Full-export statement** — `pdf.fullExport.intro`
> EN: This document gathers every parking record saved to this ParkProof account. Each record was captured at the moment of parking with GPS, photographs, and an AI-translated reading of the parking sign. Where a record was signed with the ParkProof KMS key, the badge on that section indicates a verifiable cryptographic signature exists (export the individual record PDF for the full signature appendix).
>
> id: Dokumen ini mengumpulkan setiap catatan parkir yang disimpan ke akun ParkProof ini. Setiap catatan ditangkap saat parkir dengan GPS, foto, dan pembacaan rambu parkir yang diterjemahkan AI. Di mana catatan ditandatangani dengan kunci KMS ParkProof, lencana di bagian itu menunjukkan tanda tangan kriptografis yang dapat diverifikasi ada (ekspor PDF catatan individual untuk lampiran tanda tangan lengkap).
>
> ☐ Check: Same checks as the evidence statement.

**Driver-note disclaimer** — `pdf.evidence.driverNoteUnsigned`
> EN: Added by the driver. This note is not covered by the cryptographic signature.
>
> id: Ditambahkan oleh pengemudi. Catatan ini tidak tercakup oleh tanda tangan kriptografis.
>
> ☐ Check: Correctly says the free-text note is NOT covered by the signature.

**Accessible-parking-permit gate** — `result.permitRequired.copy`
> EN: Parking here without a valid accessible parking permit clearly displayed is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot.
>
> id: Parkir di sini tanpa izin parkir aksesibel sah yang ditampilkan dengan jelas adalah pelanggaran. Di Victoria dendanya $400 atau lebih, dan tempat ini dikhususkan untuk orang yang membutuhkannya. Jika kamu tidak punya, pindai tempat lain.
>
> ☐ Check: States the offence and the $400 figure accurately; the permit term is current and respectful; no moralising.

**Permit-zone gate** — `result.permitZone.copy`
> EN: This is a residential or business permit zone. You can park here only if you hold a valid permit for this area. Council inspectors check the permit number against the area. A permit for the next block over doesn't count.
>
> id: Ini zona izin penduduk atau bisnis. Kamu cuma boleh parkir di sini kalau punya izin sah untuk area ini. Inspektur dewan kota mencocokkan nomor izin dengan areanya. Izin untuk blok sebelah tidak berlaku.
>
> ☐ Check: States the permit-zone rule accurately.

**KMS signing explainer** — `privacy.signingCopy`
> EN: When you sign in (or stay anonymous, both work), each record is signed by an AWS KMS-managed ECDSA P-256 key. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> for anyone (a council, court, insurer) to verify the evidence chain using <code>openssl dgst</code>. See the appendix in any exported PDF for the step-by-step.
>
> id: Saat kamu masuk (atau tetap anonim, dua-duanya jalan), setiap catatan ditandatangani oleh kunci AWS KMS ECDSA P-256 yang dikelola. Kunci privatnya tidak pernah meninggalkan AWS. Kunci publiknya diterbitkan di <a>/parkproof-public-key.pem</a> supaya siapa saja (dewan kota, pengadilan, asuransi) bisa memverifikasi rantai buktinya pakai <code>openssl dgst</code>. Lihat lampiran di PDF ekspor mana pun untuk langkah demi langkahnya.
>
> ☐ Check: The public-key / verify-the-chain explanation is accurate and does not overclaim.

**Appeal disclaimer** — `appeal.reviewDisclaimer`
> EN: The AI draft is a starting point. Read carefully, edit the letter to match your voice and circumstances, and verify every claim before sending. ParkProof doesn't lodge the appeal for you.
>
> id: Draf AI ini titik awal. Baca baik-baik, sesuaikan suratnya dengan gaya bahasa dan situasimu, dan verifikasi tiap klaim sebelum mengirim. ParkProof tidak mengajukan bandingnya untukmu.
>
> ☐ Check: Clear that this is a starting draft, not legal advice, and that ParkProof does not lodge the appeal.

---

### Italian (`it`)

_comune/multa/ricorso verified; permit parcheggio accessibile_

**Signature claim — MOST IMPORTANT** — `pdf.signature.intro`
> EN: This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification.
>
> it: Questo documento probatorio è stato firmato dalla chiave privata gestita da AWS KMS di ParkProof al momento del salvataggio. La firma consente a qualsiasi terza parte (comune, tribunale, assicurazione) di verificare che i metadati e gli hash delle foto qui sotto non siano stati alterati dopo il timestamp signed_at. La chiave privata non lascia mai AWS; la chiave pubblica è pubblicata apertamente per consentire la verifica.
>
> ☐ Check: Must say the signature lets a third party VERIFY the record HAS NOT BEEN ALTERED (detection). It must NOT say the record cannot be altered / is unchangeable (prevention).

**Signature appendix title** — `pdf.signature.title`
> EN: Cryptographic signature
>
> it: Firma crittografica
>
> ☐ Check: A precise term for a cryptographic/digital signature.

**"Signed" badge** — `session.cryptoSigned`
> EN: Cryptographically signed
>
> it: Firmato crittograficamente
>
> ☐ Check: Same precise signature term, consistent with the appendix.

**Evidence-record statement** — `pdf.evidence.statement`
> EN: This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.
>
> it: Questo documento è stato generato automaticamente da ParkProof al momento del parcheggio. L'orario di arrivo, le coordinate GPS, la traduzione del cartello e le fotografie costituiscono un registro probatorio contestuale, idoneo a essere allegato a una richiesta di revisione di una contravvenzione di sosta presso il comune australiano competente.
>
> ☐ Check: Names the correct council body; matches what a real council calls the review process; claims only what is true.

**Full-export statement** — `pdf.fullExport.intro`
> EN: This document gathers every parking record saved to this ParkProof account. Each record was captured at the moment of parking with GPS, photographs, and an AI-translated reading of the parking sign. Where a record was signed with the ParkProof KMS key, the badge on that section indicates a verifiable cryptographic signature exists (export the individual record PDF for the full signature appendix).
>
> it: Questo documento raccoglie ogni record di parcheggio salvato in questo account ParkProof. Ogni record è stato acquisito al momento del parcheggio con GPS, fotografie e una lettura del cartello tradotta dall'AI. Se un record è stato firmato con la chiave KMS di ParkProof, il distintivo in quella sezione indica che esiste una firma crittografica verificabile (esporta il PDF del singolo record per l'appendice completa della firma).
>
> ☐ Check: Same checks as the evidence statement.

**Driver-note disclaimer** — `pdf.evidence.driverNoteUnsigned`
> EN: Added by the driver. This note is not covered by the cryptographic signature.
>
> it: Aggiunta dal conducente. Questa nota non è coperta dalla firma crittografica.
>
> ☐ Check: Correctly says the free-text note is NOT covered by the signature.

**Accessible-parking-permit gate** — `result.permitRequired.copy`
> EN: Parking here without a valid accessible parking permit clearly displayed is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot.
>
> it: Parcheggiare qui senza un permesso di parcheggio accessibile valido chiaramente esposto è un'infrazione. In Victoria la multa è di $400 o più, e il posto è riservato a chi ne ha bisogno. Se non ne hai uno, scansiona un altro posto.
>
> ☐ Check: States the offence and the $400 figure accurately; the permit term is current and respectful; no moralising.

**Permit-zone gate** — `result.permitZone.copy`
> EN: This is a residential or business permit zone. You can park here only if you hold a valid permit for this area. Council inspectors check the permit number against the area. A permit for the next block over doesn't count.
>
> it: Questa è una zona a permesso residenziale o commerciale. Puoi parcheggiare qui solo se hai un permesso valido per quest'area. Gli ispettori comunali controllano il numero del permesso rispetto all'area: un permesso dell'isolato accanto non vale.
>
> ☐ Check: States the permit-zone rule accurately.

**KMS signing explainer** — `privacy.signingCopy`
> EN: When you sign in (or stay anonymous, both work), each record is signed by an AWS KMS-managed ECDSA P-256 key. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> for anyone (a council, court, insurer) to verify the evidence chain using <code>openssl dgst</code>. See the appendix in any exported PDF for the step-by-step.
>
> it: Quando accedi (o resti anonimo, entrambi funzionano), ogni record viene firmato da una chiave ECDSA P-256 gestita da AWS KMS. La chiave privata non lascia mai AWS. La chiave pubblica è pubblicata su <a>/parkproof-public-key.pem</a> affinché chiunque (un comune, un tribunale, un assicuratore) possa verificare la catena di prove con <code>openssl dgst</code>. Vedi l'appendice in qualunque PDF esportato per la procedura passo-passo.
>
> ☐ Check: The public-key / verify-the-chain explanation is accurate and does not overclaim.

**Appeal disclaimer** — `appeal.reviewDisclaimer`
> EN: The AI draft is a starting point. Read carefully, edit the letter to match your voice and circumstances, and verify every claim before sending. ParkProof doesn't lodge the appeal for you.
>
> it: La bozza dell'AI è un punto di partenza. Leggila con attenzione, adatta la lettera al tuo tono e alla tua situazione e verifica ogni affermazione prima di inviarla. ParkProof non presenta il ricorso al posto tuo.
>
> ☐ Check: Clear that this is a starting draft, not legal advice, and that ParkProof does not lodge the appeal.

---

### Greek (`el`)

_δήμος/πρόστιμο/ένσταση verified; permit προσβάσιμης στάθμευσης_

**Signature claim — MOST IMPORTANT** — `pdf.signature.intro`
> EN: This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification.
>
> el: Η εγγραφή αυτή υπογράφηκε από το ιδιωτικό κλειδί του ParkProof, που διαχειρίζεται μέσω AWS KMS, τη στιγμή της αποθήκευσης. Η υπογραφή επιτρέπει σε οποιονδήποτε τρίτο (δήμο, δικαστήριο, ασφαλιστική) να επαληθεύσει ότι τα μεταδεδομένα και τα hash των φωτογραφιών παρακάτω δεν έχουν αλλοιωθεί από τη χρονοσφραγίδα signed_at. Το ιδιωτικό κλειδί δεν φεύγει ποτέ από το AWS· το δημόσιο κλειδί δημοσιεύεται ανοιχτά για επαλήθευση.
>
> ☐ Check: Must say the signature lets a third party VERIFY the record HAS NOT BEEN ALTERED (detection). It must NOT say the record cannot be altered / is unchangeable (prevention).

**Signature appendix title** — `pdf.signature.title`
> EN: Cryptographic signature
>
> el: Κρυπτογραφική υπογραφή
>
> ☐ Check: A precise term for a cryptographic/digital signature.

**"Signed" badge** — `session.cryptoSigned`
> EN: Cryptographically signed
>
> el: Κρυπτογραφικά υπογεγραμμένη
>
> ☐ Check: Same precise signature term, consistent with the appendix.

**Evidence-record statement** — `pdf.evidence.statement`
> EN: This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.
>
> el: Η εγγραφή αυτή δημιουργήθηκε αυτόματα από το ParkProof τη στιγμή της στάθμευσης. Η χρονοσφραγίδα άφιξης, οι συντεταγμένες GPS, η μετάφραση της πινακίδας και οι φωτογραφίες συνιστούν σύγχρονο αποδεικτικό αρχείο, κατάλληλο για επισύναψη σε αίτημα επανεξέτασης κλήσης παράνομης στάθμευσης προς τον αρμόδιο αυστραλιανό τοπικό δήμο.
>
> ☐ Check: Names the correct council body; matches what a real council calls the review process; claims only what is true.

**Full-export statement** — `pdf.fullExport.intro`
> EN: This document gathers every parking record saved to this ParkProof account. Each record was captured at the moment of parking with GPS, photographs, and an AI-translated reading of the parking sign. Where a record was signed with the ParkProof KMS key, the badge on that section indicates a verifiable cryptographic signature exists (export the individual record PDF for the full signature appendix).
>
> el: Το έγγραφο αυτό συγκεντρώνει κάθε αρχείο στάθμευσης που έχει αποθηκευτεί σε αυτόν τον λογαριασμό ParkProof. Κάθε αρχείο καταγράφηκε τη στιγμή της στάθμευσης με GPS, φωτογραφίες και μετάφραση της πινακίδας από AI. Όπου ένα αρχείο υπογράφηκε με το κλειδί KMS του ParkProof, το διακριτικό στην ενότητα δείχνει ότι υπάρχει επαληθεύσιμη κρυπτογραφική υπογραφή (εξάγαγε το PDF του επιμέρους αρχείου για το πλήρες παράρτημα υπογραφής).
>
> ☐ Check: Same checks as the evidence statement.

**Driver-note disclaimer** — `pdf.evidence.driverNoteUnsigned`
> EN: Added by the driver. This note is not covered by the cryptographic signature.
>
> el: Προστέθηκε από τον οδηγό. Η σημείωση αυτή δεν καλύπτεται από την κρυπτογραφική υπογραφή.
>
> ☐ Check: Correctly says the free-text note is NOT covered by the signature.

**Accessible-parking-permit gate** — `result.permitRequired.copy`
> EN: Parking here without a valid accessible parking permit clearly displayed is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot.
>
> el: Αν παρκάρεις εδώ χωρίς έγκυρη άδεια προσβάσιμης στάθμευσης σε εμφανές σημείο, διαπράττεις παράβαση. Στη Βικτώρια το πρόστιμο είναι $400 και πάνω, και η θέση προορίζεται για όσους τη χρειάζονται. Αν δεν έχεις άδεια, σάρωσε άλλη θέση.
>
> ☐ Check: States the offence and the $400 figure accurately; the permit term is current and respectful; no moralising.

**Permit-zone gate** — `result.permitZone.copy`
> EN: This is a residential or business permit zone. You can park here only if you hold a valid permit for this area. Council inspectors check the permit number against the area. A permit for the next block over doesn't count.
>
> el: Αυτή είναι ζώνη με άδεια κατοίκων ή επιχειρήσεων. Μπορείς να παρκάρεις εδώ μόνο αν έχεις έγκυρη άδεια για τη συγκεκριμένη περιοχή. Οι ελεγκτές του δήμου ελέγχουν τον αριθμό της άδειας σε σχέση με την περιοχή. Μια άδεια από το διπλανό τετράγωνο δεν μετράει.
>
> ☐ Check: States the permit-zone rule accurately.

**KMS signing explainer** — `privacy.signingCopy`
> EN: When you sign in (or stay anonymous, both work), each record is signed by an AWS KMS-managed ECDSA P-256 key. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> for anyone (a council, court, insurer) to verify the evidence chain using <code>openssl dgst</code>. See the appendix in any exported PDF for the step-by-step.
>
> el: Όταν συνδέεσαι (ή μένεις ανώνυμος — και τα δύο λειτουργούν), κάθε αρχείο υπογράφεται από κλειδί ECDSA P-256 διαχειριζόμενο από AWS KMS. Το ιδιωτικό κλειδί δεν φεύγει ποτέ από το AWS. Το δημόσιο κλειδί δημοσιεύεται στο <a>/parkproof-public-key.pem</a> ώστε οποιοσδήποτε (δήμος, δικαστήριο, ασφαλιστής) να μπορεί να επαληθεύσει την αλυσίδα αποδείξεων χρησιμοποιώντας <code>openssl dgst</code>. Δες το παράρτημα σε οποιοδήποτε εξαγόμενο PDF για βήμα-βήμα οδηγίες.
>
> ☐ Check: The public-key / verify-the-chain explanation is accurate and does not overclaim.

**Appeal disclaimer** — `appeal.reviewDisclaimer`
> EN: The AI draft is a starting point. Read carefully, edit the letter to match your voice and circumstances, and verify every claim before sending. ParkProof doesn't lodge the appeal for you.
>
> el: Το προσχέδιο του AI είναι μόνο αφετηρία. Διάβασε προσεκτικά, επεξεργάσου την επιστολή ώστε να ταιριάζει στο ύφος και τις περιστάσεις σου, και επαλήθευσε κάθε ισχυρισμό πριν τη στείλεις. Το ParkProof δεν υποβάλλει την ένσταση για σένα.
>
> ☐ Check: Clear that this is a starting draft, not legal advice, and that ParkProof does not lodge the appeal.

---
