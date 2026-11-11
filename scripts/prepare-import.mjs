/**
 * Writes a copy of a workflow file with an `id` injected, so that
 * `n8n import:workflow` updates the existing workflow instead of creating a
 * duplicate.
 *
 * The built JSON in workflow/ deliberately carries no `id`: those are assigned
 * by whichever n8n instance you import into, so committing one would be
 * meaningless on anyone else's machine. setup/import-workflows.ps1 looks up the
 * id by workflow name at import time and passes it here.
 *
 *   node scripts/prepare-import.mjs --file=<in.json> --out=<out.json> [--id=<workflowId>]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

if (!args.file || !args.out) {
  console.error('Usage: node scripts/prepare-import.mjs --file=<in.json> --out=<out.json> [--id=<workflowId>]');
  process.exit(1);
}

const workflow = JSON.parse(readFileSync(args.file, 'utf8'));

if (args.id) {
  workflow.id = String(args.id);
} else {
  delete workflow.id;
}

writeFileSync(args.out, JSON.stringify(workflow, null, 2), 'utf8');
console.log(`${workflow.name} -> ${args.id ? `updating ${args.id}` : 'creating new'}`);
