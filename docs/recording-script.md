# Screen recording plan (5–10 minutes)

The brief asks for a narrated recording showing a live run from extraction to
the AI-generated post, then the published or scheduled post on the test Page.

Target **7 minutes**. Shorter reads as thin; longer loses the room.

## Before you hit record

- [ ] `npm test` is green and the terminal is still showing it
- [ ] `node scripts/validate-workflow.mjs` is green
- [ ] Workflow imported, all five credentials connected, no red nodes
- [ ] `PW_PUBLISH_MODE=publish`, `PW_REVIEW_MODE=approval` for the demo run
      (simulate is the safe default, but the brief wants to see a real post)
- [ ] Google Sheet open in a tab, `runs` sheet visible with a few prior rows
- [ ] Telegram open and visible — ideally on a phone beside the screen
- [ ] Test Page open in a tab
- [ ] Clear a URL from the sheet, or set `PW_FORCE_CONTENT_TYPE=package`, so the
      run has something fresh to pick
- [ ] Close Slack, email, anything that can pop a notification
- [ ] Do one full rehearsal run. The live run in the recording should be the
      second time you see it work today, not the first.

## Beat sheet

**0:00–0:45 — What and why**

> "PlacidWay publishes treatment packages, clinic profiles and articles. The
> marketing team wants one fresh Facebook post a day without anyone copying and
> pasting. This is n8n doing that end to end — and the part I want to spend most
> of the time on is the guardrail, because for a medical marketplace the
> interesting question isn't how to generate a post, it's how to not publish a
> bad one."

Show the canvas zoomed out. Don't narrate node names.

**0:45–2:00 — Extraction, and why this way**

Open `robots.txt` in a tab. Point at `Crawl-delay: 3`.

> "The brief said one request per second. Their robots.txt says three. I took
> the stricter number."

Open the article sitemap. Point at `lastmod` and `image:loc`.

> "The sitemap already gives me the date and the featured image, so a whole run
> costs two HTTP requests — one sitemap, one page. No headless browser: these
> pages are server-rendered, so Puppeteer would buy nothing."

Open a page, View Source, find the JSON-LD block, point at `articleBody`.

> "And I extract from schema.org structured data rather than CSS selectors.
> Machine-authored, changes far more slowly than markup."

**2:00–3:00 — Start the live run**

Click *Execute Workflow*. Talk while it runs.

Open `Extract Content` output. Point at `extractedBy: json-ld:Article`, the body
length, the image, `price: null`.

**3:00–5:00 — The guardrail (the centrepiece)**

Open `Rule Checks` output. Walk the metrics: length before link, hashtag count,
`numbersInPost`.

> "This is the check I care most about. Every number in the post has to appear
> in the source page. Hallucinated statistics are the most likely and the most
> damaging failure here, and they're trivially detectable — it's a subset test."

Now **show it failing**. Open `samples/sample-posts.md` and scroll to
`rejected-medical-claims`. Five violations on one post.

> "Cure claim, guarantee, risk-free, painless, and a 92% success rate that
> appears nowhere on the page."

Then point at the `success rates` advisory on a passing post.

> "And note what isn't banned. 'Success rate' is in PlacidWay's own article
> title. If I banned the topic word I'd reject accurate posts. The rules ban the
> claim, not the subject — there's a test for exactly that."

Open `Validate Post`.

> "Second layer is an independent model at temperature zero that sees only the
> source and the finished post — never the generator's own reasoning, because
> that turns an independent check into a rubber stamp. It's told that if it's
> unsure, it fails. Regenerating is cheap."

**5:00–6:00 — Approval and publish**

Switch to Telegram. Show the draft arriving with the two buttons.

> "Config flag switches between auto-publish and approval. In approval mode the
> draft goes to a reviewer with the guardrail results attached, and the workflow
> parks on a webhook until someone taps approve — no n8n login needed."

Tap **APPROVE**. Switch to the Page. Show the post, with its image.

**6:00–7:00 — Logging, failure, and honesty**

Show the new row landing in the sheet. Point at `rule_status`,
`validator_status`, `attempts`, `fb_post_id`.

> "Every run is logged whether it published, was rejected, or crashed. That
> sheet is the dedupe store and the audit trail."

Show the error workflow canvas briefly.

> "On failure it classifies before it alerts — an expired Facebook token and a
> 500 from the site need different responses, and at 7am I want the alert to say
> which one it is."

Close on a limit, not a flourish:

> "Honest limits: Sheets won't scale past this demo, the approval webhook isn't
> authenticated, and engagement read-back isn't built. They're all in the README."

## Things to resist

- Reading the node graph aloud node by node
- Apologising for scope
- Saying "as you can see" — show it instead
- Running the demo for the first time on camera
