/**
 * Service-account auth for the Google Sheets REST API.
 *
 * Not injected into n8n — the Google Sheets node handles its own auth there.
 * This exists so the local scripts (verify-sheet, show-runs) can read the same
 * spreadsheet the workflow writes to, using the same service-account key, with
 * no dependencies to install.
 */

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Load and sanity-check a service-account JSON file. */
export function loadServiceAccount(path) {
  const sa = JSON.parse(readFileSync(path, 'utf8'));
  if (!sa.client_email || !sa.private_key) {
    throw new Error('That JSON has no client_email / private_key. Re-download it from Keys -> Add key -> JSON.');
  }
  return sa;
}

/**
 * Sign a JWT and exchange it for an access token.
 *
 * `scope` defaults to read-only; pass the read/write scope only when a caller
 * genuinely needs to write.
 */
export async function getAccessToken(sa, scope = 'https://www.googleapis.com/auth/spreadsheets.readonly') {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  // The key arrives with literal \n sequences when it has been through a shell.
  const signature = signer
    .sign(sa.private_key.replace(/\\n/g, '\n'), 'base64')
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
  if (!res.ok) throw new Error(`Token exchange failed (HTTP ${res.status}): ${JSON.stringify(json)}`);
  return json.access_token;
}

/** GET against the Sheets API. Returns { ok, status, json } rather than throwing. */
export async function sheetsGet(path, token) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return { ok: res.ok, status: res.status, json };
}

/**
 * Turn a Sheets values response into objects keyed by the header row.
 * Rows shorter than the header are padded, because Sheets omits trailing empties.
 */
export function rowsToObjects(values) {
  if (!values || values.length === 0) return [];
  const [header, ...rows] = values;
  return rows.map((row) =>
    Object.fromEntries(header.map((key, i) => [key, row[i] == null ? '' : row[i]])),
  );
}
