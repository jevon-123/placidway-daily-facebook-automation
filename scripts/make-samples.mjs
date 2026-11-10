/**
 * Produces samples/sample-posts.md, the sample-output deliverable.
 *
 * Two sources:
 *   --from=reference  (default) samples/reference-posts.json — hand-written
 *                     drafts, used to exercise the guardrails without an API key
 *   --from=dry-run    the newest samples/generated/dry-run-*.json — real model
 *                     output produced by scripts/dry-run.mjs
 *
 * Either way the guardrail results in the output are real: every post is run
 * through lib/guardrails.js against the actual extracted page content.
 *
 *   node scripts/make-samples.mjs
 *   node scripts/make-samples.mjs --from=dry-run
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extractContent } from '../lib/extract.js';
import { runRuleChecks } from '../lib/guardrails.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const samplesDir = join(root, 'samples');
const fixturesDir = join(samplesDir, 'fixtures');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const SOURCE = String(args.from || 'reference');

// ---------------------------------------------------------------------------

const FIXTURE_URLS = {
  article: 'https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples',
  'article-rehab': 'https://www.placidway.com/article/5672/Tijuana-Drug-Rehab-Why-Patients-Choose-Mexico-for-Recovery-and-Healing',
  package: 'https://www.placidway.com/package/8675/Unilateral-Mastectomy-for-Breast-Cancer-Package-in-Riyadh-Saudi-Arabia-at-KFSHRC',
};

const contentCache = new Map();

function loadFixtureContent(name) {
  if (contentCache.has(name)) return contentCache.get(name);
  const path = join(fixturesDir, `${name}.html`);
  if (!existsSync(path)) {
    throw new Error(`Missing fixture ${path}. Run: node scripts/fetch-fixtures.mjs`);
  }
  const html = readFileSync(path, 'utf8');
  const content = extractContent(html, {
    url: FIXTURE_URLS[name],
    contentType: name.startsWith('package') ? 'package' : 'article',
  });
  contentCache.set(name, content);
  return content;
}

// ---------------------------------------------------------------------------
// Gather entries: { id, note, expect, allowPriceMention, post_text, content }
// ---------------------------------------------------------------------------

function fromReference() {
  const file = JSON.parse(readFileSync(join(samplesDir, 'reference-posts.json'), 'utf8'));
  return file.posts.map((p) => ({
    ...p,
    content: loadFixtureContent(p.fixture),
    origin: 'hand-written to prompts/generator.md (no API key required)',
  }));
}

/**
 * Merge every dry-run that produced posts, newest first, deduplicated by source
 * URL. Merging rather than taking only the newest file means a mixed sample set
 * — a couple of articles and a package exercising the price path — can be built
 * from separate invocations, since one run only ever covers one content type.
 */
function fromDryRun() {
  const dir = join(samplesDir, 'generated');
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('dry-run-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (!files.length) throw new Error('No dry-run output found. Run: npm run dry-run -- --count=3');

  const seen = new Set();
  const entries = [];

  for (const file of files) {
    const payload = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const p of payload.produced || []) {
      if (!p || !p.post || !p.post.post_text || !p.content) continue;
      if (seen.has(p.content.url)) continue;
      seen.add(p.content.url);

      entries.push({
        id: `${p.content.contentType}-${entries.length + 1}`,
        note: `Generated in ${p.attempts} attempt(s).`,
        expect: p.rejected ? 'fail' : 'pass',
        allowPriceMention: Boolean(payload.run.allowPriceMention),
        post_text: p.post.post_text,
        content: p.content,
        verdict: p.verdict,
        attemptLog: p.attemptLog,
        origin: `${payload.provider} / ${payload.run.model} via scripts/dry-run.mjs`,
      });
    }
  }

  if (!entries.length) {
    throw new Error('Dry-run files exist but none contain a generated post. Check the API key and re-run.');
  }

  // Keep the deliberately-bad drafts alongside the generated ones. A sample set
  // that only shows successes says nothing about where the line is.
  const reference = JSON.parse(readFileSync(join(samplesDir, 'reference-posts.json'), 'utf8'));
  for (const p of reference.posts.filter((x) => x.expect === 'fail')) {
    entries.push({
      ...p,
      content: loadFixtureContent(p.fixture),
      origin: 'hand-written counter-example, included to show the guardrail rejecting',
    });
  }

  return entries;
}

const entries = SOURCE === 'dry-run' ? fromDryRun() : fromReference();

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const out = [];
const w = (s = '') => out.push(s);

w('# Sample output');
w();
w('Posts produced from real PlacidWay pages, each shown with the guardrail result');
w('that `lib/guardrails.js` actually returns for it.');
w();
w(`Regenerate with: \`node scripts/make-samples.mjs --from=${SOURCE}\``);
w();
w('> **Provenance.** Every guardrail result below is real: the live return value of');
w('> `runRuleChecks()` against the content extracted from the linked page. Each post');
w('> states its own origin under the heading.');
if (SOURCE === 'dry-run') {
  w('>');
  w('> The passing posts were written by the model through the full pipeline —');
  w('> extraction, generation, both guardrail layers. The rejected ones are');
  w('> hand-written counter-examples, kept deliberately: a sample set that only shows');
  w('> successes says nothing about where the line is.');
} else {
  w('>');
  w('> These posts were hand-written against `prompts/generator.md` rather than');
  w('> generated, because building them needed no API key. For real model output run');
  w('> `npm run dry-run -- --count=3`, then `node scripts/make-samples.mjs --from=dry-run`.');
}
w();

let passCount = 0;
let failCount = 0;

for (const entry of entries) {
  const rules = runRuleChecks({ post_text: entry.post_text }, entry.content, {
    maxLengthBeforeLink: 500,
    minHashtags: 3,
    maxHashtags: 5,
    allowPriceMention: entry.allowPriceMention,
  });

  const matchedExpectation = (rules.passed ? 'pass' : 'fail') === entry.expect;
  if (rules.passed) passCount += 1;
  else failCount += 1;

  w('---');
  w();
  w(`## ${rules.passed ? 'PASS' : 'REJECTED'} — ${entry.id}`);
  w();
  w(`- **Source page:** [${entry.content.title}](${entry.content.url})`);
  w(`- **Content type:** ${entry.content.contentType}`);
  w(`- **Extracted via:** \`${entry.content.extractedBy}\``);
  w(`- **Featured image:** ${entry.content.image ? `[yes](${entry.content.image})` : 'none'}`);
  w(
    `- **Source price:** ${
      entry.content.price == null ? 'none published' : `${entry.content.price} ${entry.content.priceCurrency}`
    }`,
  );
  w(`- **Price policy for this run:** ${entry.allowPriceMention ? '`PW_ALLOW_PRICE_MENTION=true`' : 'prices forbidden'}`);
  w(`- **Origin:** ${entry.origin}`);
  if (entry.note) w(`- **Note:** ${entry.note}`);
  w();
  w('### Post');
  w();
  w('```text');
  w(entry.post_text);
  w('```');
  w();
  w('### Guardrail result');
  w();
  w('| Check | Value |');
  w('|---|---|');
  w(`| Rule layer | ${rules.passed ? '**PASS**' : '**FAIL**'} |`);
  w(`| Characters before link | ${rules.metrics.lengthBeforeLink} / 500 |`);
  w(`| Hashtags | ${rules.metrics.hashtagCount} — ${(rules.metrics.hashtags || []).join(' ')} |`);
  w(`| Non-hashtag lines before link | ${rules.metrics.valueLineCount} |`);
  w(`| Figures used in copy | ${(rules.metrics.numbersInPost || []).join(', ') || 'none'} |`);
  w(`| Distinct figures found in source | ${rules.metrics.sourceNumbersKnown} |`);
  w(`| Emoji | ${rules.metrics.emojiCount} |`);
  w();

  if (rules.violations.length) {
    w('**Violations**');
    w();
    for (const v of rules.violations) {
      w(`- \`${v.rule}\` — ${v.detail}${v.evidence ? ` → \`${v.evidence}\`` : ''}`);
    }
    w();
  }
  if (rules.advisories.length) {
    w('**Advisories** (logged, shown to the reviewer, non-blocking)');
    w();
    for (const a of rules.advisories) {
      w(`- \`${a.rule}\` — ${a.detail}${a.evidence ? ` → \`${a.evidence}\`` : ''}`);
    }
    w();
  }
  if (entry.verdict) {
    w(`**Reviewer (guardrail layer 2):** ${entry.verdict.verdict}`);
    w();
    for (const v of entry.verdict.reviewerViolations || []) {
      w(`- \`${v.rule || 'R?'}\` — ${v.why || ''}${v.quote ? ` → \`${v.quote}\`` : ''}`);
    }
    if ((entry.verdict.reviewerViolations || []).length) w();
  }

  // Show the drafts that did not survive, where there were any. This is the
  // part of the pipeline that is otherwise invisible in a finished post.
  const rejectedAttempts = (entry.attemptLog || []).filter((a) => a.outcome !== 'accepted');
  if (rejectedAttempts.length) {
    w('<details>');
    w(`<summary>Rejected drafts before this one (${rejectedAttempts.length})</summary>`);
    w();
    for (const a of rejectedAttempts) {
      w(`**Attempt ${a.attempt} — ${a.outcome}**`);
      w();
      w('```text');
      w(a.post_text);
      w('```');
      w();
      for (const v of (a.rules && a.rules.violations) || []) {
        w(`- rules \`${v.rule}\` — ${v.detail}${v.evidence ? ` → \`${v.evidence}\`` : ''}`);
      }
      for (const v of (a.verdict && a.verdict.reviewerViolations) || []) {
        w(`- reviewer \`${v.rule || 'R?'}\` — ${v.why || ''}${v.quote ? ` → \`${v.quote}\`` : ''}`);
      }
      w();
    }
    w('</details>');
    w();
  }
  if (!matchedExpectation) {
    w(`> ⚠️ Expected this post to **${entry.expect}**, but the rules returned **${rules.passed ? 'pass' : 'fail'}**.`);
    w();
  }
}

w('---');
w();
w(`**Totals:** ${passCount} passed, ${failCount} rejected, out of ${entries.length}.`);
w();

const outPath = join(samplesDir, 'sample-posts.md');
writeFileSync(outPath, out.join('\n'), 'utf8');

console.log(`source : ${SOURCE}`);
console.log(`posts  : ${entries.length} (${passCount} pass, ${failCount} rejected)`);
console.log(`wrote  : ${outPath}`);

const mismatches = entries.filter((e) => {
  const r = runRuleChecks({ post_text: e.post_text }, e.content, {
    maxLengthBeforeLink: 500,
    minHashtags: 3,
    maxHashtags: 5,
    allowPriceMention: e.allowPriceMention,
  });
  return (r.passed ? 'pass' : 'fail') !== e.expect;
});
if (mismatches.length) {
  console.log(`\nWARNING: ${mismatches.length} post(s) did not match their declared expectation:`);
  for (const m of mismatches) console.log(`  - ${m.id} expected ${m.expect}`);
  process.exit(1);
}
