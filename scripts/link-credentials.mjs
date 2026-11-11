/**
 * Points the imported workflows at the things that only exist on *this* n8n
 * instance: the credentials, and the error workflow. Both are matched by name.
 *
 * Why this exists: the workflow JSON in workflow/ carries placeholder credential
 * IDs (PW_GOOGLE_SHEETS, PW_LLM, ...). Real IDs are assigned per instance, so
 * committing one would be meaningless anywhere else. The consequence is that
 * every re-import wipes whatever you attached in the UI — and you re-import
 * after every build. Doing it by hand each time is how a demo breaks the
 * morning it matters.
 *
 * Matching is by credential *name*, which is why build-workflow.mjs sets names
 * like "PlacidWay Google Sheets" rather than leaving them blank.
 *
 * n8n must be stopped: this writes straight to the SQLite database.
 *
 *   node scripts/link-credentials.mjs
 *   node scripts/link-credentials.mjs --dry-run
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const DRY_RUN = Boolean(args['dry-run']);
const N8N_ROOT = args['n8n-root'] || 'C:/Users/jevon/tools/node-v24.22.2-win-x64/node_modules/n8n';
const DB_PATH = args.db || join(homedir(), '.n8n', 'database.sqlite');

if (!existsSync(DB_PATH)) {
  console.error(`No n8n database at ${DB_PATH}. Start n8n once to create it.`);
  process.exit(1);
}

// sqlite3 ships inside n8n, so there is nothing to install.
const require = createRequire(`${N8N_ROOT}/package.json`);
let sqlite3;
try {
  sqlite3 = require('sqlite3');
} catch (err) {
  console.error(`Could not load sqlite3 from ${N8N_ROOT}: ${err.message}`);
  console.error('Pass --n8n-root=<path to n8n package> if n8n lives somewhere else.');
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH);
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
const run = (sql, p = []) =>
  new Promise((res, rej) => db.run(sql, p, function cb(e) { e ? rej(e) : res(this); }));

// --- what credentials exist, keyed by "type::name" -------------------------

const credentials = await all('SELECT id, name, type FROM credentials_entity');
const byKey = new Map(credentials.map((c) => [`${c.type}::${c.name}`, c]));

console.log(`credentials on this instance: ${credentials.length}`);
for (const c of credentials) console.log(`  ${c.id.padEnd(20)} ${c.type.padEnd(18)} ${c.name}`);
console.log('');

// --- find the error handler so the main workflow can point at it -----------
//
// settings.errorWorkflow has to be a literal workflow ID. n8n does NOT evaluate
// expressions in workflow settings, so the "={{ $env.PW_ERROR_WORKFLOW_ID }}"
// the build emits never resolves — the error workflow simply never fires, with
// no warning anywhere. Resolve it here, by name, like the credentials.

const ERROR_WORKFLOW_NAME = 'PlacidWay - Error Handler';
const errorWorkflow = (
  await all('SELECT id, name FROM workflow_entity WHERE name = ?', [ERROR_WORKFLOW_NAME])
)[0];

if (errorWorkflow) {
  console.log(`error workflow: ${errorWorkflow.id}  ${errorWorkflow.name}\n`);
} else {
  console.log(`error workflow: not found (expected one named "${ERROR_WORKFLOW_NAME}")\n`);
}

// --- rewrite each workflow's credential references -------------------------

let linked = 0;
let unresolved = 0;
let touched = 0;

for (const w of await all("SELECT id, name, nodes, settings FROM workflow_entity WHERE name LIKE 'PlacidWay%'")) {
  const nodes = typeof w.nodes === 'string' ? JSON.parse(w.nodes) : w.nodes;
  const settings = w.settings
    ? (typeof w.settings === 'string' ? JSON.parse(w.settings) : w.settings)
    : {};
  let changed = false;
  let settingsChanged = false;

  console.log(`${w.name}  (${w.id})`);

  // The error handler must not point at itself.
  if (errorWorkflow && w.id !== errorWorkflow.id) {
    if (settings.errorWorkflow !== errorWorkflow.id) {
      console.log(`  link  ${'(settings.errorWorkflow)'.padEnd(24)} ${settings.errorWorkflow || '(unset)'} -> ${errorWorkflow.id}`);
      settings.errorWorkflow = errorWorkflow.id;
      settingsChanged = true;
      linked += 1;
    } else {
      console.log(`  ok    ${'(settings.errorWorkflow)'.padEnd(24)} already linked`);
    }
  }

  for (const node of nodes) {
    if (!node.credentials) continue;

    for (const [type, ref] of Object.entries(node.credentials)) {
      const match = byKey.get(`${type}::${ref.name}`);

      if (!match) {
        console.log(`  --    ${node.name.padEnd(24)} ${type.padEnd(18)} no credential named "${ref.name}"`);
        unresolved += 1;
        continue;
      }
      if (ref.id === match.id) {
        console.log(`  ok    ${node.name.padEnd(24)} already linked`);
        continue;
      }

      console.log(`  link  ${node.name.padEnd(24)} ${ref.id} -> ${match.id}`);
      ref.id = match.id;
      changed = true;
      linked += 1;
    }
  }

  if ((changed || settingsChanged) && !DRY_RUN) {
    await run('UPDATE workflow_entity SET nodes = ?, settings = ?, updatedAt = ? WHERE id = ?', [
      JSON.stringify(nodes),
      JSON.stringify(settings),
      new Date().toISOString().replace('T', ' ').replace('Z', ''),
      w.id,
    ]);
    touched += 1;
  }
  console.log('');
}

db.close();

console.log(`${linked} reference(s) linked, ${unresolved} unresolved${DRY_RUN ? ' (dry run, nothing written)' : `, ${touched} workflow(s) updated`}`);

if (unresolved > 0) {
  console.log('');
  console.log('Unresolved references are nodes whose credential has not been created yet.');
  console.log('That is expected for Post To Facebook until you set up the Page token.');
  console.log('Create the credential with the exact name shown above, then re-run this.');
}
