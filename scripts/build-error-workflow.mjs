/**
 * Builds the shared error workflow.
 *
 * n8n invokes this automatically whenever the main workflow throws — set it
 * once under Workflow settings -> Error workflow. It is deliberately separate
 * from the main canvas so that a failure in *any* node, including the ones that
 * run before our own try/catch could exist, still produces an alert.
 *
 *   node scripts/build-error-workflow.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let idSeq = 0;
const nextId = () => `pwe-${String(++idSeq).padStart(3, '0')}`;

const nodes = [];
const connections = {};

function node(name, type, typeVersion, position, parameters, extra = {}) {
  nodes.push({ parameters, id: nextId(), name, type, typeVersion, position, ...extra });
  return name;
}
function connect(from, to, outputIndex = 0) {
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= outputIndex) connections[from].main.push([]);
  connections[from].main[outputIndex].push({ node: to, type: 'main', index: 0 });
}

node('On Workflow Error', 'n8n-nodes-base.errorTrigger', 1, [-280, 0], {});

node(
  'Classify Failure',
  'n8n-nodes-base.code',
  2,
  [-60, 0],
  {
    jsCode: `// Turn n8n's error payload into something a human can act on at 07:03.
// The classification matters: a 500 from PlacidWay is "wait and see", an
// expired token is "go and fix it now", and the two should not look alike.
const e = $json.execution || {};
const w = $json.workflow || {};
const err = e.error || {};

const message = String(err.message || 'Unknown error');
const nodeName = (err.node && err.node.name) || e.lastNodeExecuted || 'unknown node';
const status = Number((err.httpCode != null ? err.httpCode : (err.statusCode != null ? err.statusCode : 0))) || null;

function classify() {
  const m = message.toLowerCase();
  if (/session has expired|access token|oauthexception|code 190|invalid_token|unauthorized/.test(m) || status === 401) {
    return { kind: 'AUTH', severity: 'page', hint: 'A token expired or was revoked. Refresh the Facebook Page token or re-authorise the Google/LLM credential. The daily run is blocked until this is fixed.' };
  }
  if (/rate limit|too many requests|quota|insufficient_quota/.test(m) || status === 429) {
    return { kind: 'RATE_LIMIT', severity: 'warn', hint: 'We are being throttled. No action needed unless it repeats tomorrow; consider lowering PW_CANDIDATE_LIMIT or the schedule frequency.' };
  }
  if (status != null && status >= 500) {
    return { kind: 'UPSTREAM_5XX', severity: 'warn', hint: 'The upstream service failed after our retries. Usually transient — the next scheduled run should recover.' };
  }
  if (/etimedout|econnreset|enotfound|socket hang up|network/.test(m)) {
    return { kind: 'NETWORK', severity: 'warn', hint: 'Network-level failure reaching an upstream host. Transient in almost all cases.' };
  }
  if (/no unposted/.test(m)) {
    return { kind: 'CONTENT_EXHAUSTED', severity: 'warn', hint: 'Every recent item of this content type has already been posted. Raise PW_CANDIDATE_LIMIT or widen the rotation.' };
  }
  if (/sitemap/.test(m)) {
    return { kind: 'EXTRACTION', severity: 'page', hint: 'The sitemap did not look like we expect. PlacidWay may have changed its structure — re-run scripts/test-guardrails.mjs against fresh fixtures.' };
  }
  return { kind: 'UNCLASSIFIED', severity: 'page', hint: 'Not a failure mode we have seen before. Open the execution and read the stack.' };
}

const c = classify();
const executionUrl = e.url || '';

const text = [
  (c.severity === 'page' ? '\\u{1F534}' : '\\u{1F7E0}') + ' <b>PlacidWay automation failed</b>',
  '',
  '<b>Workflow:</b> ' + (w.name || 'unknown'),
  '<b>Failed at:</b> ' + nodeName,
  '<b>Class:</b> ' + c.kind + (status ? ' (HTTP ' + status + ')' : ''),
  '<b>Mode:</b> ' + (e.mode || 'unknown'),
  '',
  '<b>Error:</b>',
  '<pre>' + message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 600) + '</pre>',
  '',
  '<b>What to do:</b>',
  c.hint,
  executionUrl ? '\\n<a href="' + executionUrl + '">Open the execution</a>' : '',
].filter(Boolean).join('\\n');

return [{
  json: {
    kind: c.kind,
    severity: c.severity,
    nodeName,
    status,
    message,
    hint: c.hint,
    executionUrl,
    workflowName: w.name || '',
    alertText: text,
    failedAt: new Date().toISOString(),
  },
}];`,
  },
);
connect('On Workflow Error', 'Classify Failure');

node(
  'Send Alert',
  'n8n-nodes-base.telegram',
  1.2,
  [160, -100],
  {
    chatId: '={{ $env.PW_TELEGRAM_CHAT_ID }}',
    text: '={{ $json.alertText }}',
    additionalFields: { parse_mode: 'HTML', disable_web_page_preview: true },
  },
  {
    credentials: { telegramApi: { id: 'PW_TELEGRAM', name: 'PlacidWay alert bot' } },
    onError: 'continueRegularOutput',
    notes: 'continueRegularOutput so that a Telegram outage still lets the failure reach the sheet.',
  },
);
connect('Classify Failure', 'Send Alert');

node(
  'Log Failure',
  'n8n-nodes-base.googleSheets',
  4.5,
  [160, 100],
  {
    operation: 'append',
    documentId: { __rl: true, value: '={{ $env.PW_SHEET_ID }}', mode: 'id' },
    sheetName: { __rl: true, value: 'errors', mode: 'name' },
    columns: { mappingMode: 'autoMapInputData', matchingColumns: [], value: {} },
    options: {},
  },
  {
    credentials: { googleSheetsOAuth2Api: { id: 'PW_GOOGLE_SHEETS', name: 'PlacidWay Google Sheets' } },
    onError: 'continueRegularOutput',
  },
);
connect('Classify Failure', 'Log Failure');

const workflow = {
  name: 'PlacidWay — Error Handler',
  nodes,
  connections,
  settings: { executionOrder: 'v1', timezone: 'Asia/Jakarta' },
  pinData: {},
  meta: {
    builtBy: 'scripts/build-error-workflow.mjs',
    builtAt: new Date().toISOString(),
    note: 'Generated file. Set this as the Error Workflow of the main workflow.',
  },
};

mkdirSync(join(root, 'workflow'), { recursive: true });
const outPath = join(root, 'workflow', 'placidway-error-handler.json');
writeFileSync(outPath, JSON.stringify(workflow, null, 2), 'utf8');
console.log(`nodes : ${nodes.length}`);
console.log(`wrote : ${outPath}`);
