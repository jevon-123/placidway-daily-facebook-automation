# Sample output

Posts produced from real PlacidWay pages, each shown with the guardrail result
that `lib/guardrails.js` actually returns for it.

Regenerate with: `node scripts/make-samples.mjs --from=reference`

> **Provenance.** The guardrail output below is real in every case — it is the
> live return value of `runRuleChecks()` against the page content extracted from
> `samples/fixtures/`. The post copy itself comes from the source named under each
> heading. To regenerate every post through the real model pipeline, set an API key
> and run `npm run dry-run -- --count=3`, then `node scripts/make-samples.mjs --from=dry-run`.

---

## PASS — ivf-mexico-usa

- **Source page:** [IVF in Mexico vs USA: Cost & Success Rates](https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples)
- **Content type:** article
- **Extracted via:** `json-ld:Article`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/article_thumb/1794230047IVF-treatment-comparison-between-Mexico-and-the-USA-(2).jpg)
- **Source price:** none published
- **Price policy for this run:** prices forbidden
- **Origin:** hand-written to prompts/generator.md (no API key required)
- **Note:** Article with no published price. Carries no figures at all, which is the safest shape for an evergreen post.

### Post

```text
The quote that looked affordable was not the whole budget.

A base-cycle price says nothing about medications, testing or a second transfer.
Insurance at home may cover bloodwork and still not cover the procedure abroad.
Retrieval dates follow your body, not your airline booking.

Compare what each option actually includes before you book anything.
https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples
#IVFAbroad #FertilityPlanning #MedicalTourism #PatientGuide
```

### Guardrail result

| Check | Value |
|---|---|
| Rule layer | **PASS** |
| Characters before link | 350 / 500 |
| Hashtags | 4 — #IVFAbroad #FertilityPlanning #MedicalTourism #PatientGuide |
| Non-hashtag lines before link | 5 |
| Figures used in copy | none |
| Distinct figures found in source | 21 |
| Emoji | 0 |

---

## PASS — tijuana-rehab-timing

- **Source page:** [Drug Rehab in Tijuana, Mexico | Recovery Guide](https://www.placidway.com/article/5672/Tijuana-Drug-Rehab-Why-Patients-Choose-Mexico-for-Recovery-and-Healing)
- **Content type:** article
- **Extracted via:** `json-ld:Article`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/article_thumb/1794233291Drug-rehabilitation-and-recovery-in-Tijuana,-Mexico-(2).jpg)
- **Source price:** none published
- **Price policy for this run:** prices forbidden
- **Origin:** hand-written to prompts/generator.md (no API key required)
- **Note:** Article on scheduling. Every line maps to a question the source tells patients to ask.

### Post

```text
The admission week and the family wedding sat on two different calendars.

Ask whether detox is on site, arranged elsewhere, or not offered at all.
Check intake availability against public holidays and border crossing times.
Request a written discharge and aftercare plan before you commit to a date.

Read how patients think through the timing of a stay.
https://www.placidway.com/article/5672/Tijuana-Drug-Rehab-Why-Patients-Choose-Mexico-for-Recovery-and-Healing
#AddictionRecovery #RehabAbroad #MedicalTourism #RecoveryPlanning
```

### Guardrail result

| Check | Value |
|---|---|
| Rule layer | **PASS** |
| Characters before link | 355 / 500 |
| Hashtags | 4 — #AddictionRecovery #RehabAbroad #MedicalTourism #RecoveryPlanning |
| Non-hashtag lines before link | 5 |
| Figures used in copy | none |
| Distinct figures found in source | 15 |
| Emoji | 0 |

---

## PASS — kfshrc-mastectomy-package

- **Source page:** [Mastectomy in Saudi Arabia | KFSHRC](https://www.placidway.com/package/8675/Unilateral-Mastectomy-for-Breast-Cancer-Package-in-Riyadh-Saudi-Arabia-at-KFSHRC)
- **Content type:** package
- **Extracted via:** `json-ld:Product`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/package/1792464058Unilateral-Mastectomy-for-Breast-Cancer-Package-in-Saudi-Arabia-at-KFSHRC-Thumbnail.jpg)
- **Source price:** 16000 USD
- **Price policy for this run:** `PW_ALLOW_PRICE_MENTION=true`
- **Origin:** hand-written to prompts/generator.md (no API key required)
- **Note:** Package with a structured price. Run with PW_ALLOW_PRICE_MENTION=true: every figure is checked against the page's own JSON-LD offers block.

### Post

```text
Planning cancer surgery abroad starts with knowing what a price actually covers.

The unilateral mastectomy package at KFSHRC in Riyadh is listed at $16,000, all-inclusive.
Length of stay is 1-2 days inpatient, with 7-14 days of outpatient drain management.
Sentinel lymph node biopsy is included where clinically indicated.

See the full package and what the bundle contains.
https://www.placidway.com/package/8675/Unilateral-Mastectomy-for-Breast-Cancer-Package-in-Riyadh-Saudi-Arabia-at-KFSHRC
#BreastCancerCare #SurgicalOncology #MedicalTourism #SaudiArabia
```

### Guardrail result

| Check | Value |
|---|---|
| Rule layer | **PASS** |
| Characters before link | 376 / 500 |
| Hashtags | 4 — #BreastCancerCare #SurgicalOncology #MedicalTourism #SaudiArabia |
| Non-hashtag lines before link | 5 |
| Figures used in copy | 16,000, 1, 2, 7, 14 |
| Distinct figures found in source | 21 |
| Emoji | 0 |

---

## REJECTED — rejected-medical-claims

- **Source page:** [IVF in Mexico vs USA: Cost & Success Rates](https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples)
- **Content type:** article
- **Extracted via:** `json-ld:Article`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/article_thumb/1794230047IVF-treatment-comparison-between-Mexico-and-the-USA-(2).jpg)
- **Source price:** none published
- **Price policy for this run:** prices forbidden
- **Origin:** hand-written to prompts/generator.md (no API key required)
- **Note:** Deliberately bad. Demonstrates the claim and grounding rules firing together.

### Post

```text
IVF abroad can finally cure infertility for couples who have waited years.

Clinics in Cancun report a 92% success rate for patients under 40.
The procedure is completely painless and risk-free.
Results are guaranteed or your money back.

Start your journey today.
https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples
#IVF #Fertility #FertilityAbroad
```

### Guardrail result

| Check | Value |
|---|---|
| Rule layer | **FAIL** |
| Characters before link | 264 / 500 |
| Hashtags | 3 — #IVF #Fertility #FertilityAbroad |
| Non-hashtag lines before link | 5 |
| Figures used in copy | 92%, 40 |
| Distinct figures found in source | 21 |
| Emoji | 0 |

**Violations**

- `CLAIM_CURE` — claims a cure → `cure`
- `CLAIM_GUARANTEE` — promises an outcome → `guaranteed`
- `CLAIM_RISK_FREE` — denies clinical risk → `risk-free`
- `CLAIM_PAINLESS` — promises a pain-free experience → `painless`
- `UNGROUNDED_NUMBER` — figure does not appear anywhere in the source page → `92%, 40`

**Advisories** (logged, shown to the reviewer, non-blocking)

- `ADVISORY_SUCCESS_RATE` — mentions success rates — any figure must be grounded → `success rate`
- `NO_CTA_CUE` — no recognisable call to action

---

## REJECTED — rejected-invented-price

- **Source page:** [Drug Rehab in Tijuana, Mexico | Recovery Guide](https://www.placidway.com/article/5672/Tijuana-Drug-Rehab-Why-Patients-Choose-Mexico-for-Recovery-and-Healing)
- **Content type:** article
- **Extracted via:** `json-ld:Article`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/article_thumb/1794233291Drug-rehabilitation-and-recovery-in-Tijuana,-Mexico-(2).jpg)
- **Source price:** none published
- **Price policy for this run:** prices forbidden
- **Origin:** hand-written to prompts/generator.md (no API key required)
- **Note:** Deliberately bad. The price is invented, the superlative is unverifiable, and the recovery promise is a medical claim.

### Post

```text
Residential rehab in Tijuana starts at just $4,500 for a 30-day program.

The best clinics in Mexico guarantee a full recovery.
Most patients return home completely drug-free within one month.

Secure your spot now.
https://www.placidway.com/article/5672/Tijuana-Drug-Rehab-Why-Patients-Choose-Mexico-for-Recovery-and-Healing
#Rehab #Recovery #Tijuana #Detox
```

### Guardrail result

| Check | Value |
|---|---|
| Rule layer | **FAIL** |
| Characters before link | 215 / 500 |
| Hashtags | 4 — #Rehab #Recovery #Tijuana #Detox |
| Non-hashtag lines before link | 4 |
| Figures used in copy | 4,500, 30 |
| Distinct figures found in source | 15 |
| Emoji | 0 |

**Violations**

- `CLAIM_GUARANTEE` — promises an outcome → `guarantee`
- `CLAIM_SUPERLATIVE` — unverifiable superlative → `The best clinics`
- `PRICE_MENTION` — post states a price but ALLOW_PRICE_MENTION is off → `$4,500`

**Advisories** (logged, shown to the reviewer, non-blocking)

- `NO_CTA_CUE` — no recognisable call to action

---

**Totals:** 3 passed, 2 rejected, out of 5.
