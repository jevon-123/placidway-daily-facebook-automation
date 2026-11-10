/**
 * Layer 1 of the guardrail: deterministic, rule-based checks.
 *
 * This layer exists to catch everything that does NOT need judgement — length,
 * hashtag count, link integrity, forbidden claim phrases, and above all whether
 * every number in the post can be found in the source page. It is cheap,
 * reproducible, and it fails closed.
 *
 * Layer 2 (an independent LLM reviewer, see prompts/validator.md) catches what
 * regex cannot: implied promises, tonal over-reach, and facts that are phrased
 * plausibly but are simply not on the page.
 *
 * Self-contained by design — injected verbatim into an n8n Code node.
 */

/**
 * Hard failures. These are promises and claims a medical-tourism marketplace
 * must never publish, regardless of what the source page says.
 *
 * Note what is deliberately NOT here: topic words like "cost", "success rate",
 * "treatment" or "recovery". PlacidWay's own article titles contain them
 * ("IVF in Mexico vs USA: Cost & Success Rates"), so banning them would reject
 * accurate posts. We ban the *claim*, not the *subject*.
 */
const PROHIBITED = [
  { id: 'CURE', pattern: /\b(cure[sd]?|curing)\b/i, why: 'claims a cure' },
  { id: 'GUARANTEE', pattern: /\b(guarantee[sd]?|guaranteeing)\b/i, why: 'promises an outcome' },
  { id: 'ABSOLUTE_PCT', pattern: /\b100\s*%\s*(safe|effective|success|painless|guaranteed)\b/i, why: 'absolute safety/efficacy claim' },
  { id: 'RISK_FREE', pattern: /\brisk[\s-]?free\b/i, why: 'denies clinical risk' },
  { id: 'PAINLESS', pattern: /\b(painless|pain[\s-]?free)\b/i, why: 'promises a pain-free experience' },
  { id: 'NO_SIDE_EFFECTS', pattern: /\b(no side[\s-]?effects?|side[\s-]?effect[\s-]?free)\b/i, why: 'denies side effects' },
  { id: 'MIRACLE', pattern: /\bmiracle|miraculous\b/i, why: 'sensationalises treatment' },
  { id: 'PERMANENT_FIX', pattern: /\bpermanent(ly)?\s+(cure|fix|solution|relief)\b/i, why: 'promises permanence' },
  { id: 'PROVEN_TO', pattern: /\bproven\s+to\s+(cure|heal|eliminate|reverse|restore)\b/i, why: 'unsupported efficacy claim' },
  { id: 'WILL_OUTCOME', pattern: /\b(will|guarantees?\s+to)\s+(cure|heal|fix|eliminate|reverse|restore)\b/i, why: 'promises a clinical outcome' },
  { id: 'SUPERLATIVE', pattern: /\b(the\s+(best|safest|top)\s+\w+|#\s?1\b|\bnumber\s+one\b|world'?s\s+(best|leading|top))/i, why: 'unverifiable superlative' },
  { id: 'INSTANT', pattern: /\binstant(ly)?\s+(relief|results?|recovery)\b/i, why: 'promises instant results' },
  { id: 'ELIMINATES', pattern: /\b(eliminates?|reverses?|removes?)\s+(all\s+)?(pain|cancer|disease|illness)\b/i, why: 'promises disease elimination' },
  { id: 'MEDICAL_ADVICE', pattern: /\byou\s+(should|must|need to)\s+(get|have|undergo|take)\b/i, why: 'gives individual medical advice' },
];

/** Soft signals. Logged and shown to the reviewer, but do not block a post. */
const ADVISORY = [
  { id: 'EFFICACY_WORD', pattern: /\b(effective|safe|successful)\b/i, why: 'efficacy wording — verify it is attributed to the source' },
  { id: 'SUCCESS_RATE', pattern: /\bsuccess\s+rates?\b/i, why: 'mentions success rates — any figure must be grounded' },
];

// "review" and "research" earn their place here: a generated post ending
// "you can review the full details" was being flagged as having no call to
// action, which is wrong and trains you to ignore the advisory.
const CTA_CUES = /\b(learn|explore|discover|read|review|research|compare|find out|see|request|browse|check|talk to|speak with|get in touch|contact)\b/i;

/** "16,000" and "16000.0" and "$16,000" must all compare equal. */
function normaliseNumber(token) {
  const cleaned = String(token).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Every digit-bearing token in the text.
 *
 * Trailing punctuation is stripped: "under 40." must yield "40", not "40.",
 * so that the evidence we report back to the generator and the reviewer reads
 * as the figure itself. Internal separators are kept — "16,000" and "3.4" are
 * single figures, not several.
 */
function numericTokens(text) {
  const matches = text.match(/\d[\d.,]*\s*%?/g) || [];
  return matches
    .map((t) => t.trim().replace(/[.,]+$/, ''))
    .filter(Boolean);
}

function buildSourceNumberSet(sourceText) {
  const set = new Set();
  for (const token of numericTokens(sourceText)) {
    const value = normaliseNumber(token);
    if (value !== null) set.add(value);
  }
  return set;
}

/**
 * @param {object} post      Generator output: { post_text, hashtags }
 * @param {object} content   extractContent() output for the source page
 * @param {object} config    { maxLengthBeforeLink, minHashtags, maxHashtags, allowPriceMention }
 */
export function runRuleChecks(post, content, config = {}) {
  const maxLength = config.maxLengthBeforeLink == null ? 500 : config.maxLengthBeforeLink;
  const minHashtags = config.minHashtags == null ? 3 : config.minHashtags;
  const maxHashtags = config.maxHashtags == null ? 5 : config.maxHashtags;
  const allowPrice = config.allowPriceMention === true;

  const violations = [];
  const advisories = [];
  const text = String(post.post_text || '').trim();

  const fail = (rule, detail, evidence) =>
    violations.push({ rule, severity: 'fail', detail, evidence: evidence || null });
  const warn = (rule, detail, evidence) =>
    advisories.push({ rule, severity: 'warn', detail, evidence: evidence || null });

  if (!text) {
    fail('EMPTY_POST', 'generator returned no post text');
    return { passed: false, violations, advisories, metrics: {} };
  }

  // ---- Link integrity -----------------------------------------------------
  const sourceUrl = content.url || '';
  const linkIndex = sourceUrl ? text.indexOf(sourceUrl) : -1;
  if (!sourceUrl) {
    fail('NO_SOURCE_URL', 'source item has no URL to link to');
  } else if (linkIndex === -1) {
    fail('LINK_MISSING', 'post does not contain the exact source URL', sourceUrl);
  }

  const otherLinks = (text.match(/https?:\/\/\S+/g) || []).filter((u) => !u.startsWith(sourceUrl));
  if (otherLinks.length > 0) {
    fail('FOREIGN_LINK', 'post links somewhere other than the source page', otherLinks.join(', '));
  }

  // ---- Length before the link --------------------------------------------
  const beforeLink = (linkIndex === -1 ? text : text.slice(0, linkIndex)).trim();
  const lengthBeforeLink = beforeLink.length;
  if (lengthBeforeLink > maxLength) {
    fail('LENGTH_EXCEEDED', `${lengthBeforeLink} chars before the link, limit is ${maxLength}`);
  }
  if (lengthBeforeLink < 80) {
    fail('LENGTH_TOO_SHORT', `${lengthBeforeLink} chars before the link — too thin to be useful`);
  }

  // ---- Hashtags -----------------------------------------------------------
  const hashtags = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (hashtags.length < minHashtags || hashtags.length > maxHashtags) {
    fail('HASHTAG_COUNT', `${hashtags.length} hashtags, expected ${minHashtags}-${maxHashtags}`, hashtags.join(' '));
  }
  const duplicateTags = hashtags.filter((t, i) => hashtags.findIndex((o) => o.toLowerCase() === t.toLowerCase()) !== i);
  if (duplicateTags.length) {
    fail('HASHTAG_DUPLICATE', 'duplicate hashtags', duplicateTags.join(' '));
  }

  // ---- Prohibited claims --------------------------------------------------
  // Checked against the prose only: a hashtag like #CancerCare must not trip
  // the disease patterns, and the URL slug is not editorial copy.
  const prose = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ');

  for (const rule of PROHIBITED) {
    const hit = rule.pattern.exec(prose);
    if (hit) fail(`CLAIM_${rule.id}`, rule.why, hit[0]);
  }
  for (const rule of ADVISORY) {
    const hit = rule.pattern.exec(prose);
    if (hit) warn(`ADVISORY_${rule.id}`, rule.why, hit[0]);
  }

  // ---- Price policy -------------------------------------------------------
  const currencyHits = prose.match(/(?:US\$|\$|€|£|USD|EUR|GBP)\s?\d[\d.,]*|\d[\d.,]*\s?(?:USD|EUR|GBP)\b/gi) || [];
  if (currencyHits.length > 0) {
    if (!allowPrice) {
      fail('PRICE_MENTION', 'post states a price but ALLOW_PRICE_MENTION is off', currencyHits.join(', '));
    } else if (content.price == null) {
      fail('PRICE_UNGROUNDED', 'post states a price but the source page publishes none', currencyHits.join(', '));
    } else {
      const sourcePrice = Number(content.price);
      const mismatched = currencyHits.filter((hit) => normaliseNumber(hit) !== sourcePrice);
      if (mismatched.length) {
        fail('PRICE_MISMATCH', `price does not match the source (${sourcePrice} ${content.priceCurrency || ''})`, mismatched.join(', '));
      }
    }
  }

  // ---- Numeric grounding --------------------------------------------------
  // The single highest-value check here. Hallucinated statistics are the most
  // likely and most damaging failure mode for this kind of post, and they are
  // trivially detectable: every figure in the copy must appear in the source.
  const sourceNumbers = buildSourceNumberSet(content.sourceText || '');
  if (allowPrice && content.price != null) sourceNumbers.add(Number(content.price));

  const ungrounded = [];
  for (const token of numericTokens(prose)) {
    const value = normaliseNumber(token);
    if (value === null) continue;
    // Small integers are ordinary prose ("3 clinics", "2 weeks") and appear in
    // almost any source; demanding an exact match on them creates false alarms.
    if (Number.isInteger(value) && value <= 10) continue;
    if (!sourceNumbers.has(value)) ungrounded.push(token.trim());
  }
  if (ungrounded.length) {
    fail('UNGROUNDED_NUMBER', 'figure does not appear anywhere in the source page', ungrounded.join(', '));
  }

  // ---- Shape and tone -----------------------------------------------------
  if (!CTA_CUES.test(prose)) {
    warn('NO_CTA_CUE', 'no recognisable call to action');
  }

  const shouted = prose.match(/\b[A-Z]{4,}\b/g) || [];
  const allowedCaps = new Set(['IVF', 'FDA', 'KFSHRC', 'USA', 'MRI', 'ICU', 'PLACIDWAY']);
  const realShouting = shouted.filter((w) => !allowedCaps.has(w.toUpperCase()));
  if (realShouting.length) warn('SHOUTING', 'all-caps words', realShouting.join(', '));

  const emoji = text.match(/\p{Extended_Pictographic}/gu) || [];
  if (emoji.length > 6) warn('EMOJI_OVERLOAD', `${emoji.length} emoji`);

  const valueLines = beforeLink
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#/.test(l));
  if (valueLines.length < 3 || valueLines.length > 7) {
    warn('SHAPE', `${valueLines.length} non-hashtag lines before the link (hook + 2-4 value lines + CTA expected)`);
  }

  return {
    passed: violations.length === 0,
    violations,
    advisories,
    metrics: {
      lengthBeforeLink,
      totalLength: text.length,
      hashtagCount: hashtags.length,
      hashtags,
      emojiCount: emoji.length,
      valueLineCount: valueLines.length,
      numbersInPost: numericTokens(prose),
      sourceNumbersKnown: sourceNumbers.size,
    },
  };
}

/**
 * Parse the layer-2 reviewer's JSON verdict defensively. An unreadable verdict
 * is treated as a failure, never as a pass — the guardrail fails closed.
 */
export function parseVerdict(raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    const braced = /\{[\s\S]*\}/.exec(text);
    const candidate = (fenced && fenced[1]) || (braced && braced[0]);
    if (candidate) {
      try {
        parsed = JSON.parse(candidate);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { verdict: 'FAIL', reviewerViolations: [{ rule: 'VERDICT_UNPARSEABLE', detail: 'reviewer did not return valid JSON' }], raw: text };
  }

  const verdict = String(parsed.verdict || '').toUpperCase() === 'PASS' ? 'PASS' : 'FAIL';
  return {
    verdict,
    reviewerViolations: Array.isArray(parsed.violations) ? parsed.violations : [],
    reviewerNotes: parsed.notes || null,
    raw: text,
  };
}
