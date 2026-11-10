/**
 * Regression tests for the extraction and guardrail logic.
 *
 * No test framework on purpose: this has to run anywhere Node 18+ runs, with
 * no install step, because the same logic ships inside n8n Code nodes.
 *
 *   node scripts/test-guardrails.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSitemap, extractContent, isUsable } from '../lib/extract.js';
import { runRuleChecks, parseVerdict } from '../lib/guardrails.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'samples', 'fixtures');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section('parseSitemap');

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url><loc>https://www.placidway.com/article/1/Older-Piece</loc><lastmod>2026-01-02</lastmod></url>
<url><loc>https://www.placidway.com/article/2/Newer-Piece</loc><lastmod>2026-11-09</lastmod><image:image><image:loc>https://cdn.example/img%20one.jpg</image:loc></image:image></url>
<url><loc>https://www.placidway.com/article/3/Middle-Piece?a=1&amp;b=2</loc><lastmod>2026-06-30</lastmod></url>
</urlset>`;

const entries = parseSitemap(sitemapXml);
check('finds every url entry', entries.length === 3, `got ${entries.length}`);
check('sorts newest first', entries[0].url.endsWith('Newer-Piece'), entries[0].url);
check('captures image:loc', entries[0].sitemapImage === 'https://cdn.example/img%20one.jpg', String(entries[0].sitemapImage));
// After the newest-first sort the order is Newer (11-09), Middle (06-30), Older (01-02).
check('decodes entities in loc', entries[1].url.includes('a=1&b=2'), entries[1].url);
check('honours the limit', parseSitemap(sitemapXml, { limit: 2 }).length === 2);

// ---------------------------------------------------------------------------
section('extractContent (live fixtures)');

const articlePath = join(fixtures, 'article.html');
const packagePath = join(fixtures, 'package.html');

let article = null;
let pkg = null;

if (existsSync(articlePath)) {
  article = extractContent(readFileSync(articlePath, 'utf8'), {
    url: 'https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples',
    contentType: 'article',
  });
  check('article uses JSON-LD', article.extractedBy === 'json-ld:Article', article.extractedBy);
  check('article has a title', Boolean(article.title), String(article.title));
  check('article has a summary', Boolean(article.summary));
  check('article body is substantial', article.bodyLength > 5000, `${article.bodyLength} chars`);
  check('article image is the 1200x630 og variant', String(article.image).includes('width=1200'), String(article.image));
  check('article has no price', article.price === null);
  check('article is usable', isUsable(article).usable, JSON.stringify(isUsable(article).problems));
} else {
  console.log('  skip  article fixture not present (run scripts/fetch-fixtures.mjs)');
}

if (existsSync(packagePath)) {
  pkg = extractContent(readFileSync(packagePath, 'utf8'), {
    url: 'https://www.placidway.com/package/8675/Unilateral-Mastectomy-for-Breast-Cancer-Package-in-Riyadh-Saudi-Arabia-at-KFSHRC',
    contentType: 'package',
  });
  check('package uses JSON-LD Product', pkg.extractedBy === 'json-ld:Product', pkg.extractedBy);
  check('package extracts the price', pkg.price === 16000, String(pkg.price));
  check('package extracts the currency', pkg.priceCurrency === 'USD', String(pkg.priceCurrency));
  check('package extracts the provider', Boolean(pkg.provider), String(pkg.provider));
} else {
  console.log('  skip  package fixture not present (run scripts/fetch-fixtures.mjs)');
}

// ---------------------------------------------------------------------------
section('runRuleChecks');

const SOURCE_URL = 'https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples';
const stubSource = {
  url: SOURCE_URL,
  price: null,
  priceCurrency: null,
  sourceText:
    'IVF in Mexico vs USA: Cost & Success Rates. Compare IVF in Mexico vs the USA, including treatment costs, ' +
    'success rates, clinic options, and key factors to consider. A base-cycle price does not tell you what ' +
    'medications cost. Patients often budget for 21 days of travel.',
};

const goodPost = {
  post_text: [
    'The quote that looked affordable was not the whole budget.',
    '',
    'A base-cycle price rarely covers medications or monitoring.',
    'Insurance at home may not travel with you.',
    'Costs and clinic options differ between Mexico and the USA.',
    '',
    'Compare both sides before you commit.',
    SOURCE_URL,
    '#IVFAbroad #MedicalTourism #FertilityJourney #PlacidWay',
  ].join('\n'),
};

let result = runRuleChecks(goodPost, stubSource, {});
check('clean post passes', result.passed, JSON.stringify(result.violations));
check('measures length before the link', result.metrics.lengthBeforeLink < 500 && result.metrics.lengthBeforeLink > 80, String(result.metrics.lengthBeforeLink));
check('counts hashtags', result.metrics.hashtagCount === 4, String(result.metrics.hashtagCount));

const withClaim = { post_text: goodPost.post_text.replace('Compare both sides', 'This treatment will cure infertility, so compare both sides') };
result = runRuleChecks(withClaim, stubSource, {});
check('blocks a cure claim', !result.passed && result.violations.some((v) => v.rule === 'CLAIM_CURE'), JSON.stringify(result.violations.map((v) => v.rule)));

const withPrice = { post_text: goodPost.post_text.replace('A base-cycle price', 'A $4,200 base-cycle price') };
result = runRuleChecks(withPrice, stubSource, {});
check('blocks a price when not allowed', !result.passed && result.violations.some((v) => v.rule === 'PRICE_MENTION'), JSON.stringify(result.violations.map((v) => v.rule)));

const withFakeStat = { post_text: goodPost.post_text.replace('Insurance at home may not travel with you.', 'Clinics report a 92% success rate.') };
result = runRuleChecks(withFakeStat, stubSource, {});
check('blocks an ungrounded figure', !result.passed && result.violations.some((v) => v.rule === 'UNGROUNDED_NUMBER'), JSON.stringify(result.violations.map((v) => v.rule)));

const withGroundedStat = { post_text: goodPost.post_text.replace('Insurance at home may not travel with you.', 'Patients often budget for 21 days of travel.') };
result = runRuleChecks(withGroundedStat, stubSource, {});
check('allows a figure that is in the source', result.passed, JSON.stringify(result.violations));

const withForeignLink = { post_text: goodPost.post_text + '\nhttps://example.com/other' };
result = runRuleChecks(withForeignLink, stubSource, {});
check('blocks a foreign link', !result.passed && result.violations.some((v) => v.rule === 'FOREIGN_LINK'));

const noLink = { post_text: goodPost.post_text.replace(SOURCE_URL, '') };
result = runRuleChecks(noLink, stubSource, {});
check('blocks a missing link', !result.passed && result.violations.some((v) => v.rule === 'LINK_MISSING'));

const tooLong = { post_text: goodPost.post_text.replace('The quote', 'x'.repeat(520) + ' The quote') };
result = runRuleChecks(tooLong, stubSource, {});
check('blocks an over-length post', !result.passed && result.violations.some((v) => v.rule === 'LENGTH_EXCEEDED'));

const twoTags = { post_text: goodPost.post_text.replace('#IVFAbroad #MedicalTourism #FertilityJourney #PlacidWay', '#IVFAbroad #PlacidWay') };
result = runRuleChecks(twoTags, stubSource, {});
check('blocks a bad hashtag count', !result.passed && result.violations.some((v) => v.rule === 'HASHTAG_COUNT'));

const superlative = { post_text: goodPost.post_text.replace('Compare both sides', 'Find the best clinic and compare both sides') };
result = runRuleChecks(superlative, stubSource, {});
check('blocks a superlative', !result.passed && result.violations.some((v) => v.rule === 'CLAIM_SUPERLATIVE'));

// Topic words must NOT be banned: PlacidWay's own titles contain them.
const topicWords = { post_text: goodPost.post_text.replace('Costs and clinic options differ', 'Success rates and costs differ') };
result = runRuleChecks(topicWords, stubSource, {});
check('does not block the phrase "success rates"', result.passed, JSON.stringify(result.violations));

// Hashtags must not trip the disease patterns.
const diseaseTag = { post_text: goodPost.post_text.replace('#PlacidWay', '#CancerCare') };
result = runRuleChecks(diseaseTag, stubSource, {});
check('does not scan hashtags for claims', result.passed, JSON.stringify(result.violations));

// Price policy when explicitly enabled.
const priceSource = { ...stubSource, price: 16000, priceCurrency: 'USD', sourceText: stubSource.sourceText + ' The listed package price is 16000 USD.' };
const correctPrice = { post_text: goodPost.post_text.replace('A base-cycle price', 'The listed package is $16,000 and a base-cycle price') };
result = runRuleChecks(correctPrice, priceSource, { allowPriceMention: true });
check('allows a price that matches the source', result.passed, JSON.stringify(result.violations));

const wrongPrice = { post_text: goodPost.post_text.replace('A base-cycle price', 'The listed package is $12,500 and a base-cycle price') };
result = runRuleChecks(wrongPrice, priceSource, { allowPriceMention: true });
check('blocks a price that contradicts the source', !result.passed && result.violations.some((v) => v.rule === 'PRICE_MISMATCH'));

// ---------------------------------------------------------------------------
section('parseVerdict');

check('reads a clean PASS', parseVerdict('{"verdict":"PASS","violations":[]}').verdict === 'PASS');
check('reads a fenced verdict', parseVerdict('```json\n{"verdict":"PASS","violations":[]}\n```').verdict === 'PASS');
check('reads a verdict with surrounding prose', parseVerdict('Here you go: {"verdict":"FAIL","violations":[{"rule":"R3"}]}').verdict === 'FAIL');
check('fails closed on garbage', parseVerdict('the post looks fine to me').verdict === 'FAIL');
check('fails closed on an unknown verdict', parseVerdict('{"verdict":"MAYBE"}').verdict === 'FAIL');

// ---------------------------------------------------------------------------
section('setup scripts are safe for Windows PowerShell 5.1');

// 5.1 reads a .ps1 without a BOM using the system ANSI codepage. An em-dash is
// E2 80 94 in UTF-8; byte 94 in CP1252 is a right double quote, which silently
// breaks string parsing somewhere *else* in the file. The symptom was "the
// string is missing the terminator" reported against a line that was perfectly
// fine. Belt and braces: require the BOM, and keep the body ASCII anyway.
const setupDir = join(here, '..', 'setup');
if (existsSync(setupDir)) {
  for (const file of readdirSync(setupDir).filter((f) => f.endsWith('.ps1'))) {
    const text = readFileSync(join(setupDir, file), 'utf8');

    check(`${file} starts with a UTF-8 BOM`, text.charCodeAt(0) === 0xfeff);

    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const offenders = [...new Set(body.match(/[^\x00-\x7F]/g) || [])];
    check(
      `${file} body is pure ASCII`,
      offenders.length === 0,
      offenders.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} '${c}'`).join(', '),
    );
  }
} else {
  console.log('  skip  setup/ not present');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
