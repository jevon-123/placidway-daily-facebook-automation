# Walkthrough preparation

The follow-up is 45 live minutes with the hiring team, and the ground rules say
you must be able to explain every part of what you submit. These are the
questions this design invites, with the honest answer to each.

Read `lib/guardrails.js` and `scripts/build-workflow.mjs` end to end before the
call. Those are the two files they are most likely to open.

---

## On extraction

**"Why not a headless browser?"**
The pages are server-rendered and the sitemap already carries `lastmod` and the
featured image. A run costs two HTTP requests. Puppeteer would add a Chromium
process and seconds per page to recover information already sitting in XML.
I'd reach for it if PlacidWay moved to client-side rendering, or if I needed
content behind an interaction.

**"Why JSON-LD instead of CSS selectors?"**
Structured data is machine-authored and changes more slowly than markup. A
redesign that moves `div.article-content` usually leaves the JSON-LD intact.
There are three tiers — JSON-LD, Open Graph, then a container selector — and
`extractedBy` is written to every log row, so a silent fallback shows up in the
sheet before it shows up in output quality.

**"What happens when they change their markup?"**
`scripts/fetch-fixtures.mjs` re-pulls real pages, and `npm test` asserts against
them. A structural change fails the tests rather than quietly degrading the
posts. The error handler also classifies sitemap-shaped failures as `EXTRACTION`
and pages a human rather than filing it as a transient blip.

**"Is 40 candidates enough?"**
It is a weak point and it's in the README. If PlacidWay publishes faster than we
post, older unposted items fall out of the window permanently. The real fix is
to walk the sitemap from the oldest unposted item rather than the newest, which
makes the dedupe store the cursor rather than a filter.

---

## On the guardrail

**"Why two layers? Isn't one enough?"**
They fail differently. The rules are deterministic and cheap, so they're right
every time about length, hashtags, links, forbidden phrases and numeric
grounding — but regex cannot see an implied promise. The reviewer catches
semantics but is itself a language model, so it is not a guarantee. Neither
alone is sufficient; together they cover most of the space.

**"Why does the reviewer not see the generator's reasoning?"**
Because it would rubber-stamp it. `composeValidator()` is passed only the source
and the finished post — deliberately not `grounding_notes`. There's a comment
on that in `lib/compose.js` saying exactly why.

**"What's your most valuable single check?"**
Numeric grounding. Pull every figure out of the post, pull every figure out of
the source, demand the first is a subset of the second. Hallucinated statistics
are the most likely and most damaging failure for medical content, and they're
cheap to detect. Integers ≤ 10 are exempt as ordinary prose.

**"Show me a false positive you had to fix."**
Yes — "success rate". The first version of the prohibited list banned it. Then I
noticed PlacidWay's own article is titled *"IVF in Mexico vs USA: Cost & Success
Rates"*. Banning the topic word rejects accurate posts, so I moved it to the
advisory list and let numeric grounding handle the figure. There's a regression
test named `does not block the phrase "success rates"` so it can't come back.
Same reasoning moved hashtag and URL text out of claim scanning — `#CancerCare`
was tripping a disease pattern.

**"What if the model returns garbage?"**
`parseVerdict()` fails closed: unparseable output is a `FAIL`, never a pass.
An unreadable generation becomes a `GENERATION_FAILED` violation that feeds the
retry loop rather than throwing.

**"Why retry with feedback rather than just regenerating?"**
A model told which line broke which rule fixes that line. A blind retry at a
higher temperature tends to reproduce the same mistake. After three attempts the
run is logged `rejected` and nothing publishes — a silent day beats a bad post.

**"How did you decide on prices?"**
Three states, kept distinct in code: no price on the page, price present but
citation disabled, price present and citation enabled. In the third case the
figure must equal `offers.price` exactly after normalisation, so `$16,000`,
`16000.0` and `16,000 USD` all compare equal. Default is off, because prices
change and an evergreen social post doesn't.

---

## On the architecture

**"Why is there a build step? Most people just export the workflow."**
Because n8n Code nodes can't import files, so the logic normally gets pasted
into the canvas and the version-controlled copy drifts within a week.
`build-workflow.mjs` inlines `lib/*.js` mechanically on every build, so the code
covered by the 37 assertions is byte-for-byte the code running at 07:00. The
cost is that you can't edit in the UI and export over these files — the JSON
carries a `meta.note` saying so.

**"How do you know the workflow is correct without running it?"**
`validate-workflow.mjs` proves the graph: every connection resolves, no orphans,
every Code node's JavaScript parses, every `$('Node Name')` reference names a
real node, every expression has balanced braces. What it can't prove is that
credential-bound resource locators resolve on a given instance — that's called
out in the README and has to be confirmed in the UI.

**"Why Google Sheets?"**
Not because it scales — because a reviewer can open it. For production it's a
Postgres table and `Choose Unposted Item` becomes an indexed `NOT EXISTS`
instead of reading every row. At one post a day, reading every row is fine for
years, and visibility is worth more than efficiency right now.

**"Why n8n over Make?"**
Code nodes. The guardrail is real logic, not a filter expression, and I wanted
it unit-tested outside the platform. n8n also self-hosts free, exports to
readable JSON that diffs in git, and has a native error-workflow hook.

**"Why HTTP Request nodes instead of the native OpenAI/Facebook nodes?"**
Explicitness and portability. The request body is visible and testable, and the
token lives in a header-auth credential so it never enters the export. It also
made the provider swap nearly free: because the body is built by
`toProviderBody()` in a Code node rather than configured in a vendor node, any
OpenAI-compatible endpoint — Gemini, Groq, OpenRouter, a local Ollama — is just
`PW_LLM_BASE_URL`. The native OpenAI node would have pinned me to one vendor.

**"Tell me about a bug you hit building this."**
The best one. On Gemini the generator kept returning unparseable output — no
error, HTTP 200, just not JSON. What leaked out was the tail of the model's own
arithmetic: `" + 87 + 1 + 87 + 1 + 88 = 422 chars"`. The cause was that
reasoning models spend the output budget thinking *before* they write, so
`max_tokens: 1200` — fine for a non-reasoning model — was consumed by reasoning
and hit the cap mid-thought. `finish_reason` said `length`, 48 visible tokens
out of 3277 used.

Two fixes: raise the default budget to 4000, and expose
`PW_LLM_REASONING_EFFORT`, which on the same call halved total token use. The
third fix matters more than either — `Parse Generated Post` now reports
`finish_reason` in its failure message, because truncation and malformed output
are indistinguishable downstream and have opposite remedies.

**"And an integration bug?"**
The Google Sheets node appends with `autoMapInputData`, which matches top-level
keys against column names. `Record Outcome` was returning
`{ ...envelope, row, status }`, so the only top-level key matching a column was
`status`. No error — just one near-empty row. Worse, n8n *creates* a column for
every unrecognised key, so that single run added seventeen junk columns named
`run`, `content`, `rules`, `verdict`… and permanently widened the sheet.

Three things came out of it: `Record Outcome` now emits the row object *as* the
item; the Sheets nodes read the spreadsheet ID from `$('Config')` rather than
from `$json`, because nodes downstream reshape the item freely; and
`scripts/reset-sheet.mjs` can restore a sheet to its declared columns. The
general lesson is that auto-mapping fails by writing something plausible rather
than by raising, which is the worst failure mode to have in an audit trail.

**"Doesn't dropping `response_format: json_object` make parsing fragile?"**
No, because it was never relied on. `readJsonLoose()` strips code fences and
finds the JSON object in prose, and a reply it still cannot parse becomes a
`GENERATION_FAILED` violation that the retry loop handles with feedback. Strict
JSON mode is an optimisation, not a dependency — which is exactly why the
pipeline runs on a free Gemini key without touching the code.

---

## On operations

**"The Facebook token expires. Then what?"**
That's the failure this is mostly built for. The error handler classifies it as
`AUTH` with severity `page` and says in words what to do, instead of surfacing
`HTTP 400`. The fix is to re-exchange for a long-lived Page token; the steps are
in the README. The honest gap: there's no automatic refresh, so it's a manual
runbook step.

**"What if PlacidWay goes down?"**
Node-level retries, 3× with 5 s backoff. If it still fails, the error workflow
classifies `UPSTREAM_5XX` at warn severity and the next scheduled run picks up.
Nothing is published from a partial fetch, because `isUsable()` rejects pages
below a body-length floor.

**"Could this double-post?"**
The dedupe read happens before generation and the log append happens after
publish, so a crash between them means an item posts without being recorded —
and could be chosen again. At one run a day with alerting on every failure it's
containable, but the correct fix is to claim the URL before publishing and
update the row after. Worth saying out loud rather than waiting to be asked.

---

## What to volunteer before they ask

Leading with your own limits reads as judgement, not weakness:

- Sheets won't scale, and the fix is known
- The approval webhook isn't authenticated
- The candidate window can permanently skip items
- Engagement read-back isn't built, though `fb_post_id` is already logged for it
- The sample posts were hand-written to the generator spec unless you
  regenerated them with a key — the guardrail output next to them is real either
  way, and `npm run dry-run -- --count=3` replaces them. **Do this before you
  submit if you have a key.**
