/**
 * Resets a tab of the run log: wipes every cell and writes back exactly the
 * headers the workflow expects.
 *
 * Why you need this. The Sheets node appends with `autoMapInputData`, which
 * matches top-level keys against column names — and silently *creates a new
 * column* for any key it does not recognise. One node emitting the wrong shape
 * therefore does not just write a bad row: it permanently widens the sheet,
 * and every later append inherits the mess. Clearing the values is not enough,
 * because the stray headers stay.
 *
 * Headers come from docs/sheet-templates/, which are generated from the
 * workflow code, so this restores the sheet to what the workflow actually
 * writes rather than to someone's memory of it.
 *
 *   node scripts/reset-sheet.mjs --key=<service-account.json> [--sheet=<ID>] [--tab=runs]
 *
 * Destructive, so it refuses to run without --yes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadServiceAccount, getAccessToken, sheetsGet } from '../lib/google-auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const keyPath = args.key;
const sheetId = args.sheet || process.env.PW_SHEET_ID;
const tab = String(args.tab || 'runs');

if (!keyPath || !sheetId) {
  console.error('Usage: node scripts/reset-sheet.mjs --key=<service-account.json> --sheet=<ID> [--tab=runs] --yes');
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error(`Service account file not found: ${keyPath}`);
  process.exit(1);
}

const templatePath = join(root, 'docs', 'sheet-templates', `${tab}.csv`);
if (!existsSync(templatePath)) {
  console.error(`No header template for tab "${tab}" at ${templatePath}`);
  process.exit(1);
}
const headers = readFileSync(templatePath, 'utf8').trim().split(',').map((h) => h.trim());

const sa = loadServiceAccount(keyPath);
const token = await getAccessToken(sa, 'https://www.googleapis.com/auth/spreadsheets');

// --- report what is there now ---------------------------------------------

const current = await sheetsGet(`${sheetId}/values/${encodeURIComponent(tab)}`, token);
if (!current.ok) {
  console.error(`Could not read "${tab}" (HTTP ${current.status}). Is the sheet shared with ${sa.client_email}?`);
  process.exit(1);
}
const rows = current.json.values || [];
const currentHeaders = (rows[0] || []).filter((h) => String(h).trim() !== '');

console.log(`tab           : ${tab}`);
console.log(`current cols  : ${currentHeaders.length}`);
console.log(`expected cols : ${headers.length}`);
console.log(`data rows     : ${Math.max(0, rows.length - 1)}`);

const strays = currentHeaders.filter((h) => !headers.includes(h));
if (strays.length) {
  console.log(`stray columns : ${strays.join(', ')}`);
  console.log('                (created by autoMapInputData from an unexpected item shape)');
}

if (!args.yes) {
  console.log('');
  console.log('This will delete every row. Re-run with --yes to proceed.');
  process.exit(0);
}

// --- wipe, then write the headers back ------------------------------------

const clear = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}:clear`,
  { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' },
);
if (!clear.ok) {
  console.error(`Clear failed: HTTP ${clear.status} ${JSON.stringify(await clear.json()).slice(0, 300)}`);
  process.exit(1);
}

const write = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
  {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: [headers] }),
  },
);
if (!write.ok) {
  console.error(`Header write failed: HTTP ${write.status} ${JSON.stringify(await write.json()).slice(0, 300)}`);
  process.exit(1);
}

console.log('');
console.log(`reset "${tab}" to ${headers.length} columns, 0 data rows`);
