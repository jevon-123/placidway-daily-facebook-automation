/**
 * Runs the whole pipeline locally, without n8n.
 *
 * It calls the same lib/ functions the workflow inlines, so what you see here
 * is what the Code nodes do. What it deliberately does NOT do is talk to
 * Google Sheets or Facebook: the dedupe store is a local JSON file and nothing
 * is ever published. Use it to iterate on prompts in seconds instead of
 * waiting for 07:00, and to produce the sample-output deliverable.
 *
 *   node scripts/dry-run.mjs                          # one post, today's type
 *   node scripts/dry-run.mjs --type=package           # force a content type
 *   node scripts/dry-run.mjs --count=3                # three in a row
 *   node scripts/dry-run.mjs --url=https://...        # a specific page
 *   node scripts/dry-run.mjs --no-llm                 # extraction only, no API key needed
 *   node scripts/dry-run.mjs --allow-price            # exercise the price path
 *
 * Environment:
 *   PW_LLM_PROVIDER   openai (default) | anthropic
 *   OPENAI_API_KEY    required when provider=openai and --no-llm is absent
 *   ANTHROPIC_API_KEY required when provider=anthropic
 *   PW_MODEL          overrides the default model
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSitemap, extractContent, isUsable } from '../lib/extract.js';
import { runRuleChecks, parseVerdict } from '../lib/guardrails.js';
import {
  composeGenerator,
  composeValidator,
  toProviderBody,
  readCompletionText,
  readFinishReason,
  readJsonLoose,
  normalisePost,
} from '../lib/compose.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// ---------------------------------------------------------------------------
// Arguments and configuration
// ---------------------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const PROVIDER = (process.env.PW_LLM_PROVIDER || 'openai').toLowerCase();
const USE_LLM = !args['no-llm'];

// Any OpenAI-compatible endpoint works: Gemini, Groq, OpenRouter, a local
// Ollama. They all take 'Authorization: Bearer <key>' on /chat/completions.
const LLM_BASE_URL =
  process.env.PW_LLM_BASE_URL ||
  (PROVIDER === 'anthropic'
    ? 'https://api.anthropic.com/v1/messages'
    : 'https://api.openai.com/v1/chat/completions');

// response_format: json_object is an OpenAI extension. Off by default anywhere
// else, because some gateways reject an unknown field outright. readJsonLoose()
// recovers JSON from fenced or prose-wrapped replies regardless.
const JSON_MODE =
  process.env.PW_LLM_JSON_MODE === undefined || process.env.PW_LLM_JSON_MODE === ''
    ? LLM_BASE_URL.includes('api.openai.com')
    : String(process.env.PW_LLM_JSON_MODE).toLowerCase() === 'true';

// First key found wins, so one .env can carry several providers.
const API_KEY =
  PROVIDER === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.PW_LLM_API_KEY;

const SITEMAPS = {
  article: 'https://www.placidway.com/1/sitemap_articles.xml',
  package: 'https://www.placidway.com/1/sitemap_packages.xml',
};
const WEEKLY_ROTATION = ['article', 'article', 'package', 'article', 'package', 'article', 'package'];

const run = {
  contentType: args.type && SITEMAPS[args.type] ? args.type : WEEKLY_ROTATION[new Date().getUTCDay()],
  maxChars: Number(process.env.PW_MAX_CHARS || 500),
  minHashtags: 3,
  maxHashtags: 5,
  maxAttempts: Number(process.env.PW_MAX_ATTEMPTS || 3),
  allowPriceMention: Boolean(args['allow-price']),
  crawlDelaySeconds: Number(process.env.PW_CRAWL_DELAY_SECONDS || 3),
  candidateLimit: Number(process.env.PW_CANDIDATE_LIMIT || 40),
  minBodyLength: Number(process.env.PW_MIN_BODY_LENGTH || 400),
  model: process.env.PW_MODEL || (PROVIDER === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-4o-mini'),
  maxOutputTokens: Number(process.env.PW_MAX_OUTPUT_TOKENS || 4000),
  reasoningEffort: process.env.PW_LLM_REASONING_EFFORT || '',
  userAgent: process.env.PW_USER_AGENT || 'PlacidWayContentBot/1.0 (take-home assessment demo)',
};

const prompts = {
  generator: loadPrompt('generator.md'),
  validator: loadPrompt('validator.md'),
};

function loadPrompt(name) {
  const raw = readFileSync(join(root, 'prompts', name), 'utf8');
  const s = raw.indexOf('\n## SYSTEM');
  const u = raw.indexOf('\n## USER');
  return {
    system: raw.slice(s + '\n## SYSTEM'.length, u).trim(),
    user: raw.slice(u + '\n## USER'.length).trim(),
  };
}

// ---------------------------------------------------------------------------
// Local dedupe store — stands in for the Google Sheet
// ---------------------------------------------------------------------------

const STATE_PATH = join(root, 'samples', 'dry-run-state.json');

function loadState() {
  if (!existsSync(STATE_PATH)) return { posted: [] };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { posted: [] };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': run.userAgent, Accept: 'text/html,application/xml' },
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

async function callModel({ system, user, temperature, maxTokens }) {
  if (!API_KEY) {
    throw new Error(
      `No API key. Set ${
        PROVIDER === 'anthropic'
          ? 'ANTHROPIC_API_KEY'
          : 'OPENAI_API_KEY (or GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / PW_LLM_API_KEY)'
      }, or pass --no-llm to stop after extraction.`,
    );
  }
  if (/^sk-kunci|^sk-\.\.\.|your-key|YOUR_KEY/i.test(API_KEY)) {
    throw new Error(`That looks like a placeholder, not a key: "${API_KEY}". Paste the real one.`);
  }

  const body = toProviderBody(PROVIDER, {
    system,
    user,
    model: run.model,
    temperature,
    maxTokens,
    jsonMode: JSON_MODE,
    reasoningEffort: run.reasoningEffort,
  });

  const headers =
    PROVIDER === 'anthropic'
      ? { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' }
      : { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` };

  // Mirror the workflow's node-level retry (3 tries, 5s apart). Free tiers hand
  // out 429s and 503s freely — on a shared Gemini model a cold "high demand"
  // response is routine, not a failure — and a harness that gives up where the
  // production node would retry is not testing the production path.
  const MAX_TRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    try {
      const res = await fetch(LLM_BASE_URL, { method: 'POST', headers, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        // Truncation and malformed output look the same downstream but need
        // opposite fixes, so say which one happened rather than leaving it to
        // be rediscovered.
        const finish = readFinishReason(PROVIDER, json);
        if (finish === 'length' || finish === 'max_tokens') {
          console.log(
            `  WARNING      model hit the ${maxTokens}-token output cap (finish_reason=${finish}). ` +
              'Raise PW_MAX_OUTPUT_TOKENS, or set PW_LLM_REASONING_EFFORT=none for a reasoning model.',
          );
        }
        return readCompletionText(PROVIDER, json);
      }

      // 4xx other than 429 means the request itself is wrong — key, model name,
      // a rejected field. Retrying cannot fix that, so fail immediately rather
      // than burning 10 seconds restating the same mistake.
      const retryable = res.status === 429 || res.status >= 500;
      const detail = `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`;
      if (!retryable) throw new Error(`${PROVIDER} ${detail}`);
      lastError = new Error(`${PROVIDER} ${detail}`);
    } catch (err) {
      // A network-level throw ("fetch failed") has no status and is always
      // worth retrying.
      if (err.message && err.message.startsWith(PROVIDER)) throw err;
      lastError = err;
    }

    if (attempt < MAX_TRIES) {
      const waitMs = 5000 * attempt;
      console.log(`  retry ${attempt}/${MAX_TRIES - 1} in ${waitMs / 1000}s — ${lastError.message.slice(0, 120)}`);
      await sleep(waitMs);
    }
  }

  throw new Error(`${PROVIDER} failed after ${MAX_TRIES} attempts: ${lastError.message}`);
}

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------

const line = (ch = '-') => console.log(ch.repeat(74));

function printChecks(rules) {
  console.log(`  rules        : ${rules.passed ? 'PASS' : 'FAIL'}`);
  console.log(`  before link  : ${rules.metrics.lengthBeforeLink} / ${run.maxChars} chars`);
  console.log(`  hashtags     : ${rules.metrics.hashtagCount} (${(rules.metrics.hashtags || []).join(' ')})`);
  console.log(`  value lines  : ${rules.metrics.valueLineCount}`);
  console.log(`  numbers used : ${(rules.metrics.numbersInPost || []).join(', ') || 'none'}`);
  for (const v of rules.violations) {
    console.log(`  VIOLATION    ${v.rule}: ${v.detail}${v.evidence ? ` -> "${v.evidence}"` : ''}`);
  }
  for (const a of rules.advisories) {
    console.log(`  advisory     ${a.rule}: ${a.detail}${a.evidence ? ` -> "${a.evidence}"` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// One full pass
// ---------------------------------------------------------------------------

async function produceOne(state) {
  // --- select ------------------------------------------------------------
  let target;
  if (args.url) {
    target = { url: String(args.url), lastmod: null, sitemapImage: null };
  } else {
    const sitemapUrl = SITEMAPS[run.contentType];
    console.log(`\nsitemap      : ${sitemapUrl}`);
    const xml = await getText(sitemapUrl);
    const candidates = parseSitemap(xml, { limit: run.candidateLimit });
    console.log(`candidates   : ${candidates.length} (newest ${candidates[0]?.lastmod})`);

    const used = new Set(state.posted.map((p) => p.url));
    target = candidates.find((c) => !used.has(c.url));
    if (!target) throw new Error(`No unposted ${run.contentType} left in the newest ${candidates.length} entries.`);

    await sleep(run.crawlDelaySeconds * 1000); // robots.txt Crawl-delay: 3
  }

  // --- extract -----------------------------------------------------------
  console.log(`fetching     : ${target.url}`);
  const html = await getText(target.url);
  const raw = extractContent(html, {
    url: target.url,
    contentType: run.contentType,
    sitemapImage: target.sitemapImage,
    lastmod: target.lastmod,
  });
  const content = { ...raw, bodyForModel: raw.body.slice(0, 6000) };

  const usability = isUsable(content, run.minBodyLength);
  console.log(`extracted by : ${content.extractedBy}`);
  console.log(`title        : ${content.title}`);
  console.log(`body         : ${content.bodyLength} chars`);
  console.log(`image        : ${content.image ? 'yes' : 'none'}`);
  console.log(`price        : ${content.price == null ? 'none' : `${content.price} ${content.priceCurrency}`}`);
  console.log(`usable       : ${usability.usable}${usability.usable ? '' : ` (${usability.problems.join('; ')})`}`);

  if (!usability.usable) throw new Error(`Unusable page: ${usability.problems.join('; ')}`);
  if (!USE_LLM) return { content, skipped: 'llm disabled (--no-llm)' };

  // --- generate, check, retry -------------------------------------------
  let attempt = 1;
  let feedback = null;
  let post = null;
  let rules = null;
  let verdict = null;

  // Keep every attempt, not just the one that survived. A post that passed on
  // the second try because the reviewer caught something on the first is the
  // most informative artefact this pipeline produces, and throwing it away
  // leaves only the sanitised result.
  const attemptLog = [];

  while (attempt <= run.maxAttempts) {
    line();
    console.log(`attempt ${attempt} of ${run.maxAttempts}`);

    const gen = composeGenerator({ content, run, feedback, prompts: prompts.generator });
    const completion = await callModel({ ...gen, temperature: 0.7, maxTokens: run.maxOutputTokens });
    const parsed = readJsonLoose(completion);

    if (!parsed || !parsed.post_text) {
      feedback = 'Rule checks:\n- [GENERATION_FAILED] model did not return JSON containing post_text';
      console.log('  generation   : UNPARSEABLE');
      attemptLog.push({ attempt, outcome: 'unparseable', post_text: String(completion).slice(0, 600) });
      attempt += 1;
      continue;
    }

    post = normalisePost(parsed, content);
    console.log('\n' + post.post_text + '\n');

    rules = runRuleChecks(post, content, run);
    printChecks(rules);

    if (!rules.passed) {
      attemptLog.push({ attempt, outcome: 'rejected-by-rules', post_text: post.post_text, rules });
      feedback = ['Rule checks:', ...rules.violations.map((v) => `- [${v.rule}] ${v.detail}${v.evidence ? ` => "${v.evidence}"` : ''}`)].join('\n');
      attempt += 1;
      continue;
    }

    // --- guardrail layer 2 ----------------------------------------------
    const val = composeValidator({ content, post, prompts: prompts.validator });
    const verdictRaw = await callModel({ ...val, temperature: 0, maxTokens: run.maxOutputTokens });
    verdict = parseVerdict(verdictRaw);
    console.log(`  reviewer     : ${verdict.verdict}`);
    for (const v of verdict.reviewerViolations) {
      console.log(`  REVIEWER     ${v.rule || 'R?'}: ${v.why || ''}${v.quote ? ` -> "${v.quote}"` : ''}`);
    }
    if (verdict.reviewerNotes) console.log(`  notes        : ${verdict.reviewerNotes}`);

    if (verdict.verdict === 'PASS') {
      attemptLog.push({ attempt, outcome: 'accepted', post_text: post.post_text, rules, verdict });
      return { content, post, rules, verdict, attempts: attempt, attemptLog };
    }

    attemptLog.push({ attempt, outcome: 'rejected-by-reviewer', post_text: post.post_text, rules, verdict });
    feedback = [
      'Rule checks: (passed)',
      'Reviewer:',
      ...verdict.reviewerViolations.map((v) => `- [${v.rule || 'R?'}] ${v.why || ''}${v.quote ? ` => "${v.quote}"` : ''}`),
    ].join('\n');
    attempt += 1;
  }

  return { content, post, rules, verdict, attempts: attempt - 1, attemptLog, rejected: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const count = Number(args.count || 1);
const state = loadState();
const produced = [];

console.log(`provider     : ${PROVIDER}${USE_LLM ? ` (${run.model})` : ' — LLM disabled'}`);
if (USE_LLM) {
  console.log(`endpoint     : ${LLM_BASE_URL}`);
  console.log(`json mode    : ${JSON_MODE}`);
}
console.log(`content type : ${run.contentType}`);
console.log(`price policy : ${run.allowPriceMention ? 'citation allowed, must match source' : 'no prices'}`);

for (let i = 0; i < count; i += 1) {
  line('=');
  console.log(`RUN ${i + 1} of ${count}`);
  try {
    const result = await produceOne(state);
    produced.push(result);
    if (result.post && !result.rejected) {
      state.posted.push({
        url: result.content.url,
        title: result.content.title,
        contentType: result.content.contentType,
        postedAt: new Date().toISOString(),
        status: 'simulated',
      });
      saveState(state);
    }
  } catch (err) {
    console.log(`\n  ERROR: ${err.message}`);
    produced.push({ error: err.message });
  }
  if (i < count - 1 && !args.url) await sleep(run.crawlDelaySeconds * 1000);
}

// Persist the full objects so scripts/make-samples.mjs can format them.
const outDir = join(root, 'samples', 'generated');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `dry-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(outPath, JSON.stringify({ run, provider: PROVIDER, produced }, null, 2), 'utf8');

line('=');
const ok = produced.filter((p) => p.post && !p.rejected).length;
console.log(`${ok} of ${count} passed both guardrail layers`);
console.log(`detail written to ${outPath}`);
