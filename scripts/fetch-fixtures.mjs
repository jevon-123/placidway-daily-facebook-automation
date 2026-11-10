/**
 * Refreshes the HTML fixtures the test suite runs against, and dumps what the
 * extractor makes of them.
 *
 * Fixtures are real pages, not hand-written HTML, because the thing most likely
 * to break this pipeline is PlacidWay changing its markup — and a fixture made
 * of our own assumptions would never catch that. Re-run this before a release
 * and re-run the tests; a failure here is an early warning, not a nuisance.
 *
 *   node scripts/fetch-fixtures.mjs
 *   node scripts/fetch-fixtures.mjs --body=3000     # print more body text
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extractContent, isUsable } from '../lib/extract.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'samples', 'fixtures');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const BODY_PREVIEW = Number(args.body || 1200);

const CRAWL_DELAY_MS = 3000; // robots.txt Crawl-delay: 3
const USER_AGENT = 'PlacidWayContentBot/1.0 (take-home assessment demo)';

const TARGETS = [
  {
    name: 'article',
    contentType: 'article',
    url: 'https://www.placidway.com/article/5596/IVF-in-Mexico-vs-USA-A-Complete-Guide-for-Couples',
  },
  {
    name: 'article-rehab',
    contentType: 'article',
    url: 'https://www.placidway.com/article/5672/Tijuana-Drug-Rehab-Why-Patients-Choose-Mexico-for-Recovery-and-Healing',
  },
  {
    name: 'package',
    contentType: 'package',
    url: 'https://www.placidway.com/package/8675/Unilateral-Mastectomy-for-Breast-Cancer-Package-in-Riyadh-Saudi-Arabia-at-KFSHRC',
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(outDir, { recursive: true });
const extracted = [];

for (const [index, target] of TARGETS.entries()) {
  if (index > 0) await sleep(CRAWL_DELAY_MS);

  process.stdout.write(`fetching ${target.name} ... `);
  const res = await fetch(target.url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) {
    console.log(`HTTP ${res.status} — skipped`);
    continue;
  }
  const html = await res.text();
  writeFileSync(join(outDir, `${target.name}.html`), html, 'utf8');
  console.log(`${html.length} bytes`);

  const content = extractContent(html, { url: target.url, contentType: target.contentType });
  const usability = isUsable(content);

  extracted.push({
    ...content,
    body: undefined, // kept out of the JSON dump; it is in the .html fixture
    bodyPreview: content.body.slice(0, BODY_PREVIEW),
    usable: usability.usable,
    problems: usability.problems,
  });

  console.log(`  extractedBy : ${content.extractedBy}`);
  console.log(`  title       : ${content.title}`);
  console.log(`  summary     : ${content.summary}`);
  console.log(`  body        : ${content.bodyLength} chars`);
  console.log(`  image       : ${content.image || 'none'}`);
  console.log(`  price       : ${content.price == null ? 'none' : `${content.price} ${content.priceCurrency}`}`);
  console.log(`  provider    : ${content.provider || 'n/a'}`);
  console.log(`  usable      : ${usability.usable}`);
  console.log('');
}

writeFileSync(join(outDir, 'extracted.json'), JSON.stringify(extracted, null, 2), 'utf8');
console.log(`wrote ${extracted.length} fixtures and extracted.json to samples/fixtures/`);
