# Sample output

Posts produced from real PlacidWay pages, each shown with the guardrail result
that `lib/guardrails.js` actually returns for it.

Regenerate with: `node scripts/make-samples.mjs --from=dry-run`

> **Provenance.** Every guardrail result below is real: the live return value of
> `runRuleChecks()` against the content extracted from the linked page. Each post
> states its own origin under the heading.
>
> The passing posts were written by the model through the full pipeline —
> extraction, generation, both guardrail layers. The rejected ones are
> hand-written counter-examples, kept deliberately: a sample set that only shows
> successes says nothing about where the line is.

---

## PASS — package-1

- **Source page:** [IntimiPlasty™: Aesthetic Gynecology in Egypt](https://www.placidway.com/package/8746/IntimiPlastyTM-Aesthetic-Gynecology-Labiaplasty-Vaginoplasty-Vaginal-Rejuvenation)
- **Content type:** package
- **Extracted via:** `json-ld:Product`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/thumb/1739838843Dr-Ashraf-Sabry-Fertility-and-OBGYN-Clinic.png)
- **Source price:** 2500 USD
- **Price policy for this run:** `PW_ALLOW_PRICE_MENTION=true`
- **Origin:** openai / gemini-3.1-flash-lite via scripts/dry-run.mjs
- **Note:** Generated in 1 attempt(s).

### Post

```text
Considering your options for aesthetic gynecology abroad?

The IntimiPlasty™ program in Cairo includes a private consultation, pre-operative tests, the procedure, anesthesia, medications, and follow-up care.
This program is priced at 2500 USD, with patients arranging their own travel and accommodation.
Dr. Ashraf Sabry offers a range of procedures including labiaplasty, vaginoplasty, and perineoplasty.

You can review the full details of this program here to help with your research.

https://www.placidway.com/package/8746/IntimiPlastyTM-Aesthetic-Gynecology-Labiaplasty-Vaginoplasty-Vaginal-Rejuvenation

#AestheticGynecology #MedicalTourism #IntimiPlasty
```

### Guardrail result

| Check | Value |
|---|---|
| Rule layer | **PASS** |
| Characters before link | 487 / 500 |
| Hashtags | 3 — #AestheticGynecology #MedicalTourism #IntimiPlasty |
| Non-hashtag lines before link | 5 |
| Figures used in copy | 2500 |
| Distinct figures found in source | 7 |
| Emoji | 1 |

**Reviewer (guardrail layer 2):** PASS

---

## PASS — article-2

- **Source page:** [Drug Rehab in Tijuana, Mexico | Recovery Guide](https://www.placidway.com/article/5672/Tijuana-Drug-Rehab-Why-Patients-Choose-Mexico-for-Recovery-and-Healing)
- **Content type:** article
- **Extracted via:** `json-ld:Article`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/article_thumb/1794233291Drug-rehabilitation-and-recovery-in-Tijuana,-Mexico-(2).jpg)
- **Source price:** none published
- **Price policy for this run:** prices forbidden
- **Origin:** openai / gemini-3.5-flash via scripts/dry-run.mjs
- **Note:** Generated in 1 attempt(s).

### Post

```text
Planning drug rehab in Tijuana requires aligning treatment with life at home.

Check how detox days are counted and if medical supervision is provided on site.
Factor in Mexican national holidays, staffing schedules, and border crossing times.
Schedule your U.S. follow-up care and resolve medication plans before traveling.

Read the scheduling guide to plan a safe treatment timeline:
https://www.placidway.com/article/5672/Tijuana-Drug-Rehab-Why-Patients-Choose-Mexico-for-Recovery-and-Healing

#AddictionRecovery #TijuanaRehab #MedicalTravel #TreatmentPlanning
```

### Guardrail result

| Check | Value |
|---|---|
| Rule layer | **PASS** |
| Characters before link | 386 / 500 |
| Hashtags | 4 — #AddictionRecovery #TijuanaRehab #MedicalTravel #TreatmentPlanning |
| Non-hashtag lines before link | 5 |
| Figures used in copy | none |
| Distinct figures found in source | 15 |
| Emoji | 0 |

**Advisories** (logged, shown to the reviewer, non-blocking)

- `ADVISORY_EFFICACY_WORD` — efficacy wording — verify it is attributed to the source → `safe`

**Reviewer (guardrail layer 2):** PASS

---

## PASS — article-3

- **Source page:** [IVF in Mexico vs USA: Cost & Success Rates](https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples)
- **Content type:** article
- **Extracted via:** `json-ld:Article`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/article_thumb/1794230047IVF-treatment-comparison-between-Mexico-and-the-USA-(2).jpg)
- **Source price:** none published
- **Price policy for this run:** prices forbidden
- **Origin:** openai / gemini-3.5-flash via scripts/dry-run.mjs
- **Note:** Generated in 1 attempt(s).

### Post

```text
Planning IVF abroad involves more than just booking flights. ✈️

A base-cycle price does not always cover medications, extra testing, or embryo freezing.
Care dates depend on clinical progress, not your original travel itinerary.
Confirming follow-up care with your local clinician before leaving is essential.

Read our guide to help plan your fertility travel decisions.
https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples
#FertilityCare #IVFAbroad #CrossBorderHealthcare #PlacidWay
```

### Guardrail result

| Check | Value |
|---|---|
| Rule layer | **PASS** |
| Characters before link | 372 / 500 |
| Hashtags | 4 — #FertilityCare #IVFAbroad #CrossBorderHealthcare #PlacidWay |
| Non-hashtag lines before link | 5 |
| Figures used in copy | none |
| Distinct figures found in source | 21 |
| Emoji | 1 |

**Reviewer (guardrail layer 2):** PASS

---

## REJECTED — rejected-medical-claims

- **Source page:** [IVF in Mexico vs USA: Cost & Success Rates](https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples)
- **Content type:** article
- **Extracted via:** `json-ld:Article`
- **Featured image:** [yes](https://www.placidway.com/cdn-cgi/image/quality=85,fit=pad,width=1200,height=630/https://placidwaycdn.s3.amazonaws.com/images/article_thumb/1794230047IVF-treatment-comparison-between-Mexico-and-the-USA-(2).jpg)
- **Source price:** none published
- **Price policy for this run:** prices forbidden
- **Origin:** hand-written counter-example, included to show the guardrail rejecting
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
- **Origin:** hand-written counter-example, included to show the guardrail rejecting
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
