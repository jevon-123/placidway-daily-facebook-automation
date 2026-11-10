/**
 * Checks that the Google Sheet is actually usable by the workflow, before you
 * find out the hard way inside n8n.
 *
 * It verifies the three things that go wrong:
 *   1. the spreadsheet was never shared with the service account
 *   2. a tab is missing or misnamed
 *   3. a header is misspelled, so the workflow writes into a column nobody reads
 *
 * The expected headers are read from docs/sheet-templates/, which are generated
 * from the workflow code itself — so this checks your sheet against what the
 * workflow genuinely writes, not against a list someone typed twice.
 *
 * No dependencies: the service-account JWT is signed with node:crypto.
 *
 *   node scripts/verify-sheet.mjs --key=C:\path\to\service-account.json --sheet=<SPREADSHEET_ID>
 *
 * --sheet may be omitted if PW_SHEET_ID is set.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
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

const keyPath = args.key;
const sheetId = args.sheet || process.env.PW_SHEET_ID;

if (!keyPath || !sheetId) {
  console.error('Usage: node scripts/verify-sheet.mjs --key=<service-account.json> --sheet=<SPREADSHEET_ID>');
  console.error('(--sheet may be omitted if PW_SHEET_ID is set)');
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error(`Service account file not found: ${keyPath}`);
  process.exit(1);
}

const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
if (!sa.client_email || !sa.private_key) {
  console.error('That JSON has no client_email / private_key. Download the key again (Keys -> Add key -> JSON).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Service-account auth: sign a JWT, swap it for an access token.
// ---------------------------------------------------------------------------

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  // The key arrives with literal \n sequences when it has been through a shell.
  const signature = signer.sign(sa.private_key.replace(/\\n/g, '\n'), 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function api(path, token) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return { ok: res.ok, status: res.status, json };
}

// ---------------------------------------------------------------------------

function expectedHeaders(name) {
  const path = join(root, 'docs', 'sheet-templates', `${name}.csv`);
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run the build scripts first.`);
  return readFileSync(path, 'utf8').trim().split(',').map((h) => h.trim());
}

let problems = 0;
const fail = (msg) => {
  problems += 1;
  console.log(`  FAIL  ${msg}`);
};
const ok = (msg) => console.log(`  ok    ${msg}`);

console.log(`service account : ${sa.client_email}`);
console.log(`spreadsheet     : ${sheetId}\n`);

let token;
try {
  token = await getAccessToken();
  ok('signed in as the service account');
} catch (err) {
  console.log(`  FAIL  could not authenticate: ${err.message}`);
  console.log('\n  The private key is probably malformed. Re-download the JSON key.');
  process.exit(1);
}

const meta = await api(`${sheetId}?fields=properties.title,sheets.properties.title`, token);

if (!meta.ok) {
  if (meta.status === 403 || meta.status === 404) {
    console.log(`  FAIL  cannot open the spreadsheet (HTTP ${meta.status})`);
    console.log('');
    console.log('  Almost certainly this: the spreadsheet has not been shared with the');
    console.log('  service account. Open it, click Share, and add this address as Editor:');
    console.log('');
    console.log(`      ${sa.client_email}`);
    console.log('');
    console.log('  A service account is a user. It can only see what is shared with it.');
  } else {
    console.log(`  FAIL  HTTP ${meta.status}: ${JSON.stringify(meta.json).slice(0, 300)}`);
  }
  process.exit(1);
}

ok(`opened "${meta.json.properties.title}"`);

const tabs = meta.json.sheets.map((s) => s.properties.title);
console.log(`  tabs: ${tabs.join(', ')}\n`);

for (const tab of ['runs', 'errors']) {
  if (!tabs.includes(tab)) {
    fail(`tab "${tab}" is missing (found: ${tabs.join(', ') || 'none'})`);
    continue;
  }

  const row = await api(`${sheetId}/values/${encodeURIComponent(tab)}!1:1`, token);
  if (!row.ok) {
    fail(`could not read ${tab} row 1: HTTP ${row.status}`);
    continue;
  }

  const actual = ((row.json.values || [])[0] || []).map((h) => String(h).trim());
  const expected = expectedHeaders(tab);

  if (actual.length === 0) {
    fail(`tab "${tab}" has no header row — paste the headers into A1 and use Data > Split text to columns`);
    continue;
  }

  const missing = expected.filter((h) => !actual.includes(h));
  const extra = actual.filter((h) => h && !expected.includes(h));
  const misordered = expected.every((h) => actual.includes(h)) && expected.join(',') !== actual.slice(0, expected.length).join(',');

  if (missing.length === 0 && extra.length === 0) {
    ok(`tab "${tab}" has all ${expected.length} expected headers`);
    if (misordered) {
      console.log('        (order differs from the template — harmless, the workflow maps by name)');
    }
  } else {
    if (missing.length) fail(`tab "${tab}" is missing: ${missing.join(', ')}`);
    if (extra.length) fail(`tab "${tab}" has unexpected columns: ${extra.join(', ')}`);
    console.log(`        expected: ${expected.join(',')}`);
    console.log(`        found   : ${actual.join(',')}`);
  }
}

console.log('');
if (problems === 0) {
  console.log('Sheet is ready. Use this credential in n8n:');
  console.log(`  Service Account Email : ${sa.client_email}`);
  console.log('  Private Key           : the private_key value from the same JSON file');
  process.exit(0);
} else {
  console.log(`${problems} problem(s) to fix. See docs/n8n-setup.md section 3.`);
  process.exit(1);
}
