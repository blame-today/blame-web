#!/usr/bin/env node
// Rough hit counter for blame.today.
//
// We publish a "hit" ping to nostr on every page load (kind 1, tagged 'pureblameapphit',
// see src/lib/nostr.ts -> publishHit). This pulls those pings back from the relays,
// dedups them by event id, and buckets them by day / week / month in Eastern time.
//
//     node scripts/hits.mjs
//
// Rough by design: it counts page LOADS, not unique visitors (no per-person dedup, fires on
// every refresh), and each relay caps how many events it returns per request (LIMIT below),
// which is fine while volume is low. If it ever caps out we switch to windowed COUNT queries.
//
// Needs Node 22+ (uses the built-in global WebSocket).

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
];
const HIT_TAG = 'pureblameapphit';
const LIMIT = 5000;
const WAIT_MS = 7000;
const TZ = 'America/New_York';

const seen = new Map(); // event id -> created_at (unix seconds), deduped across relays

function pull(url) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      return resolve();
    }
    const finish = () => {
      try { ws.close(); } catch {}
      resolve();
    };
    const timer = setTimeout(finish, WAIT_MS);
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'h', { kinds: [1], '#t': [HIT_TAG], limit: LIMIT }]));
    ws.onmessage = (m) => {
      let p;
      try { p = JSON.parse(m.data.toString()); } catch { return; }
      if (p[0] === 'EVENT' && p[1] === 'h' && p[2] && p[2].id) {
        if (!seen.has(p[2].id)) seen.set(p[2].id, p[2].created_at);
      } else if (p[0] === 'EOSE' && p[1] === 'h') {
        clearTimeout(timer);
        finish();
      }
    };
    ws.onerror = () => { clearTimeout(timer); finish(); };
  });
}

// --- bucketing, all in ET ---
const dayKey = (sec) => new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
const monthKey = (sec) => dayKey(sec).slice(0, 7); // YYYY-MM
function weekKey(sec) {
  const [y, m, d] = dayKey(sec).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun .. 6=Sat
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); // walk back to Monday
  return dt.toISOString().slice(0, 10); // the week's Monday
}

function tally(keys) {
  const map = new Map();
  for (const k of keys) map.set(k, (map.get(k) || 0) + 1);
  return map;
}
function table(title, map, limit) {
  const rows = [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, limit);
  console.log(`\n${title}`);
  if (!rows.length) return console.log('  (none yet)');
  for (const [k, v] of rows) console.log(`  ${k}   ${String(v).padStart(5)}`);
}

await Promise.all(RELAYS.map(pull));
const secs = [...seen.values()];
const now = Math.floor(Date.now() / 1000);
const since = (days) => secs.filter((s) => s >= now - days * 86400).length;
const pad = (n) => String(n).padStart(6);

console.log(`blame.today — rough hits (nostr #${HIT_TAG}, times in ET)`);
console.log(`fetched ${seen.size} unique pings across ${RELAYS.length} relays\n`);
console.log(`  total          ${pad(seen.size)}`);
console.log(`  last 24h       ${pad(since(1))}`);
console.log(`  last 7 days    ${pad(since(7))}`);
console.log(`  last 30 days   ${pad(since(30))}`);

table('by day (most recent 14):', tally(secs.map(dayKey)), 14);
table('by week (Mon start, last 10):', tally(secs.map(weekKey)), 10);
table('by month (last 12):', tally(secs.map(monthKey)), 12);

process.exit(0);
