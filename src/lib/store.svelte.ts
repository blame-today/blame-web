// App orchestration: the reactive store, the vote queue, mapping relay events to topics, and
// persistence. The Nostr layer (nostr.ts), signing (crypto.ts), and content filter (filter.ts)
// live in their own modules; the view is App.svelte. No protocol details live here.
import { createRelayPool, signTarget, signVote } from './nostr';
import { nowSec } from './crypto';
import { checkContent, clip } from './filter';
import type { NostrEvent, Topic } from './types';

const DB_KEY = 'blm_v8';
const TOP_N = 100;
const RESYNC_MS = 45000;
const RESYNC_TOP = 150;
const DAY = 86400; // "hot" window: votes in the last 24h

export const TOP = TOP_N;

// Reactive state read by the view. Topics stay in insertion order (never reordered here);
// the view derives the sorted top-N. confirmed = all-time count, hot = last-24h count,
// pending = queued/in-flight. `mine` = ids you've voted on (pinned in "Your Blames").
export const store = $state<{
  topics: Topic[];
  mine: string[];
  relaysUp: number;
  relaysTotal: number;
  synced: boolean;
}>({
  topics: [],
  mine: [],
  relaysUp: 0,
  relaysTotal: 0,
  synced: false,
});

const byId = new Map<string, number>(); // id -> index into store.topics (stable; never reordered)
const idxByText = new Map<string, string>(); // normalized text -> id (dedup blames by text)
const seen: Record<string, 1> = {}; // reactionId -> 1 (dedup our echoes + the same vote from N relays)
let hotSeen: Record<string, number> = {}; // per-resync-cycle max 24h count (lets "hot" fall as votes age out)
let queue: string[] = [];
let draining = false;
let backoff = 0;
let started = false;
let resyncTimer: ReturnType<typeof setInterval> | undefined;
let persistTm: ReturnType<typeof setTimeout> | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayAgo = () => nowSec() - DAY;

const pool = createRelayPool({ onStatus, onRelayReady, onTarget, onReaction, onCount });

function get(id: string): Topic | null {
  const i = byId.get(id);
  return i === undefined ? null : store.topics[i];
}

function addTopic(id: string, txt: string, confirmed = 0): void {
  if (byId.has(id)) return;
  store.topics.push({ id, txt, confirmed, hot: 0, pending: 0 });
  byId.set(id, store.topics.length - 1);
  const key = txt.toLowerCase();
  if (!idxByText.has(key)) idxByText.set(key, id);
}

// ---- Public API ----
export function init(): void {
  store.relaysTotal = pool.total;
  try {
    const saved = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
    if (saved) {
      if (Array.isArray(saved.mine)) store.mine = saved.mine;
      if (Array.isArray(saved.t)) {
        for (const row of saved.t) {
          if (!row || !row.txt || checkContent(row.txt)) continue; // drop now-filtered cache
          addTopic(row.id, row.txt, row.vts || 0);
        }
      }
    }
  } catch {}
  pool.connect();
}

export function vote(id: string): void {
  const t = get(id);
  if (!t) return;
  t.pending += 1; // affects the ↑n badge only — never the count or the order
  if (!store.mine.includes(id)) {
    store.mine.push(id); // remember it's yours
    schedulePersist();
  }
  queue.push(id);
  drain();
}

export async function blame(txt: string): Promise<string | undefined> {
  if (checkContent(txt)) return undefined; // safety; the view already screens and shows the reason
  const existing = idxByText.get(txt.toLowerCase());
  if (existing) {
    vote(existing);
    return existing;
  }
  let ev: NostrEvent;
  try {
    ev = await signTarget(txt);
  } catch (e) {
    console.error('blame failed:', e);
    return undefined;
  }
  pool.publish(ev);
  addTopic(ev.id, clip(txt), 0);
  vote(ev.id); // creator's opening blame
  return ev.id;
}

// ---- Relay events -> state ----
function onStatus(up: number, loaded: number): void {
  store.relaysUp = up;
  store.synced = loaded > 0;
  if (up > 0) drain(); // a relay just came up — resume any queued votes
}

function onRelayReady(url: string): void {
  const ids = store.topics.map((t) => t.id);
  pool.countOn(url, ids); // all-time baseline
  pool.countOn(url, ids, dayAgo()); // last-24h baseline ("hot")
  pool.live(url); // then stream new topics + votes from this relay
  if (!started) {
    started = true;
    resyncTimer = setInterval(resync, RESYNC_MS); // periodically re-COUNT to stay honest at scale
  }
}

function onTarget({ id, text }: { id: string; text: string }): void {
  if (byId.has(id)) return;
  const raw = text.trim();
  if (checkContent(raw)) return; // profanity / PII / gibberish never enters state or storage
  addTopic(id, clip(raw), 0);
  if (started) {
    pool.countAll([id]);
    pool.countAll([id], dayAgo());
  }
}

function onReaction({ id, target }: { id: string; target?: string }): void {
  if (seen[id]) return; // our own echo, or the same vote from another relay
  seen[id] = 1;
  const t = target ? get(target) : null;
  if (!t) return; // unknown topic: ignore; the next COUNT/resync catches it
  t.confirmed += 1;
  t.hot += 1; // a live vote is, by definition, within the last 24h
  schedulePersist();
}

// confirmed is all-time (monotonic max-merge). hot is the 24h window — non-monotonic, so we
// take the max across relays *within a resync cycle* (hotSeen) and let it fall each new cycle.
function onCount(targetId: string, count: number, recent: boolean): void {
  const t = get(targetId);
  if (!t || typeof count !== 'number') return;
  if (recent) {
    hotSeen[targetId] = Math.max(hotSeen[targetId] || 0, count);
    t.hot = hotSeen[targetId];
  } else if (count > t.confirmed) {
    t.confirmed = count;
    schedulePersist();
  }
}

function resync(): void {
  hotSeen = {}; // new cycle — let hot counts re-settle (and fall as votes age past 24h)
  const topConfirmed = [...store.topics].sort((a, b) => b.confirmed - a.confirmed).slice(0, RESYNC_TOP).map((t) => t.id);
  const topHot = [...store.topics].sort((a, b) => b.hot - a.hot).slice(0, RESYNC_TOP).map((t) => t.id);
  pool.countAll(topConfirmed); // refresh all-time for the leaderboard
  pool.countAll(topHot, dayAgo()); // refresh 24h for "hot today"
}

// ---- Vote queue: hand each vote to the relay layer, retry until one ACCEPTS ----
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      if (!pool.anyOpen()) break;
      const id = queue[0];
      let ev: NostrEvent;
      try {
        ev = await signVote(id);
      } catch {
        break;
      }
      seen[ev.id] = 1; // pre-mark so our own echoes (from every relay) are deduped
      if (!pool.publish(ev)) break;
      const ok = await pool.waitOk(ev.id, 8000); // resolves only when a relay ACCEPTS; null on timeout
      const t = get(id);
      if (ok === true) {
        queue.shift();
        if (t) {
          t.confirmed += 1;
          t.hot += 1;
          t.pending = Math.max(0, t.pending - 1);
        }
        schedulePersist();
        backoff = 0;
        await sleep(120);
      } else {
        backoff = backoff ? Math.min(backoff * 2, 8000) : 800;
        await sleep(backoff);
      }
    }
  } finally {
    draining = false;
  }
}

// ---- Persistence (topic text + all-time counts + your voted ids, for instant cold boot) ----
function schedulePersist(): void {
  clearTimeout(persistTm);
  persistTm = setTimeout(persist, 200);
}
function persist(): void {
  try {
    const t = store.topics.map((x) => ({ id: x.id, txt: x.txt, vts: x.confirmed }));
    localStorage.setItem(DB_KEY, JSON.stringify({ t, mine: store.mine }));
  } catch {}
}
