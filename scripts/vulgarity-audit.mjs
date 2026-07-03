#!/usr/bin/env node
// Vulgarity audit for blame.today (issue #22).
//
// The content filter (src/lib/filter.ts) is word-level (obscenity lib), so phrase-level vulgarity
// where no single word is profane slips onto the board (e.g. "fingering the dog"). This sweep pulls
// the top blame targets by votes, asks gemini which of the *currently displayed* ones are genuinely
// vulgar, and turns the flagged strings into literal blocklist entries. The model judges WHAT is
// vulgar; this code decides HOW to block it (dumb literals, never LLM-authored regexes).
//
//     hush exec -- node scripts/vulgarity-audit.mjs        # local (key from .hush)
//     GEMINI_API_KEY=... node scripts/vulgarity-audit.mjs  # CI
//
// Env: GEMINI_API_KEY (required), TOP_N (default 200), GEMINI_MODEL (default gemini-2.0-flash).
// Needs Node 24+ (the helper imports the .ts filter via type stripping).
//
// Exit codes: 0 = ran clean (may or may not have patched, see $has_changes), 2 = collateral guard
// tripped (a patch would over-block real entries, nothing written), 3 = npm test failed, 1 = error.
// Writes has_changes=1 and a summary to $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY when a patch is staged.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILTER_TS = join(ROOT, 'src/lib/filter.ts');
const AUDIT_TEST = join(ROOT, 'tests/audit.test.ts');
const TOP_N = Number(process.env.TOP_N || 200);
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const KEY = process.env.GEMINI_API_KEY;

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social', 'wss://nostr.mom', 'wss://relay.nostr.net'];
const TAG = 'pureblameapp';
const WAIT_MS = 8000;
const TODAY = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD (local); good enough for a label

const die = (msg) => { console.error(`vulgarity-audit: ${msg}`); process.exit(1); };
if (!KEY && !process.env.AUDIT_MOCK_FLAGGED) die('GEMINI_API_KEY is not set (put it in .hush and run via `hush exec`, or export it)');

// Undo a staged patch: filter.ts is always tracked (restore it); audit.test.ts might be brand new
// on the first-ever run (remove it) or pre-existing (restore it). Captured before we touch anything.
const testExisted = existsSync(AUDIT_TEST);
function revert() {
  try { execFileSync('git', ['checkout', '--', 'src/lib/filter.ts'], { cwd: ROOT }); } catch {}
  if (testExisted) { try { execFileSync('git', ['checkout', '--', 'tests/audit.test.ts'], { cwd: ROOT }); } catch {} }
  else { try { rmSync(AUDIT_TEST); } catch {} }
}

// --- nostr: pull targets, then COUNT their votes, keep the top N -----------------------------------

function withRelay(url, onOpen, onMessage) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(url); } catch { return resolve(); }
    const finish = () => { try { ws.close(); } catch {} resolve(); };
    const timer = setTimeout(finish, WAIT_MS);
    ws.onopen = () => onOpen(ws);
    ws.onmessage = (m) => { let p; try { p = JSON.parse(m.data.toString()); } catch { return; } onMessage(p, ws, () => { clearTimeout(timer); finish(); }); };
    ws.onerror = () => { clearTimeout(timer); finish(); };
  });
}

async function fetchTargets() {
  const targets = new Map(); // id -> label
  await Promise.all(RELAYS.map((url) => withRelay(url,
    (ws) => ws.send(JSON.stringify(['REQ', 't', { kinds: [1], '#t': [TAG], limit: 1000 }])),
    (p, ws, done) => {
      if (p[0] === 'EVENT' && p[1] === 't' && p[2]?.id) { if (!targets.has(p[2].id)) targets.set(p[2].id, (p[2].content || '').trim()); }
      else if (p[0] === 'EOSE' && p[1] === 't') done();
    })));
  return [...targets].filter(([, label]) => label).map(([id, label]) => ({ id, label }));
}

async function countVotes(targets) {
  const counts = new Map(); // id -> max count across relays
  const subToId = new Map();
  await Promise.all(RELAYS.map((url) => withRelay(url,
    (ws) => targets.forEach((t, i) => { const sub = 'c' + i; subToId.set(sub, t.id); ws.send(JSON.stringify(['COUNT', sub, { kinds: [7], '#e': [t.id] }])); }),
    (p) => {
      if (p[0] === 'COUNT' && subToId.has(p[1])) {
        const id = subToId.get(p[1]);
        const n = Number(p[2]?.count || 0);
        if (n > (counts.get(id) || 0)) counts.set(id, n);
      }
    })));
  return counts;
}

// --- filter eval (fresh process, before + after patch) --------------------------------------------

function evalFilter(labels) {
  const tmp = join(mkdtempSync(join(tmpdir(), 'audit-')), 'labels.json');
  writeFileSync(tmp, JSON.stringify(labels));
  const out = execFileSync('node', [join(ROOT, 'scripts/_filter-eval.mjs'), tmp], { encoding: 'utf8', cwd: ROOT });
  return JSON.parse(out); // array of (null | reason), same order as labels
}

// --- gemini: which displayed labels are genuinely vulgar ------------------------------------------

async function judge(labels) {
  // Dry-run hook: AUDIT_MOCK_FLAGGED="label one||label two" flags those (if present) without calling
  // gemini, so the patch/guard/test path can be exercised locally against live data for free.
  if (process.env.AUDIT_MOCK_FLAGGED) {
    const mock = new Set(process.env.AUDIT_MOCK_FLAGGED.split('||').map((s) => s.trim()));
    return labels.filter((l) => mock.has(l));
  }
  const numbered = labels.map((l, i) => `${i}. ${l}`).join('\n');
  const prompt = `You moderate a public "blame board" where people post a short thing to blame (a gripe). It's an edgy, anonymous board, so most things stay, but we keep it free of sexual content. Lean toward removing anything with a clear sexual read.

FLAG an entry if it is sexually explicit OR a sexual reference / innuendo / crude slang for sex, genitalia, or sex acts (e.g. "Boom Boom", "Donkey Boy", a sex-pun on a name). If a normal person would read it as "that's a sex thing", flag it.

Do NOT flag (these STAY):
- plain names or affectionate terms with no sexual read ("Mommy", "Daddy", "your mom", "Grandma")
- gross-out or scatological gripes ("vomiting", "poop", "farts")
- mere profanity or insults ("damn", "idiots", "assholes")
- anything political, edgy, or offensive-but-not-sexual
Being a bit overzealous on the sexual stuff is fine; the one line you must not cross is flagging a plainly innocent name or a non-sexual gripe.

Here are the entries:
${numbered}

Return only the entries that meet the FLAG bar, verbatim, exactly as written above (copy the text after the number). If none qualify, return an empty list.`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { vulgar: { type: 'array', items: { type: 'string' } } }, required: ['vulgar'] },
    },
  });
  // Retry transient gemini errors (429 rate limit, 500/503 overload) with backoff — this runs
  // unattended, so a Google hiccup shouldn't fail the sweep. 400/401/403 are real, so die at once.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body,
    });
    if (res.ok) break;
    const transient = res.status === 429 || res.status === 500 || res.status === 503;
    if (!transient || attempt >= 5) die(`gemini ${res.status} after ${attempt} attempt(s): ${(await res.text()).slice(0, 300)}`);
    const wait = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s, 16s
    console.error(`vulgarity-audit: gemini ${res.status} (transient), retry ${attempt}/4 in ${wait / 1000}s...`);
    await sleep(wait);
  }
  const data = await res.json();
  let parsed;
  try { parsed = JSON.parse(data.candidates[0].content.parts[0].text); } catch { die('gemini returned unparseable JSON'); }
  const set = new Set((parsed.vulgar || []).map((s) => String(s).trim()));
  // Keep only strings that are actually in our input (guard against the model inventing / paraphrasing).
  return labels.filter((l) => set.has(l));
}

// --- patch: append literal blocklist entries between the audit markers ----------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function patchFilter(flagged) {
  let src = readFileSync(FILTER_TS, 'utf8');
  const end = '  // audit:end';
  if (!src.includes('// audit:begin') || !src.includes(end)) die('audit markers missing from filter.ts');
  const existing = src.slice(src.indexOf('// audit:begin'), src.indexOf('// audit:end'));
  // one dumb, exact literal per flagged label; skip any whose literal is already between the markers.
  const lines = flagged
    .map((l) => ({ token: `/${escapeRe(l)}/i,`, l }))
    .filter(({ token }) => !existing.includes(token))
    .map(({ token }) => `  ${token} // audited ${TODAY}`);
  if (!lines.length) return false;
  src = src.replace(end, lines.join('\n') + '\n' + end);
  writeFileSync(FILTER_TS, src);
  return true;
}

function appendTest(flagged) {
  const arr = JSON.stringify(flagged);
  const block = `\n  it('audit ${TODAY}: blocks the flagged vulgar entries', () => {\n    for (const t of ${arr}) {\n      expect(checkContent(t)).toBe('No bad words!');\n    }\n  });\n`;
  if (existsSync(AUDIT_TEST)) {
    let src = readFileSync(AUDIT_TEST, 'utf8');
    src = src.replace(/\n\}\);\s*$/, block + '});\n');
    writeFileSync(AUDIT_TEST, src);
  } else {
    writeFileSync(AUDIT_TEST, `import { describe, it, expect } from 'vitest';\nimport { checkContent } from '$lib/filter';\n\n// Auto-maintained by scripts/vulgarity-audit.mjs (issue #22). Each run appends the entries gemini\n// flagged that day, as a standing regression that they stay blocked. Do not hand-edit.\ndescribe('audited vulgar blocklist', () => {${block}});\n`);
  }
}

// --- main -----------------------------------------------------------------------------------------

const out = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const summary = (md) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); console.log(md.replace(/[#*`]/g, '')); };

console.log(`vulgarity-audit: pulling targets from ${RELAYS.length} relays...`);
const all = await fetchTargets();
console.log(`vulgarity-audit: ${all.length} targets, counting votes...`);
const counts = await countVotes(all);
const topN = all
  .map((t) => ({ ...t, votes: counts.get(t.id) || 0 }))
  .sort((a, b) => b.votes - a.votes)
  .slice(0, TOP_N);
console.log(`vulgarity-audit: top ${topN.length} by votes (max ${topN[0]?.votes ?? 0}).`);

// Only entries that currently PASS the filter can be on the board; those are what we audit.
const before = evalFilter(topN.map((t) => t.label));
const passing = topN.filter((_, i) => before[i] === null);
console.log(`vulgarity-audit: ${passing.length} of top ${topN.length} currently pass the filter (displayed).`);
if (!passing.length) { summary('### vulgarity audit\nnothing displayed to audit. clean.'); out('has_changes', '0'); process.exit(0); }

console.log(`vulgarity-audit: asking ${MODEL} to judge ${passing.length} displayed entries...`);
const flagged = await judge(passing.map((t) => t.label));
if (!flagged.length) { summary(`### vulgarity audit\nchecked ${passing.length} displayed entries. **0 flagged.** clean. :)`); out('has_changes', '0'); process.exit(0); }
console.log(`vulgarity-audit: gemini flagged ${flagged.length}: ${JSON.stringify(flagged)}`);

// Patch, then re-check the WHOLE top-N with the patched filter (fresh process).
const wrote = patchFilter(flagged);
if (!wrote) { summary(`### vulgarity audit\ngemini flagged ${flagged.length} but all are already covered. clean.`); out('has_changes', '0'); process.exit(0); }
appendTest(flagged);

const after = evalFilter(topN.map((t) => t.label));
const newlyBlocked = topN.filter((t, i) => before[i] === null && after[i] !== null).map((t) => t.label);
const flaggedSet = new Set(flagged);
const collateral = newlyBlocked.filter((l) => !flaggedSet.has(l)); // blocked now, but the model did NOT flag it
const missed = flagged.filter((l) => !newlyBlocked.includes(l)); // flagged but patch failed to block it

if (collateral.length) {
  // The patch would hide real entries. Revert everything and refuse to open a PR.
  revert();
  summary(`### vulgarity audit :warning:\ncollateral guard tripped. the patch would also hide **${collateral.length}** entries gemini did NOT flag:\n\n${collateral.map((l) => '- `' + l + '`').join('\n')}\n\nnothing written. needs a human.`);
  out('has_changes', '0');
  process.exit(2);
}
if (missed.length) console.error(`vulgarity-audit: WARN ${missed.length} flagged not blocked by patch: ${JSON.stringify(missed)}`);

console.log('vulgarity-audit: collateral guard clean. running npm test...');
try {
  execFileSync('npm', ['test'], { cwd: ROOT, stdio: 'inherit' });
} catch {
  revert();
  summary('### vulgarity audit :warning:\n`npm test` failed after patching. reverted. needs a human.');
  out('has_changes', '0');
  process.exit(3);
}

summary(`### vulgarity audit\nblocked **${flagged.length}** vulgar entr${flagged.length === 1 ? 'y' : 'ies'}, **0** collateral over ${topN.length} live targets:\n\n${flagged.map((l) => '- `' + l + '`').join('\n')}\n\ntests green. staged for a PR.`);
out('has_changes', '1');
out('flagged_count', String(flagged.length));
process.exit(0);
