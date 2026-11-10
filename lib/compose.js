/**
 * Prompt assembly and provider plumbing.
 *
 * Shared by three callers that must never disagree:
 *   - the n8n "Build Generator Request" / "Build Validator Request" Code nodes
 *     (this file is inlined into them at build time)
 *   - scripts/dry-run.mjs, the local harness
 *   - scripts/make-samples.mjs, which produces the sample output deliverable
 *
 * Self-contained: no imports. Prompt text is passed in, not read from disk,
 * because an n8n Code node has no filesystem.
 */

/** Substitute every {{PLACEHOLDER}} present in `vars`. Unknown ones are left alone. */
export function fillTemplate(template, vars) {
  let out = String(template);
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value == null ? '' : String(value));
  }
  return out;
}

/**
 * The price instruction is the single most load-bearing line in the generator
 * prompt, so it is built explicitly rather than interpolated inline.
 *
 * Three distinct states, and they must not be collapsed:
 *   - the page lists a price and we are allowed to cite it (exactly, unchanged)
 *   - the page lists a price and we are not allowed to cite it
 *   - the page lists no price at all
 */
export function priceInstruction(content, allowPriceMention) {
  if (content.price == null) {
    return 'Listed price: none published on this page — you MUST NOT mention any price or cost figure.';
  }
  const figure = `${content.price} ${content.priceCurrency || ''}`.trim();
  return allowPriceMention
    ? `Listed price: ${figure} — you MAY cite this exact figure, unchanged and in full. No other number, and no "from"/"starting at" framing.`
    : `Listed price: ${figure} — this is for your context only. You MUST NOT mention any price or cost figure in the post.`;
}

export function retryFeedbackBlock(feedback) {
  if (!feedback) return '';
  return [
    'YOUR PREVIOUS ATTEMPT WAS REJECTED BY THE GUARDRAILS.',
    feedback,
    'Rewrite the post from scratch and fix every point above. Do not argue with the rejection.',
  ].join('\n');
}

/** Build the generator's system + user messages. */
export function composeGenerator({ content, run, feedback, prompts }) {
  const system = fillTemplate(prompts.system, { MAX_CHARS: run.maxChars });
  const user = fillTemplate(prompts.user, {
    CONTENT_TYPE: content.contentType,
    TITLE: content.title,
    URL: content.url,
    PROVIDER: content.provider || 'PlacidWay marketplace listing',
    PRICE_LINE: priceInstruction(content, run.allowPriceMention),
    SUMMARY: content.summary || '(none)',
    BODY: content.bodyForModel || content.body || '',
    RETRY_FEEDBACK: retryFeedbackBlock(feedback),
  });
  return { system, user };
}

/**
 * Build the reviewer's system + user messages.
 *
 * Note what is absent: the generator's `grounding_notes` and `hook`/`cta`
 * breakdown. The reviewer is given the source and the finished post, nothing
 * else. Showing it the author's own justification turns an independent check
 * into a rubber stamp.
 */
export function composeValidator({ content, post, prompts }) {
  const user = fillTemplate(prompts.user, {
    TITLE: content.title,
    URL: content.url,
    PRICE_LINE:
      content.price == null
        ? 'The source page publishes no price.'
        : `Listed price on the source page: ${content.price} ${content.priceCurrency || ''}`.trim(),
    SUMMARY: content.summary || '(none)',
    BODY: content.bodyForModel || content.body || '',
    POST_TEXT: post.post_text || '',
  });
  return { system: prompts.system, user };
}

/** Shape the request body for whichever provider is configured. */
export function toProviderBody(provider, { system, user, model, temperature, maxTokens, jsonMode }) {
  if (provider === 'anthropic') {
    return {
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    };
  }
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

/** Pull the assistant text out of a provider response. */
export function readCompletionText(provider, response) {
  if (!response) return '';
  if (provider === 'anthropic') {
    const block = (response.content || [])[0] || {};
    return block.text || '';
  }
  const choice = (response.choices || [])[0] || {};
  return (choice.message || {}).content || '';
}

/**
 * Parse JSON out of a model response that may be fenced or wrapped in prose.
 * Returns null rather than throwing — callers treat null as a failed attempt.
 */
export function readJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const braced = /\{[\s\S]*\}/.exec(raw);
  const candidate = (fenced && fenced[1]) || (braced && braced[0]);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * The model sometimes puts the link or hashtags only in the structured fields
 * and omits them from post_text. Repair rather than reject: the guardrails
 * still get the final say on whatever comes out of here.
 */
export function normalisePost(post, content) {
  let text = String(post.post_text || '').trim();
  if (!text) return { ...post, post_text: '' };

  if (content.url && !text.includes(content.url)) {
    text += `\n${content.url}`;
  }
  const tags = Array.isArray(post.hashtags) ? post.hashtags : [];
  if (tags.length && !/#[\p{L}\p{N}_]+/u.test(text)) {
    text += `\n${tags.join(' ')}`;
  }
  return { ...post, post_text: text };
}
