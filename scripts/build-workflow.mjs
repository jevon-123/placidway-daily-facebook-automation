/**
 * Compiles the n8n workflow JSON.
 *
 * Why a build step rather than a hand-edited export?
 *
 *   The interesting logic — sitemap parsing, content extraction, the guardrail
 *   rules — lives in lib/*.js, where it is unit-tested by
 *   scripts/test-guardrails.mjs. n8n Code nodes cannot import files, so that
 *   logic has to be inlined. Inlining it by hand means the tested copy and the
 *   running copy drift apart within a week. This script inlines it mechanically
 *   on every build, so they cannot.
 *
 * Usage:
 *   node scripts/build-workflow.mjs                      # OpenAI (default)
 *   node scripts/build-workflow.mjs --provider=anthropic
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const PROVIDER = String(args.provider || 'openai').toLowerCase();
if (!['openai', 'anthropic'].includes(PROVIDER)) {
  console.error(`Unknown provider "${PROVIDER}". Use openai or anthropic.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Sources that get inlined
// ---------------------------------------------------------------------------

/** Read a lib file and strip the ESM keywords an n8n Code node cannot parse. */
function inlineLib(name) {
  return readFileSync(join(root, 'lib', name), 'utf8')
    .replace(/^export\s+/gm, '')
    .trim();
}

/** Split a prompt markdown file on its `## SYSTEM` / `## USER` markers. */
function loadPrompt(name) {
  const raw = readFileSync(join(root, 'prompts', name), 'utf8');
  const sysIndex = raw.indexOf('\n## SYSTEM');
  const userIndex = raw.indexOf('\n## USER');
  if (sysIndex === -1 || userIndex === -1) {
    throw new Error(`${name} is missing its "## SYSTEM" or "## USER" marker`);
  }
  return {
    system: raw.slice(sysIndex + '\n## SYSTEM'.length, userIndex).trim(),
    user: raw.slice(userIndex + '\n## USER'.length).trim(),
  };
}

const EXTRACT_LIB = inlineLib('extract.js');
const GUARDRAIL_LIB = inlineLib('guardrails.js');
const COMPOSE_LIB = inlineLib('compose.js');
const GENERATOR = loadPrompt('generator.md');
const VALIDATOR = loadPrompt('validator.md');

/** Emit the prompt pair as a JS literal for inlining into a Code node. */
const promptsLiteral = (p) => `{ system: ${JSON.stringify(p.system)}, user: ${JSON.stringify(p.user)} }`;

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

let idSeq = 0;
const nextId = () => `pw-${String(++idSeq).padStart(3, '0')}`;

const nodes = [];
const connections = {};

function node(name, type, typeVersion, position, parameters, extra = {}) {
  nodes.push({ parameters, id: nextId(), name, type, typeVersion, position, ...extra });
  return name;
}

function code(name, position, jsCode, extra = {}) {
  return node(name, 'n8n-nodes-base.code', 2, position, { jsCode }, extra);
}

/** Wire `from` output `outputIndex` to each node in `targets`. */
function connect(from, targets, outputIndex = 0) {
  const list = Array.isArray(targets) ? targets : [targets];
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= outputIndex) connections[from].main.push([]);
  for (const to of list) {
    connections[from].main[outputIndex].push({ node: to, type: 'main', index: 0 });
  }
}

/** An IF node that tests one boolean field of the envelope. */
function ifBoolean(name, position, expression) {
  return node(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        {
          id: nextId(),
          leftValue: expression,
          rightValue: true,
          operator: { type: 'boolean', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  });
}

// ---------------------------------------------------------------------------
// 1. Triggers and configuration
// ---------------------------------------------------------------------------

node('Daily Schedule', 'n8n-nodes-base.scheduleTrigger', 1.2, [-620, -120], {
  rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * *' }] },
});

node('Manual Run', 'n8n-nodes-base.manualTrigger', 1, [-620, 80], {});

code(
  'Config',
  [-400, -20],
  `// Single source of truth for every tunable in this workflow.
// Reads from environment variables so the same export runs in dev and prod.
// Requires N8N_BLOCK_ENV_ACCESS_IN_NODE=false (see README).

function env(key, fallback) {
  try {
    const value = $env[key];
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch (e) {
    // $env is blocked on this instance — fall back to the documented defaults
    // so the workflow still runs in simulate mode rather than dying here.
    return fallback;
  }
}

const bool = (v, d) => (v === undefined ? d : String(v).toLowerCase() === 'true');

const run = {
  runId: $execution.id + '-' + Date.now(),
  runAt: new Date().toISOString(),

  // --- behaviour flags ---------------------------------------------------
  // publishMode: simulate | schedule | publish
  //   simulate  = build the post, never call Facebook (default, and what the
  //               assessment ground rules ask for)
  //   schedule  = create an unpublished post with scheduled_publish_time
  //   publish   = post live
  publishMode: env('PW_PUBLISH_MODE', 'simulate'),
  // reviewMode: auto | approval
  reviewMode: env('PW_REVIEW_MODE', 'approval'),
  allowPriceMention: bool(env('PW_ALLOW_PRICE_MENTION'), false),

  // --- limits ------------------------------------------------------------
  maxChars: Number(env('PW_MAX_CHARS', 500)),
  minHashtags: 3,
  maxHashtags: 5,
  maxAttempts: Number(env('PW_MAX_ATTEMPTS', 3)),
  crawlDelaySeconds: Number(env('PW_CRAWL_DELAY_SECONDS', 3)),
  candidateLimit: Number(env('PW_CANDIDATE_LIMIT', 40)),
  minBodyLength: Number(env('PW_MIN_BODY_LENGTH', 400)),

  // --- integrations ------------------------------------------------------
  sheetId: env('PW_SHEET_ID', ''),
  facebookPageId: env('PW_FB_PAGE_ID', ''),
  graphVersion: env('PW_FB_GRAPH_VERSION', 'v21.0'),
  scheduleOffsetMinutes: Number(env('PW_SCHEDULE_OFFSET_MINUTES', 60)),
  model: env('PW_MODEL', ${JSON.stringify(PROVIDER === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-4o-mini')}),
  userAgent: env('PW_USER_AGENT', 'PlacidWayContentBot/1.0 (+contact in README)'),
};

return [{ json: { run, attempt: 1, feedback: null } }];`,
);

connect('Daily Schedule', 'Config');
connect('Manual Run', 'Config');

// ---------------------------------------------------------------------------
// 2. Choose today's content type, then fetch that sitemap
// ---------------------------------------------------------------------------

code(
  'Pick Content Type',
  [-180, -20],
  `// Variety rule (stretch goal): rotate content types across the week so the
// Page does not read as four identical article links in a row.
//
// Only the two sitemaps whose page structure we have actually verified are in
// the rotation. Adding 'answer' or 'news' means verifying their JSON-LD first.
const SITEMAPS = {
  article: 'https://www.placidway.com/1/sitemap_articles.xml',
  package: 'https://www.placidway.com/1/sitemap_packages.xml',
};

// Sun..Sat — articles carry the week, packages break it up midweek.
const SCHEDULE = ['article', 'article', 'package', 'article', 'package', 'article', 'package'];

const run = $json.run;
const override = (() => {
  try { return $env.PW_FORCE_CONTENT_TYPE || ''; } catch (e) { return ''; }
})();

const contentType = SITEMAPS[override] ? override : SCHEDULE[new Date().getUTCDay()];

return [{
  json: {
    ...$json,
    run: { ...run, contentType, sitemapUrl: SITEMAPS[contentType] },
  },
}];`,
);
connect('Config', 'Pick Content Type');

node('Fetch Sitemap', 'n8n-nodes-base.httpRequest', 4.2, [40, -20], {
  url: '={{ $json.run.sitemapUrl }}',
  options: {
    response: { response: { responseFormat: 'text', outputPropertyName: 'sitemapXml' } },
    timeout: 60000,
  },
  sendHeaders: true,
  headerParameters: {
    parameters: [
      { name: 'User-Agent', value: '={{ $json.run.userAgent }}' },
      { name: 'Accept', value: 'application/xml,text/xml' },
    ],
  },
}, {
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 5000,
});
connect('Pick Content Type', 'Fetch Sitemap');

code(
  'Parse Sitemap',
  [260, -20],
  `${EXTRACT_LIB}

// ---- node driver ----------------------------------------------------------
// Emits exactly ONE item carrying the whole candidate list, so the Google
// Sheets read below runs once rather than once per candidate.
const run = $('Pick Content Type').first().json.run;
const xml = $input.first().json.sitemapXml || '';

if (!xml || xml.indexOf('<url>') === -1) {
  throw new Error('Sitemap fetch returned no <url> entries for ' + run.sitemapUrl);
}

const candidates = parseSitemap(xml, { limit: run.candidateLimit });
if (candidates.length === 0) {
  throw new Error('Sitemap parsed but produced zero candidates: ' + run.sitemapUrl);
}

return [{
  json: {
    ...$('Pick Content Type').first().json,
    candidates,
    candidateCount: candidates.length,
  },
}];`,
);
connect('Fetch Sitemap', 'Parse Sitemap');

// ---------------------------------------------------------------------------
// 3. Deduplicate against the run log
// ---------------------------------------------------------------------------

node('Load Posted Log', 'n8n-nodes-base.googleSheets', 4.5, [480, -20], {
  documentId: { __rl: true, value: '={{ $json.run.sheetId }}', mode: 'id' },
  sheetName: { __rl: true, value: 'runs', mode: 'name' },
  options: {},
}, {
  alwaysOutputData: true,
  credentials: { googleSheetsOAuth2Api: { id: 'PW_GOOGLE_SHEETS', name: 'PlacidWay Google Sheets' } },
  notes: 'Reads every row of the run log. Fails loudly: if we cannot read what was already posted, we must not post.',
});
connect('Parse Sitemap', 'Load Posted Log');

code(
  'Choose Unposted Item',
  [700, -20],
  `// Picks the newest candidate whose URL has never reached Facebook.
//
// "Reached Facebook" means a prior run ended in published, scheduled or
// simulated. Rows that ended in failed or rejected are deliberately NOT
// treated as used, so a transient outage does not burn a piece of content.
const base = $('Parse Sitemap').first().json;
const candidates = base.candidates || [];

const USED_STATUSES = new Set(['published', 'scheduled', 'simulated']);

const rows = $input.all().map((i) => i.json).filter((r) => r && (r.url || r.URL));
const used = new Set(
  rows
    .filter((r) => USED_STATUSES.has(String(r.status || '').toLowerCase()))
    .map((r) => String(r.url || r.URL).trim())
    .filter(Boolean),
);

const item = candidates.find((c) => !used.has(c.url));

if (!item) {
  throw new Error(
    'No unposted ' + base.run.contentType + ' left in the newest ' +
    candidates.length + ' sitemap entries (' + used.size + ' already used). ' +
    'Raise PW_CANDIDATE_LIMIT or let the rotation move to another content type.'
  );
}

return [{ json: { ...base, item, alreadyUsedCount: used.size } }];`,
);
connect('Load Posted Log', 'Choose Unposted Item');

// ---------------------------------------------------------------------------
// 4. Fetch the page, politely
// ---------------------------------------------------------------------------

node('Respect Crawl Delay', 'n8n-nodes-base.wait', 1.1, [920, -20], {
  amount: '={{ $json.run.crawlDelaySeconds }}',
  unit: 'seconds',
}, {
  webhookId: 'a1f0c4de-0000-4000-8000-000000000001',
  notes: "robots.txt sets Crawl-delay: 3, which is stricter than the brief's 1 req/s. We honour the stricter number.",
});
connect('Choose Unposted Item', 'Respect Crawl Delay');

node('Fetch Page', 'n8n-nodes-base.httpRequest', 4.2, [1140, -20], {
  url: '={{ $json.item.url }}',
  options: {
    response: { response: { responseFormat: 'text', outputPropertyName: 'html' } },
    timeout: 60000,
  },
  sendHeaders: true,
  headerParameters: {
    parameters: [
      { name: 'User-Agent', value: '={{ $json.run.userAgent }}' },
      { name: 'Accept', value: 'text/html' },
    ],
  },
}, {
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 5000,
});
connect('Respect Crawl Delay', 'Fetch Page');

code(
  'Extract Content',
  [1360, -20],
  `${EXTRACT_LIB}

// ---- node driver ----------------------------------------------------------
const base = $('Choose Unposted Item').first().json;
const html = $input.first().json.html || '';

const content = extractContent(html, {
  url: base.item.url,
  contentType: base.run.contentType,
  sitemapImage: base.item.sitemapImage,
  lastmod: base.item.lastmod,
});

const usability = isUsable(content, base.run.minBodyLength);

// Trim the body before it reaches the model. The full articleBody runs to 22 kB;
// the first ~6 kB carries the lede and the substantive points, and capping it
// keeps token cost predictable without starving the grounding check.
const MODEL_BODY_LIMIT = 6000;

return [{
  json: {
    ...base,
    content: { ...content, bodyForModel: content.body.slice(0, MODEL_BODY_LIMIT) },
    usable: usability.usable,
    usabilityProblems: usability.problems,
  },
}];`,
);
connect('Fetch Page', 'Extract Content');

ifBoolean('Usable Content?', [1580, -20], '={{ $json.usable }}');
connect('Extract Content', 'Usable Content?');

// ---------------------------------------------------------------------------
// 5. Generate
// ---------------------------------------------------------------------------

code(
  'Build Generator Request',
  [1800, -120],
  `${COMPOSE_LIB}

// ---- node driver ----------------------------------------------------------
// The prompt is assembled in JS, not in an n8n expression. These are
// multi-paragraph templates and escaping them inside an expression string is
// exactly where this kind of workflow breaks.
//
// composeGenerator() is the same function scripts/dry-run.mjs calls, inlined
// here by the build. The local harness and the production node cannot drift.
const d = $json;
const prompts = ${promptsLiteral(GENERATOR)};

const { system, user } = composeGenerator({
  content: d.content,
  run: d.run,
  feedback: d.feedback,
  prompts,
});

const body = toProviderBody(${JSON.stringify(PROVIDER)}, {
  system,
  user,
  model: d.run.model,
  temperature: 0.7,
  maxTokens: 1200,
  jsonMode: true,
});

return [{ json: { ...d, body } }];`,
);
connect('Usable Content?', 'Build Generator Request', 0);

const LLM_URL =
  PROVIDER === 'anthropic'
    ? 'https://api.anthropic.com/v1/messages'
    : 'https://api.openai.com/v1/chat/completions';

const LLM_HEADERS =
  PROVIDER === 'anthropic'
    ? [{ name: 'anthropic-version', value: '2023-06-01' }, { name: 'content-type', value: 'application/json' }]
    : [{ name: 'content-type', value: 'application/json' }];

const LLM_CREDENTIAL =
  PROVIDER === 'anthropic'
    ? { httpHeaderAuth: { id: 'PW_ANTHROPIC', name: 'Anthropic API key (x-api-key)' } }
    : { httpHeaderAuth: { id: 'PW_OPENAI', name: 'OpenAI API key (Authorization: Bearer)' } };

function llmNode(name, position) {
  return node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST',
    url: LLM_URL,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendHeaders: true,
    headerParameters: { parameters: LLM_HEADERS },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.body) }}',
    options: { timeout: 120000 },
  }, {
    credentials: LLM_CREDENTIAL,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
  });
}

llmNode('Generate Post', [2020, -120]);
connect('Build Generator Request', 'Generate Post');

code(
  'Parse Generated Post',
  [2240, -120],
  `${COMPOSE_LIB}

// ---- node driver ----------------------------------------------------------
const base = $('Build Generator Request').first().json;
const raw = readCompletionText(${JSON.stringify(PROVIDER)}, $input.first().json);
const parsed = readJsonLoose(raw);

if (!parsed || !parsed.post_text) {
  // An unreadable generation is a failed attempt, not a crash. Hand it to the
  // rule checker with an explicit violation so the retry loop picks it up and
  // the reason lands in the run log.
  return [{
    json: {
      ...base,
      post: { post_text: '' },
      generationError: 'Model did not return usable JSON containing post_text.',
      rawCompletion: String(raw).slice(0, 2000),
      body: undefined,
    },
  }];
}

return [{
  json: {
    ...base,
    post: normalisePost(parsed, base.content),
    body: undefined,
  },
}];`,
);
connect('Generate Post', 'Parse Generated Post');

// ---------------------------------------------------------------------------
// 6. Guardrail layer 1 — deterministic rules
// ---------------------------------------------------------------------------

code(
  'Rule Checks',
  [2460, -120],
  `${GUARDRAIL_LIB}

// ---- node driver ----------------------------------------------------------
const d = $json;
const rules = runRuleChecks(d.post, d.content, {
  maxLengthBeforeLink: d.run.maxChars,
  minHashtags: d.run.minHashtags,
  maxHashtags: d.run.maxHashtags,
  allowPriceMention: d.run.allowPriceMention,
});

if (d.generationError) {
  rules.passed = false;
  rules.violations = [{ rule: 'GENERATION_FAILED', severity: 'fail', detail: d.generationError }].concat(rules.violations);
}

return [{ json: { ...d, rules } }];`,
);
connect('Parse Generated Post', 'Rule Checks');

ifBoolean('Rules Passed?', [2680, -120], '={{ $json.rules.passed }}');
connect('Rule Checks', 'Rules Passed?');

// ---------------------------------------------------------------------------
// 7. Guardrail layer 2 — independent LLM reviewer
// ---------------------------------------------------------------------------

code(
  'Build Validator Request',
  [2900, -220],
  `${COMPOSE_LIB}

// ---- node driver ----------------------------------------------------------
// Temperature 0: this is a check, and a check that returns a different answer
// each time it runs is not a check.
const d = $json;
const prompts = ${promptsLiteral(VALIDATOR)};

const { system, user } = composeValidator({
  content: d.content,
  post: d.post,
  prompts,
});

const body = toProviderBody(${JSON.stringify(PROVIDER)}, {
  system,
  user,
  model: d.run.model,
  temperature: 0,
  maxTokens: 800,
  jsonMode: true,
});

return [{ json: { ...d, body } }];`,
  { notes: 'The reviewer sees only the source and the finished post — never the generator’s own grounding_notes.' },
);
connect('Rules Passed?', 'Build Validator Request', 0);

llmNode('Validate Post', [3120, -220]);
connect('Build Validator Request', 'Validate Post');

code(
  'Parse Verdict',
  [3340, -220],
  `${GUARDRAIL_LIB}

${COMPOSE_LIB}

// ---- node driver ----------------------------------------------------------
const base = $('Build Validator Request').first().json;
const raw = readCompletionText(${JSON.stringify(PROVIDER)}, $input.first().json);
const verdict = parseVerdict(raw);

return [{ json: { ...base, verdict, verdictPassed: verdict.verdict === 'PASS', body: undefined } }];`,
);
connect('Validate Post', 'Parse Verdict');

ifBoolean('Validator Passed?', [3560, -220], '={{ $json.verdictPassed }}');
connect('Parse Verdict', 'Validator Passed?');

// ---------------------------------------------------------------------------
// 8. Retry loop
// ---------------------------------------------------------------------------

code(
  'Prepare Retry',
  [2900, 180],
  `// Both guardrail layers funnel their rejections here. We feed the specific
// violations back to the generator rather than simply re-rolling at a higher
// temperature: a model told exactly which line broke which rule fixes it,
// where a blind retry tends to reproduce the same mistake.
const d = $json;
const attempt = Number(d.attempt || 1);

const ruleViolations = ((d.rules && d.rules.violations) || [])
  .map((v) => '- [' + v.rule + '] ' + v.detail + (v.evidence ? ' => "' + v.evidence + '"' : ''));

const reviewerViolations = ((d.verdict && d.verdict.reviewerViolations) || [])
  .map((v) => '- [' + (v.rule || 'R?') + '] ' + (v.why || '') + (v.quote ? ' => "' + v.quote + '"' : ''));

const feedback = ['Rule checks:', ...ruleViolations, 'Reviewer:', ...reviewerViolations]
  .filter(Boolean)
  .join('\\n');

const exhausted = attempt >= Number(d.run.maxAttempts);

return [{
  json: {
    ...d,
    attempt: attempt + 1,
    feedback,
    retriesExhausted: exhausted,
    canRetry: !exhausted,
    rejectionReason: feedback,
  },
}];`,
);
connect('Rules Passed?', 'Prepare Retry', 1);
connect('Validator Passed?', 'Prepare Retry', 1);

ifBoolean('Can Retry?', [3120, 180], '={{ $json.canRetry }}');
connect('Prepare Retry', 'Can Retry?');
// true -> back round for another generation (n8n permits cycles)
connect('Can Retry?', 'Build Generator Request', 0);

// ---------------------------------------------------------------------------
// 9. Human approval
// ---------------------------------------------------------------------------

code(
  'Approval Required?',
  [3780, -220],
  `const d = $json;
return [{ json: { ...d, needsApproval: d.run.reviewMode === 'approval' } }];`,
);
connect('Validator Passed?', 'Approval Required?', 0);

ifBoolean('Approval Mode?', [4000, -220], '={{ $json.needsApproval }}');
connect('Approval Required?', 'Approval Mode?');

code(
  'Build Review Message',
  [4220, -320],
  `// The reviewer gets the post exactly as it will appear, the guardrail results,
// and two one-click links. The links are this execution's resume URL with a
// decision flag, so approving is a tap on a phone — no n8n login required.
const d = $json;
const resume = $execution.resumeUrl;

const advisories = ((d.rules && d.rules.advisories) || [])
  .map((a) => '• ' + a.rule + ': ' + a.detail)
  .join('\\n') || '• none';

const message = [
  '<b>PlacidWay draft — ' + d.run.contentType + '</b>',
  '',
  '<b>Source:</b> ' + d.content.title,
  d.content.url,
  '',
  '<b>Post:</b>',
  '<pre>' + String(d.post.post_text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>',
  '',
  'Length before link: ' + d.rules.metrics.lengthBeforeLink + '/' + d.run.maxChars,
  'Hashtags: ' + d.rules.metrics.hashtagCount,
  'Attempts: ' + d.attempt,
  'Image: ' + (d.content.image ? 'yes' : 'none'),
  '',
  '<b>Advisories:</b>',
  advisories,
  '',
  '<a href="' + resume + '?decision=approve">APPROVE</a>  |  <a href="' + resume + '?decision=reject">REJECT</a>',
].join('\\n');

return [{ json: { ...d, reviewMessage: message, resumeUrl: resume } }];`,
);
connect('Approval Mode?', 'Build Review Message', 0);

node('Send Draft To Reviewer', 'n8n-nodes-base.telegram', 1.2, [4440, -320], {
  chatId: '={{ $env.PW_TELEGRAM_CHAT_ID }}',
  text: '={{ $json.reviewMessage }}',
  additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true },
}, {
  credentials: { telegramApi: { id: 'PW_TELEGRAM', name: 'PlacidWay alert bot' } },
});
connect('Build Review Message', 'Send Draft To Reviewer');

node('Wait For Approval', 'n8n-nodes-base.wait', 1.1, [4660, -320], {
  resume: 'webhook',
  limitWaitTime: true,
  limitType: 'afterTimeInterval',
  resumeAmount: 24,
  resumeUnit: 'hours',
  options: { webhookSuffix: '' },
}, {
  webhookId: 'a1f0c4de-0000-4000-8000-000000000002',
  notes: 'Resumes when the reviewer opens one of the two links. Times out after 24h, which routes to Record Outcome as expired.',
});
connect('Send Draft To Reviewer', 'Wait For Approval');

code(
  'Read Decision',
  [4880, -320],
  `// The Wait node hands us the inbound request. A timeout resumes with no
// query at all, which we treat as "expired" — never as an approval.
const d = $('Build Review Message').first().json;
const incoming = $input.first().json || {};
const query = incoming.query || {};
const decision = String(query.decision || '').toLowerCase();

const approved = decision === 'approve';
const outcome = decision === 'approve' ? 'approved'
  : decision === 'reject' ? 'rejected'
  : 'expired';

return [{ json: { ...d, approved, approvalOutcome: outcome } }];`,
);
connect('Wait For Approval', 'Read Decision');

ifBoolean('Approved?', [5100, -320], '={{ $json.approved }}');
connect('Read Decision', 'Approved?');

// ---------------------------------------------------------------------------
// 10. Publish
// ---------------------------------------------------------------------------

code(
  'Build Publish Request',
  [5320, -220],
  `// Decides the Graph API call without branching the canvas three ways.
//
//  image present -> POST /{page}/photos  (url + caption)
//  no image      -> POST /{page}/feed    (message + link, so FB renders a card)
//
// publishMode:
//  simulate -> skip the call entirely; the run is still fully logged
//  schedule -> published=false + scheduled_publish_time (FB requires 10m-6mo out)
//  publish  -> live
const d = $json;
const run = d.run;
const hasImage = Boolean(d.content.image);

const edge = hasImage ? 'photos' : 'feed';
const endpoint = 'https://graph.facebook.com/' + run.graphVersion + '/' + run.facebookPageId + '/' + edge;

const body = hasImage
  ? { url: d.content.image, caption: d.post.post_text }
  : { message: d.post.post_text, link: d.content.url };

if (run.publishMode === 'schedule') {
  const offset = Math.max(15, Number(run.scheduleOffsetMinutes || 60));
  body.published = false;
  body.scheduled_publish_time = Math.floor(Date.now() / 1000) + offset * 60;
} else if (run.publishMode === 'publish') {
  body.published = true;
}

const skip = run.publishMode === 'simulate';
if (!skip && !run.facebookPageId) {
  throw new Error('PW_PUBLISH_MODE=' + run.publishMode + ' but PW_FB_PAGE_ID is not set.');
}

return [{ json: { ...d, publish: { endpoint, edge, body, skip, mode: run.publishMode, hasImage } } }];`,
);
connect('Approval Mode?', 'Build Publish Request', 1);
connect('Approved?', 'Build Publish Request', 0);

ifBoolean('Simulate Only?', [5540, -220], '={{ $json.publish.skip }}');
connect('Build Publish Request', 'Simulate Only?');

node('Post To Facebook', 'n8n-nodes-base.httpRequest', 4.2, [5760, -120], {
  method: 'POST',
  url: '={{ $json.publish.endpoint }}',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json.publish.body) }}',
  options: { timeout: 60000 },
}, {
  credentials: { httpHeaderAuth: { id: 'PW_FACEBOOK', name: 'Facebook Page token (Authorization: Bearer)' } },
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 10000,
  notes: 'Page access token lives in a header-auth credential, so it never appears in this export.',
});
connect('Simulate Only?', 'Post To Facebook', 1);

// ---------------------------------------------------------------------------
// 11. Logging
// ---------------------------------------------------------------------------

code(
  'Record Outcome',
  [5980, -220],
  `// One row per run, whatever happened. This is both the dedupe store and the
// audit trail, which is why rejected and failed runs are written too.
function resolve(nodeName) {
  try { return $(nodeName).first().json; } catch (e) { return null; }
}

const published = resolve('Post To Facebook');
const d = resolve('Build Publish Request') || resolve('Prepare Retry') || $json;

const fbId = published ? (published.post_id || published.id || '') : '';

let status;
if (d.retriesExhausted) status = 'rejected';
else if (d.approvalOutcome === 'rejected') status = 'rejected';
else if (d.approvalOutcome === 'expired') status = 'expired';
else if (d.publish && d.publish.skip) status = 'simulated';
else if (d.publish && d.publish.mode === 'schedule') status = 'scheduled';
else if (fbId) status = 'published';
else status = 'unknown';

const row = {
  run_id: d.run.runId,
  run_at: d.run.runAt,
  content_type: d.run.contentType,
  url: (d.content && d.content.url) || (d.item && d.item.url) || '',
  title: (d.content && d.content.title) || '',
  image: (d.content && d.content.image) || '',
  extracted_by: (d.content && d.content.extractedBy) || '',
  post_text: (d.post && d.post.post_text) || '',
  attempts: d.attempt || 1,
  rule_status: d.rules ? (d.rules.passed ? 'pass' : 'fail') : 'n/a',
  rule_violations: d.rules ? (d.rules.violations || []).map((v) => v.rule).join(', ') : '',
  validator_status: d.verdict ? d.verdict.verdict : 'n/a',
  validator_violations: d.verdict ? (d.verdict.reviewerViolations || []).map((v) => v.rule).join(', ') : '',
  review_mode: d.run.reviewMode,
  approval_outcome: d.approvalOutcome || 'n/a',
  publish_mode: d.run.publishMode,
  fb_post_id: fbId,
  status,
  error: d.rejectionReason || '',
};

return [{ json: { ...d, row, status } }];`,
);
connect('Simulate Only?', 'Record Outcome', 0);
connect('Post To Facebook', 'Record Outcome');
connect('Can Retry?', 'Record Outcome', 1);
connect('Approved?', 'Record Outcome', 1);
connect('Usable Content?', 'Record Outcome', 1);

node('Append To Run Log', 'n8n-nodes-base.googleSheets', 4.5, [6200, -220], {
  operation: 'append',
  documentId: { __rl: true, value: '={{ $json.run.sheetId }}', mode: 'id' },
  sheetName: { __rl: true, value: 'runs', mode: 'name' },
  columns: { mappingMode: 'autoMapInputData', matchingColumns: [], value: {} },
  options: {},
}, {
  credentials: { googleSheetsOAuth2Api: { id: 'PW_GOOGLE_SHEETS', name: 'PlacidWay Google Sheets' } },
});
connect('Record Outcome', 'Append To Run Log');

code(
  'Run Summary',
  [6420, -220],
  `const d = $('Record Outcome').first().json;
return [{
  json: {
    runId: d.row.run_id,
    status: d.row.status,
    contentType: d.row.content_type,
    url: d.row.url,
    title: d.row.title,
    attempts: d.row.attempts,
    facebookPostId: d.row.fb_post_id || null,
    post: d.row.post_text,
  },
}];`,
);
connect('Append To Run Log', 'Run Summary');

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const workflow = {
  name: `PlacidWay — Daily Facebook Post (${PROVIDER})`,
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    saveExecutionProgress: true,
    errorWorkflow: '={{ $env.PW_ERROR_WORKFLOW_ID }}',
    timezone: 'Asia/Jakarta',
  },
  pinData: {},
  meta: {
    builtBy: 'scripts/build-workflow.mjs',
    builtAt: new Date().toISOString(),
    provider: PROVIDER,
    note: 'Generated file. Edit lib/*.js and prompts/*.md, then re-run npm run build.',
  },
};

mkdirSync(join(root, 'workflow'), { recursive: true });
const outPath = join(root, 'workflow', `placidway-daily-facebook.${PROVIDER}.json`);
writeFileSync(outPath, JSON.stringify(workflow, null, 2), 'utf8');

console.log(`provider : ${PROVIDER}`);
console.log(`nodes    : ${nodes.length}`);
console.log(`wrote    : ${outPath}`);
