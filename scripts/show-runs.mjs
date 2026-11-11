/**
 * Prints the most recent rows of the run log from the Google Sheet.
 *
 * Useful for checking what the workflow actually recorded without opening a
 * browser, and for the walkthrough: the sheet is the audit trail, so being able
 * to read it from the terminal makes the demo tighter.
 *
 *   node scripts/show-runs.mjs --key=<service-account.json> [--sheet=<ID>] [--limit=5] [--full]
 *
 * --sheet may be omitted if PW_SHEET_ID is set.
 * --full prints the complete post text rather than the first line.
 */

import { existsSync } from 'node:fs';
import { loadServiceAccount, getAccessToken, sheetsGet, rowsToObjects } from '../lib/google-auth.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const keyPath = args.key;
const sheetId = args.sheet || process.env.PW_SHEET_ID;
const limit = Number(args.limit || 5);

if (!keyPath || !sheetId) {
  console.error('Usage: node scripts/show-runs.mjs --key=<service-account.json> --sheet=<SPREADSHEET_ID>');
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error(`Service account file not found: ${keyPath}`);
  process.exit(1);
}

const sa = loadServiceAccount(keyPath);
const token = await getAccessToken(sa);

const res = await sheetsGet(`${sheetId}/values/${encodeURIComponent('runs')}`, token);
if (!res.ok) {
  console.error(`Could not read the runs sheet (HTTP ${res.status}).`);
  if (res.status === 403 || res.status === 404) {
    console.error(`Is it shared with ${sa.client_email}?`);
  }
  process.exit(1);
}

const rows = rowsToObjects(res.json.values);
if (rows.length === 0) {
  console.log('The run log is empty. Nothing has executed yet.');
  process.exit(0);
}

console.log(`${rows.length} run(s) logged. Showing the last ${Math.min(limit, rows.length)}.\n`);

for (const row of rows.slice(-limit)) {
  const statusMark =
    row.status === 'published' || row.status === 'scheduled' ? '[OK]'
    : row.status === 'simulated' ? '[SIM]'
    : row.status === 'rejected' ? '[REJ]'
    : '[??]';

  console.log('-'.repeat(74));
  console.log(`${statusMark} ${row.status.padEnd(10)} ${row.run_at}`);
  console.log(`  type       : ${row.content_type}`);
  console.log(`  title      : ${row.title}`);
  console.log(`  url        : ${row.url}`);
  console.log(`  extracted  : ${row.extracted_by}`);
  console.log(`  attempts   : ${row.attempts}`);
  console.log(`  rules      : ${row.rule_status}${row.rule_violations ? ` (${row.rule_violations})` : ''}`);
  console.log(`  reviewer   : ${row.validator_status}${row.validator_violations ? ` (${row.validator_violations})` : ''}`);
  console.log(`  review mode: ${row.review_mode} / ${row.approval_outcome}`);
  console.log(`  publish    : ${row.publish_mode}${row.fb_post_id ? ` -> ${row.fb_post_id}` : ''}`);
  if (row.error) console.log(`  error      : ${row.error.split('\n')[0]}`);

  const post = String(row.post_text || '');
  if (post) {
    console.log('  post       :');
    const shown = args.full ? post : post.split('\n').slice(0, 3).join('\n');
    for (const line of shown.split('\n')) console.log(`    ${line}`);
    if (!args.full && post.split('\n').length > 3) console.log('    ... (--full for the rest)');
  }
}
console.log('-'.repeat(74));
