#!/usr/bin/env node
/* ==========================================================================
 * apply_layout.js -- write a God Mode layout export back into js/data.js
 *
 *   node tools/apply_layout.js layout_lbd1_2026-07-29T10-11-12.json
 *   node tools/apply_layout.js layout.json --dry-run
 *
 * The export identifies each element by its Unity fileID, which is the `"id"`
 * key of exactly one node object in data.js, so each asset is a single targeted
 * find-and-replace on that node's own `anchoredPosition` / `sizeDelta` /
 * `scale` / `rotZ` / `text`. Nothing else in the file is touched and no
 * reformatting happens -- data.js is one machine-generated line per global and
 * must stay that way.
 *
 * A .bak copy is written before the first edit, the result is re-parsed to prove
 * it is still valid JS, and every asset is reported as applied / unchanged /
 * NOT FOUND rather than being silently skipped.
 * ======================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'js', 'data.js');

function die(msg) {
  console.error('error: ' + msg);
  process.exit(1);
}

// ------------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const jsonPath = args.find((a) => !a.startsWith('--'));
if (!jsonPath) {
  console.log('usage: node tools/apply_layout.js <layout.json> [--dry-run]');
  process.exit(0);
}
if (!fs.existsSync(jsonPath)) die('layout file not found: ' + jsonPath);
if (!fs.existsSync(DATA)) die('js/data.js not found (run from the project root)');

let payload;
try {
  payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  die('layout file is not valid JSON: ' + e.message);
}
const assets = payload.assets || [];
if (!assets.length) die('layout file lists no assets');

let src = fs.readFileSync(DATA, 'utf8');
const before = src;

// ------------------------------------------------- locate one node by fileID
/**
 * Find the byte range of the node object whose `"id"` is `id`, by walking braces
 * from that key. Regex alone cannot do this safely: node objects nest, and
 * `anchoredPosition` appears on every one of them.
 */
function nodeRange(text, id) {
  const key = '{"id":"' + id + '"';
  const start = text.indexOf(key);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { start: start, end: i + 1 };
    }
  }
  return null;
}

/** Replace `"field":<array>` inside one node's own body, not a child's. */
function setArrayField(body, field, values) {
  const re = new RegExp('("' + field + '":)\\[[^\\]]*\\]');
  // the node's own field is the first occurrence, because a node serialises its
  // own rect fields before its "children" array
  if (!re.test(body)) return { body: body, changed: false, found: false };
  const next = body.replace(re, '$1[' + values.join(',') + ']');
  return { body: next, changed: next !== body, found: true };
}

function setNumberField(body, field, value) {
  const re = new RegExp('("' + field + '":)(-?[0-9.eE+]+)');
  if (!re.test(body)) return { body: body, changed: false, found: false };
  const next = body.replace(re, '$1' + value);
  return { body: next, changed: next !== body, found: true };
}

function setStringField(body, field, value) {
  const re = new RegExp('("' + field + '":)("(?:[^"\\\\]|\\\\.)*")');
  if (!re.test(body)) return { body: body, changed: false, found: false };
  const next = body.replace(re, '$1' + JSON.stringify(value));
  return { body: next, changed: next !== body, found: true };
}

// ---------------------------------------------------------------- apply pass
const rows = [];
let applied = 0;
let notFound = 0;

for (const a of assets) {
  const range = nodeRange(src, a.id);
  if (!range) {
    rows.push({ id: a.id, name: a.name, status: 'NOT FOUND IN data.js', detail: '' });
    notFound++;
    continue;
  }
  let body = src.slice(range.start, range.end);
  const changes = [];
  const missing = [];

  if (a.anchoredPosition) {
    const r = setArrayField(body, 'anchoredPosition', a.anchoredPosition);
    body = r.body;
    if (!r.found) missing.push('anchoredPosition');
    else if (r.changed) changes.push('anchoredPosition → [' + a.anchoredPosition.join(', ') + ']');
  }
  if (a.sizeDelta) {
    const r = setArrayField(body, 'sizeDelta', a.sizeDelta);
    body = r.body;
    if (!r.found) missing.push('sizeDelta');
    else if (r.changed) changes.push('sizeDelta → [' + a.sizeDelta.join(', ') + ']');
  }
  if (a.scale) {
    const v = [a.scale[0], a.scale[1], a.scale[2] == null ? 1 : a.scale[2]];
    const r = setArrayField(body, 'scale', v);
    body = r.body;
    if (r.changed) changes.push('scale → [' + v.join(', ') + ']');
  }
  if (a.rotZ != null) {
    const r = setNumberField(body, 'rotZ', a.rotZ);
    body = r.body;
    if (r.changed) changes.push('rotZ → ' + a.rotZ);
  }
  if (a.fontSize != null) {
    const r = setNumberField(body, 'fontSize', a.fontSize);
    body = r.body;
    if (r.changed) changes.push('fontSize → ' + a.fontSize);
  }
  if (a.text != null) {
    const r = setStringField(body, 'text', a.text);
    body = r.body;
    if (r.changed) changes.push('text → ' + JSON.stringify(a.text.slice(0, 40)));
  }

  if (missing.length) {
    rows.push({ id: a.id, name: a.name,
                status: 'FIELD MISSING: ' + missing.join(', '), detail: '' });
    notFound++;
    continue;
  }
  if (!changes.length) {
    rows.push({ id: a.id, name: a.name, status: 'unchanged', detail: '' });
    continue;
  }
  src = src.slice(0, range.start) + body + src.slice(range.end);
  rows.push({ id: a.id, name: a.name, status: 'applied', detail: changes.join('; ') });
  applied++;
}

// -------------------------------------------------------------------- report
const w = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);
console.log('');
console.log(w('id', 22) + w('name', 24) + w('status', 30) + 'change');
console.log('-'.repeat(110));
for (const r of rows) {
  console.log(w(r.id, 22) + w(r.name, 24) + w(r.status, 30) + r.detail);
}
console.log('-'.repeat(110));
console.log(applied + ' applied, ' + (rows.length - applied - notFound) +
  ' unchanged, ' + notFound + ' not found');

if (notFound) {
  console.log('\nnot-found rows are reported, never skipped silently: check that the ' +
    'layout JSON came from this build of data.js.');
}

// --------------------------------------------------------------------- write
if (dryRun) {
  console.log('\n--dry-run: js/data.js was not modified.');
  process.exit(notFound ? 1 : 0);
}
if (src === before) {
  console.log('\nnothing to write.');
  process.exit(notFound ? 1 : 0);
}

// prove the edited file still parses before it replaces the original
try {
  new Function(src.replace(/^'use strict';/m, ''));
} catch (e) {
  die('the patched data.js does not parse (' + e.message + ') — original left intact');
}

const bak = DATA + '.bak';
if (!fs.existsSync(bak)) fs.writeFileSync(bak, before, 'utf8');
fs.writeFileSync(DATA, src, 'utf8');
console.log('\nwrote js/data.js  (backup at js/data.js.bak)');

// re-read through the real loader as a final guard
try {
  const sandbox = { window: {} };
  new Function('window', fs.readFileSync(DATA, 'utf8'))(sandbox.window);
  const n = (sandbox.window.LAYOUT || []).length + (sandbox.window.SPLASH_LAYOUT || []).length;
  console.log('verified: data.js loads, ' + n + ' layout root(s) present');
} catch (e) {
  console.error('warning: data.js loaded but threw: ' + e.message);
  process.exit(1);
}
process.exit(notFound ? 1 : 0);
