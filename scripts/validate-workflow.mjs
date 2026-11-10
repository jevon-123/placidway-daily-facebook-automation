/**
 * Static checks on a built workflow, so import-time surprises surface here
 * instead of in the n8n UI.
 *
 * What this can prove:
 *   - the JSON is well formed and every node is addressable
 *   - every connection points at a node that exists
 *   - every node is reachable from a trigger (no orphans)
 *   - every Code node's JavaScript actually parses
 *   - every $('Node Name') reference names a real node   <- the common one
 *   - every n8n expression has balanced {{ }}
 *
 * What it cannot prove: that credential-bound parameters (the Google Sheets
 * document/sheet pickers in particular) resolve on your instance. Confirm
 * those in the UI after import — see README, "Import and wire credentials".
 *
 *   node scripts/validate-workflow.mjs [path ...]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(join(root, 'workflow'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(root, 'workflow', f));

const TRIGGER_TYPES = new Set([
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.errorTrigger',
  'n8n-nodes-base.webhook',
]);

let totalProblems = 0;

for (const path of targets) {
  console.log(`\n=== ${path.replace(root + '\\', '').replace(root + '/', '')} ===`);
  const problems = [];
  const note = (m) => problems.push(m);

  let wf;
  try {
    wf = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.log(`  FATAL  not valid JSON: ${err.message}`);
    totalProblems += 1;
    continue;
  }

  const nodes = wf.nodes || [];
  const names = new Set(nodes.map((n) => n.name));

  // --- identity ------------------------------------------------------------
  const seenNames = new Set();
  const seenIds = new Set();
  for (const n of nodes) {
    if (seenNames.has(n.name)) note(`duplicate node name: "${n.name}"`);
    seenNames.add(n.name);
    if (n.id) {
      if (seenIds.has(n.id)) note(`duplicate node id: "${n.id}" (${n.name})`);
      seenIds.add(n.id);
    }
    if (!n.type) note(`node "${n.name}" has no type`);
    if (n.typeVersion == null) note(`node "${n.name}" has no typeVersion`);
    if (!Array.isArray(n.position) || n.position.length !== 2) note(`node "${n.name}" has a malformed position`);
  }

  // --- connections ---------------------------------------------------------
  for (const [from, spec] of Object.entries(wf.connections || {})) {
    if (!names.has(from)) note(`connection source "${from}" is not a node`);
    for (const branch of spec.main || []) {
      for (const link of branch || []) {
        if (!names.has(link.node)) note(`connection "${from}" -> "${link.node}" targets a node that does not exist`);
      }
    }
  }

  // --- reachability --------------------------------------------------------
  const triggers = nodes.filter((n) => TRIGGER_TYPES.has(n.type)).map((n) => n.name);
  if (triggers.length === 0) note('workflow has no trigger node');

  const reached = new Set(triggers);
  const queue = [...triggers];
  while (queue.length) {
    const current = queue.shift();
    for (const branch of (wf.connections[current] || {}).main || []) {
      for (const link of branch || []) {
        if (!reached.has(link.node)) {
          reached.add(link.node);
          queue.push(link.node);
        }
      }
    }
  }
  for (const n of nodes) {
    if (!reached.has(n.name)) note(`node "${n.name}" is unreachable from any trigger`);
  }

  // --- Code node JavaScript ------------------------------------------------
  let codeNodes = 0;
  for (const n of nodes) {
    if (n.type !== 'n8n-nodes-base.code') continue;
    codeNodes += 1;
    const js = (n.parameters || {}).jsCode || '';
    if (!js.trim()) {
      note(`Code node "${n.name}" is empty`);
      continue;
    }
    try {
      // Parse only — never executed. Catches the escaping mistakes that are
      // otherwise invisible until the node runs at 07:00.
      new Function(js);
    } catch (err) {
      note(`Code node "${n.name}" does not parse: ${err.message}`);
    }
    if (!/\breturn\b/.test(js)) note(`Code node "${n.name}" never returns anything`);

    for (const ref of js.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) {
      if (!names.has(ref[1])) note(`Code node "${n.name}" references $('${ref[1]}'), which is not a node`);
    }
  }

  // --- expressions ---------------------------------------------------------
  const walk = (value, trail) => {
    if (typeof value === 'string') {
      if (value.startsWith('=')) {
        const opens = (value.match(/\{\{/g) || []).length;
        const closes = (value.match(/\}\}/g) || []).length;
        if (opens !== closes) note(`unbalanced {{ }} in expression at ${trail}: ${value.slice(0, 80)}`);
        if (opens === 0) note(`expression at ${trail} starts with "=" but has no {{ }}: ${value.slice(0, 80)}`);
      }
      return;
    }
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${trail}[${i}]`));
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, `${trail}.${k}`);
    }
  };
  for (const n of nodes) walk(n.parameters, `${n.name}.parameters`);

  // --- report --------------------------------------------------------------
  console.log(`  nodes: ${nodes.length}   code nodes: ${codeNodes}   triggers: ${triggers.length}`);
  if (problems.length === 0) {
    console.log('  no structural problems found');
  } else {
    for (const p of problems) console.log(`  PROBLEM  ${p}`);
  }
  totalProblems += problems.length;
}

console.log(`\n${totalProblems} problem(s) across ${targets.length} workflow file(s)\n`);
process.exit(totalProblems === 0 ? 0 : 1);
