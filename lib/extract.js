/**
 * PlacidWay content extraction.
 *
 * Self-contained on purpose: no imports, no npm dependencies. The build script
 * (scripts/build-workflow.mjs) injects this file verbatim into the n8n Code
 * nodes, so the logic that is unit-tested locally is byte-for-byte the logic
 * that runs in production.
 */

const ARTICLE_TYPES = new Set(['Article', 'NewsArticle', 'BlogPosting', 'MedicalWebPage']);

/** Minimal HTML/XML entity decoder — enough for sitemap locs and meta tags. */
export function decodeEntities(value) {
  if (!value) return '';
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function firstMatch(haystack, pattern) {
  const found = pattern.exec(haystack);
  return found ? found[1] : null;
}

/**
 * Parse a sitemap <urlset> into normalised entries, newest first.
 *
 * Deliberately regex-based rather than a full XML parse: PlacidWay's article
 * sitemap is ~2.3 MB of machine-generated, perfectly flat XML and we need only
 * three fields. Building a DOM for it would cost memory and buy us nothing,
 * and the `image:` namespace is awkward in n8n's XML node.
 */
export function parseSitemap(xml, options = {}) {
  const limit = options.limit == null ? 40 : options.limit;
  const entries = [];
  const urlBlock = /<url>([\s\S]*?)<\/url>/g;

  let match;
  while ((match = urlBlock.exec(xml)) !== null) {
    const block = match[1];
    const loc = firstMatch(block, /<loc>\s*([\s\S]*?)\s*<\/loc>/);
    if (!loc) continue;

    const image = firstMatch(block, /<image:loc>\s*([\s\S]*?)\s*<\/image:loc>/);
    entries.push({
      url: decodeEntities(loc),
      lastmod: firstMatch(block, /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/),
      sitemapImage: image ? decodeEntities(image) : null,
    });
  }

  // lastmod is ISO-8601 (YYYY-MM-DD), so lexical sort === chronological sort.
  entries.sort((a, b) => String(b.lastmod || '').localeCompare(String(a.lastmod || '')));
  return limit > 0 ? entries.slice(0, limit) : entries;
}

/** Pull every <script type="application/ld+json"> payload that parses. */
function extractJsonLd(html) {
  const blocks = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // A malformed block is not fatal: other blocks, and the og: fallback,
      // can still carry the fields we need.
    }
  }
  return blocks;
}

/** Flatten @graph wrappers and arrays into a single list of schema.org nodes. */
function flattenGraph(blocks) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
    if (node['@type']) out.push(node);
  };
  blocks.forEach(visit);
  return out;
}

function typeOf(node) {
  const t = node['@type'];
  return Array.isArray(t) ? t[0] : t;
}

/** schema.org `image` is string | {url} | array of either. */
function imageUrlOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return imageUrlOf(value[0]);
  if (typeof value === 'object') return value.url || value.contentUrl || null;
  return null;
}

function metaContent(html, attr, name) {
  const pattern = new RegExp(
    `<meta[^>]*${attr}=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const direct = firstMatch(html, pattern);
  if (direct) return decodeEntities(direct);

  // Some templates put content= before the name/property attribute.
  const reversed = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${name}["']`,
    'i',
  );
  const flipped = firstMatch(html, reversed);
  return flipped ? decodeEntities(flipped) : null;
}

/** Strip tags/scripts from an HTML fragment and collapse whitespace. */
function htmlToText(fragment) {
  return decodeEntities(
    fragment
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the fields the generator needs from a PlacidWay page.
 *
 * Strategy, in order of preference:
 *   1. JSON-LD (Article.articleBody / Product.offers) — stable, machine-authored.
 *   2. Open Graph meta tags — present on every page, survives template changes.
 *   3. The .pack-inner-content container — last resort for body text only.
 *
 * Returns `null` for anything genuinely absent rather than guessing, so the
 * guardrails downstream can tell "no price" apart from "price unknown".
 */
export function extractContent(html, context = {}) {
  const nodes = flattenGraph(extractJsonLd(html));

  const article = nodes.find(
    (n) => ARTICLE_TYPES.has(typeOf(n)) && (n.articleBody || n.description),
  );
  const product = nodes.find((n) => typeOf(n) === 'Product');
  const primary = article || product || null;

  const offers = product && product.offers ? product.offers : null;
  const rawPrice = offers ? offers.price : null;
  const price = rawPrice == null || rawPrice === '' ? null : Number(rawPrice);

  let body = article && article.articleBody ? String(article.articleBody) : '';
  if (!body) {
    const container = firstMatch(
      html,
      /<div[^>]*class=["'][^"']*pack-inner-content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/(?:main|section|article)>/i,
    );
    if (container) body = htmlToText(container);
  }
  body = body.replace(/\s+/g, ' ').trim();

  const title =
    (primary && (primary.headline || primary.name)) ||
    metaContent(html, 'property', 'og:title') ||
    decodeEntities(firstMatch(html, /<title>([\s\S]*?)<\/title>/i) || '') ||
    null;

  const summary =
    (primary && primary.description) ||
    metaContent(html, 'property', 'og:description') ||
    metaContent(html, 'name', 'description') ||
    null;

  const image =
    metaContent(html, 'property', 'og:image') ||
    (primary && imageUrlOf(primary.image)) ||
    context.sitemapImage ||
    null;

  return {
    contentType: context.contentType || (product ? 'package' : 'article'),
    url: context.url || (primary && primary.url) || metaContent(html, 'property', 'og:url') || null,
    title: title ? title.trim() : null,
    summary: summary ? summary.trim() : null,
    body,
    bodyLength: body.length,
    image,
    datePublished: (primary && primary.datePublished) || null,
    dateModified: (primary && primary.dateModified) || context.lastmod || null,
    author: primary && primary.author ? primary.author.name || null : null,
    provider: product && product.brand ? product.brand.name || null : null,
    price,
    priceCurrency: offers ? offers.priceCurrency || null : null,
    // Everything the post is allowed to assert must be findable in here.
    sourceText: [title, summary, body].filter(Boolean).join('\n\n'),
    extractedBy: article ? 'json-ld:Article' : product ? 'json-ld:Product' : 'opengraph-fallback',
  };
}

/**
 * Is this item usable? Guards against half-rendered pages and stubs, which
 * would otherwise give the LLM nothing to ground itself in.
 */
export function isUsable(content, minBodyLength = 400) {
  const problems = [];
  if (!content.title) problems.push('missing title');
  if (!content.url) problems.push('missing url');
  if (!content.summary && content.bodyLength < minBodyLength) problems.push('no summary and body too short');
  if (content.bodyLength < minBodyLength) problems.push(`body ${content.bodyLength} < ${minBodyLength} chars`);
  return { usable: problems.length === 0, problems };
}
