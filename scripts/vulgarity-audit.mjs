#!/usr/bin/env node
// Vulgarity audit for blame.today (issue #22).
//
// The content filter (src/lib/filter.ts) is word-level (obscenity lib), so phrase-level vulgarity
// where no single word is profane slips onto the board (e.g. "fingering the dog"). This sweep pulls
// the top blame targets by votes, asks mtok.market which of the *currently displayed* ones are genuinely
// vulgar, and turns the flagged strings into literal blocklist entries. The model judges WHAT is
// vulgar; this code decides HOW to block it (dumb literals, never LLM-authored regexes).
//
//     hush exec -- node scripts/vulgarity-audit.mjs             # local (key from .hush)
//     MTOK_EVM_PRIVATE_KEY=... node scripts/vulgarity-audit.mjs # CI
//
// Env: MTOK_EVM_PRIVATE_KEY (mtok buyer=seller self-deal key) + GEMINI_API_KEY (fallback when mtok
// can't complete). TOP_N (default 200), MTOK_MODELS (comma-sep mix), MTOK_MODEL (single-model override).
// Needs Node 24+ (the helper imports the .ts filter via type stripping).
//
// Exit codes: 0 = ran clean, incl. the collateral guard holding a patch back (a safety no-op, not a
// failure — see $has_changes for whether anything was written), 3 = npm test failed, 1 = error.
// Writes has_changes=1 and a summary to $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY when a patch is staged.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let ROOT = process.cwd();
try {
  if (import.meta.url.startsWith('file:')) ROOT = fileURLToPath(new URL('..', import.meta.url));
} catch {}
const FILTER_TS = join(ROOT, 'src/lib/filter.ts');
const AUDIT_TEST = join(ROOT, 'tests/audit.test.ts');
const TOP_N = Number(process.env.TOP_N || 200);
const MTOK_API_BASE = process.env.MTOK_API_BASE || 'https://mtok.market/api';
const MTOK_MODEL = process.env.MTOK_MODEL || '@cf/mistralai/mistral-small-3.1-24b-instruct';
// The "mix": mtok fronts a spread of Cloudflare Workers-AI models. We cycle them across chunks so no
// single model owns the whole judgment (and it dogfoods mtok's variety). mistral-small stays first so
// a single-chunk run uses the proven default. Override with MTOK_MODELS=a,b,c. MTOK_MODEL still works
// as a one-model override (it takes precedence over the mix when set explicitly).
const MTOK_MODELS = (process.env.MTOK_MODELS || [
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);
// Gemini fallback: when mtok can't complete a judgment (wallet unfunded, market down, a bad model id),
// the audit still needs to run, so it falls back to gemini. Key is the blame gemini key (see .hush).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MTOK_SELLER_ID = process.env.MTOK_SELLER_ID || 'agt_4kq6eypt';
const MTOK_BUYER_AGENT_ID = process.env.MTOK_BUYER_AGENT_ID || MTOK_SELLER_ID;
const MTOK_MAX_PRICE = Number(process.env.MTOK_MAX_PRICE || 2.5);
const MTOK_CHUNK_SIZE = Number(process.env.MTOK_CHUNK_SIZE || 60);
const MTOK_CHUNK_BUDGET_USD = Number(process.env.MTOK_CHUNK_BUDGET_USD || process.env.MTOK_BUDGET_USD || 0.006);
const MTOK_EXPECTED_WALLET = (process.env.MTOK_EXPECTED_WALLET || '0x3c1F928B7e685c84661A4296E2333FeDB9e1d06e').toLowerCase();

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social', 'wss://nostr.mom', 'wss://relay.nostr.net'];
const TAG = 'pureblameapp';
const WAIT_MS = 8000;
const TODAY = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD (local); good enough for a label

const die = (msg) => { console.error(`vulgarity-audit: ${msg}`); process.exit(1); };

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

// --- mtok: which displayed labels are genuinely vulgar --------------------------------------------

export function buildJudgePrompt(labels) {
  const numbered = labels.map((l, i) => `${i}. ${l}`).join('\n');
  return `You moderate a public "blame board" where people post a short thing to blame (a gripe). It's an edgy, anonymous board, so most things stay, but we keep it free of sexual content. The JSON key is named "vulgar" for legacy reasons, but your job is sexual-content detection only. If an entry is not clearly sexual, leave it out.

FLAG an entry if the ENTRY TEXT ITSELF is sexually explicit OR is a sexual reference / innuendo / crude slang for sex, genitalia, or sex acts (e.g. "Boom Boom", "Donkey Boy", a sex-pun on a name). Judge only the words in the entry, never what they are associated with.

Do NOT flag (these STAY):
- plain names or affectionate terms with no sexual read ("Mommy", "Daddy", "your mom", "Grandma")
- gross-out or scatological gripes ("vomiting", "poop", "farts", "gas pains")
- mere profanity or insults ("damn", "idiots", "assholes")
- anything political, edgy, professional, or offensive-but-not-sexual ("the divorce lawyer", "my landlord")
- THE NAME OF A REAL PERSON, on its own, is NEVER sexual, even if that person is associated with sex crimes, scandals, or affairs (e.g. "Epstein", "Weinstein", "Gwyneth Paltrow", any politician or celebrity). A name is not a description of a sex act. Only flag a name if the entry adds its own explicit sexual words.
Do not flag politics, voters, parties, presidents, crime, disease, public figures, or controversial opinions unless the entry's own words are clearly sexual. If unsure, do NOT flag it.

Here are the entries:
${numbered}

Return JSON only, with this exact shape: {"vulgar":[0,3]}. Each number must be an index from the list. Do not include the entry text. If none qualify, return {"vulgar":[]}.`;
}

export function parseJudgeResponse(text, labels) {
  const trimmed = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('mtok seller returned unparseable JSON'); }
  if (!Array.isArray(parsed.vulgar)) throw new Error('mtok seller JSON is missing vulgar[]');
  const exact = new Set();
  const indexes = new Set();
  for (const item of parsed.vulgar) {
    if (Number.isInteger(item) && item >= 0 && item < labels.length) {
      indexes.add(item);
      continue;
    }
    const s = String(item).trim();
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (n >= 0 && n < labels.length) indexes.add(n);
      continue;
    }
    const numbered = s.match(/^(\d+)\.\s*(.+)$/);
    if (numbered) {
      const n = Number(numbered[1]);
      if (n >= 0 && n < labels.length && labels[n] === numbered[2].trim()) indexes.add(n);
      continue;
    }
    exact.add(s);
  }
  // Keep only labels that are actually in our input (guard against invented/paraphrased strings).
  return labels.filter((l, i) => indexes.has(i) || exact.has(l));
}

const chunksOf = (items, size) => {
  const n = Math.max(1, Number(size) || items.length || 1);
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
};

export function mtokConfigFromEnv(env = process.env) {
  const rawKey = env.MTOK_EVM_PRIVATE_KEY;
  if (rawKey) {
    return {
      method: 'create',
      opts: {
        apiBase: env.MTOK_API_BASE || MTOK_API_BASE,
        chainId: 8453,
        evmPrivateKey: '0x' + String(rawKey).replace(/^0x/, ''),
        agentId: env.MTOK_BUYER_AGENT_ID || MTOK_BUYER_AGENT_ID,
      },
    };
  }

  const raw = env.MTOK_IDENTITY_JSON;
  if (!raw) {
    throw new Error('MTOK_EVM_PRIVATE_KEY or MTOK_IDENTITY_JSON is not set (put it in .hush and run via `hush exec`, or export it)');
  }
  try {
    const identity = JSON.parse(raw);
    if (!identity || typeof identity !== 'object') throw new Error('not an object');
    return {
      method: 'fromIdentity',
      identity,
      opts: { apiBase: env.MTOK_API_BASE || MTOK_API_BASE, chainId: 8453 },
    };
  } catch {
    throw new Error('MTOK_IDENTITY_JSON must be a JSON mtok identity');
  }
}

// A misconfiguration we must NOT paper over by silently falling back (e.g. the buyer key derives the
// wrong wallet — refuse to spend, don't quietly switch models). judge() re-throws these.
class MtokFatalError extends Error {}

// mtok path: cycle the model mix across chunks. Throws on any buy failure (funding, market down, bad
// model) so judge() can fall back to gemini; throws MtokFatalError on a wallet mismatch (no fallback).
async function judgeViaMtok(labels, { env = process.env, importMtok = () => import('mtok-sdk') } = {}) {
  const { Mtok } = await importMtok();
  const cfg = mtokConfigFromEnv(env);
  const mtok = cfg.method === 'create'
    ? await Mtok.create(cfg.opts)
    : await Mtok.fromIdentity(cfg.identity, cfg.opts);
  const wallet = String(mtok.identity?.address || mtok.account?.address || '').toLowerCase();
  const expectedWallet = String(env.MTOK_EXPECTED_WALLET || MTOK_EXPECTED_WALLET).toLowerCase();
  if (wallet !== expectedWallet) throw new MtokFatalError(`mtok buyer wallet ${wallet || '(missing)'} does not match expected house seller wallet`);

  // MTOK_MODEL (single) overrides the mix if set; else cycle MTOK_MODELS across chunks.
  const models = env.MTOK_MODEL ? [env.MTOK_MODEL] : (env.MTOK_MODELS ? env.MTOK_MODELS.split(',').map((s) => s.trim()).filter(Boolean) : MTOK_MODELS);
  const chunks = chunksOf(labels, Number(env.MTOK_CHUNK_SIZE || MTOK_CHUNK_SIZE));
  const flagged = new Set();
  for (let i = 0; i < chunks.length; i++) {
    const model = models[i % models.length];
    const result = await mtok.buy({
      model,
      sellerId: env.MTOK_SELLER_ID || MTOK_SELLER_ID,
      maxPrice: Number(env.MTOK_MAX_PRICE || MTOK_MAX_PRICE),
      budget: Number(env.MTOK_CHUNK_BUDGET_USD || env.MTOK_BUDGET_USD || MTOK_CHUNK_BUDGET_USD),
      requests: [{
        model,
        temperature: 0,
        max_tokens: 384,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildJudgePrompt(chunks[i]) }],
      }],
    });
    if (result.status !== 'ok') throw new Error(`mtok buy failed: ${result.status}`);
    const text = result.completions?.[0]?.choices?.[0]?.message?.content;
    for (const label of parseJudgeResponse(text, chunks[i])) flagged.add(label);
  }
  return labels.filter((label) => flagged.has(label));
}

// Gemini fallback: same prompt + parser, structured JSON, retry transient 429/500/503 with backoff.
async function judgeViaGemini(labels, { env = process.env, fetchImpl = fetch } = {}) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set (needed for the gemini fallback)');
  const model = env.GEMINI_MODEL || GEMINI_MODEL;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flagged = new Set();
  for (const chunk of chunksOf(labels, Number(env.GEMINI_CHUNK_SIZE || 120))) {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: buildJudgePrompt(chunk) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: { type: 'object', properties: { vulgar: { type: 'array', items: { type: 'integer' } } }, required: ['vulgar'] },
      },
    });
    let res;
    for (let attempt = 1; ; attempt++) {
      res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body,
      });
      if (res.ok) break;
      const transient = res.status === 429 || res.status === 500 || res.status === 503;
      if (!transient || attempt >= 5) throw new Error(`gemini ${res.status} after ${attempt} attempt(s): ${(await res.text()).slice(0, 200)}`);
      await sleep(2000 * 2 ** (attempt - 1));
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    for (const label of parseJudgeResponse(text, chunk)) flagged.add(label);
  }
  return labels.filter((label) => flagged.has(label));
}

export async function judge(labels, opts = {}) {
  const env = opts.env || process.env;
  // Dry-run hook: AUDIT_MOCK_FLAGGED="label one||label two" flags those (if present) without any
  // model call, so the patch/guard/test path can be exercised locally against live data for free.
  if (env.AUDIT_MOCK_FLAGGED) {
    const mock = new Set(env.AUDIT_MOCK_FLAGGED.split('||').map((s) => s.trim()));
    return labels.filter((l) => mock.has(l));
  }
  if (env.AUDIT_FORCE_GEMINI) return judgeViaGemini(labels, opts); // testing / mtok-down override
  try {
    return await judgeViaMtok(labels, opts);
  } catch (e) {
    if (e instanceof MtokFatalError) throw e; // wallet mismatch etc — refuse to proceed, don't fall back
    console.error(`vulgarity-audit: mtok unavailable (${e.message}); falling back to gemini`);
    return judgeViaGemini(labels, opts);
  }
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
    writeFileSync(AUDIT_TEST, `import { describe, it, expect } from 'vitest';\nimport { checkContent } from '$lib/filter';\n\n// Auto-maintained by scripts/vulgarity-audit.mjs (issue #22). Each run appends the entries mtok\n// flagged that day, as a standing regression that they stay blocked. Do not hand-edit.\ndescribe('audited vulgar blocklist', () => {${block}});\n`);
  }
}

// --- main -----------------------------------------------------------------------------------------

async function main() {
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

  console.log(`vulgarity-audit: judging ${passing.length} displayed entries via mtok.market (model mix, gemini fallback)...`);
  const flagged = await judge(passing.map((t) => t.label));
  if (!flagged.length) { summary(`### vulgarity audit\nchecked ${passing.length} displayed entries. **0 flagged.** clean. :)`); out('has_changes', '0'); process.exit(0); }
  console.log(`vulgarity-audit: mtok flagged ${flagged.length}: ${JSON.stringify(flagged)}`);

  // Patch, then re-check the WHOLE top-N with the patched filter (fresh process).
  const wrote = patchFilter(flagged);
  if (!wrote) { summary(`### vulgarity audit\nmtok flagged ${flagged.length} but all are already covered. clean.`); out('has_changes', '0'); process.exit(0); }
  appendTest(flagged);

  const after = evalFilter(topN.map((t) => t.label));
  const newlyBlocked = topN.filter((t, i) => before[i] === null && after[i] !== null).map((t) => t.label);
  const flaggedSet = new Set(flagged);
  const collateral = newlyBlocked.filter((l) => !flaggedSet.has(l)); // blocked now, but the model did NOT flag it
  const missed = flagged.filter((l) => !newlyBlocked.includes(l)); // flagged but patch failed to block it

  if (collateral.length) {
    // The patch would hide real entries, so the guard refuses to write. This is the guard WORKING, not
    // an error, so it's a clean no-op (exit 0) — it fired nightly on the recurring "Trump" false flag
    // (a short literal that also matches unrelated Trump targets) and turned every such run red. The
    // guard already prevented the bad write; a red job on top is just noise. Nothing is committed.
    revert();
    summary(`### vulgarity audit\ncollateral guard held a patch back (a flagged literal would also hide **${collateral.length}** un-flagged live target(s)):\n\n${collateral.map((l) => '- `' + l + '`').join('\n')}\n\nnothing written, no change. (usually a model false-flag on a short/common token.)`);
    out('has_changes', '0');
    process.exit(0);
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

  summary(`### vulgarity audit\nblocked **${flagged.length}** vulgar entr${flagged.length === 1 ? 'y' : 'ies'}, **0** collateral over ${topN.length} live targets:\n\n${flagged.map((l) => '- `' + l + '`').join('\n')}\n\ntests green. committing to main.`);
  // Body for the issue-#22 trail (the workflow appends the commit sha + run link, then posts it).
  writeFileSync(join(ROOT, 'audit-comment.md'),
    `nightly vulgarity audit blocked ${flagged.length} entr${flagged.length === 1 ? 'y' : 'ies'} (collateral guard clean over ${topN.length} live targets, tests green):\n\n${flagged.map((l) => '- `' + l + '`').join('\n')}\n`);
  out('has_changes', '1');
  out('flagged_count', String(flagged.length));
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => die(err?.message || String(err)));
}
