// App orchestration: the reactive store, the vote queue, mapping relay events to topics, and
// persistence. The Nostr layer (nostr.ts), signing (crypto.ts), and content filter (filter.ts)
// live in their own modules; the view is App.svelte. No protocol details live here.
import { createRelayPool, signTarget, signVote } from './nostr';
import { nowSec } from './crypto';
import { checkContent, clip } from './filter';
import type { NostrEvent, Topic } from './types';

const DB_KEY = 'blm_v8';
const TOP_N = 100;
const MAX_REMOTE_TOPICS = 1000;
const RESYNC_MS = 45000;
const RESYNC_TOP = 150;
const DAY = 86400; // "hot" window: votes in the last 24h
const MAX_VOTE_ATTEMPTS = 5; // give up on a vote after this many rejections so it can't wedge the queue (#4)

export const TOP = TOP_N;

// Reactive state read by the view. Remote slots are reused when their budget is full;
// the view derives the sorted top-N. confirmed = all-time count, hot = last-24h count,
// pending = queued/in-flight. `mine` = ids you've voted on (pinned in "Your Blames").
export const store = $state<{
  topics: Topic[];
  mine: string[];
  relaysUp: number;
  relaysTotal: number;
  synced: boolean;
  connecting: boolean;
}>({
  topics: [],
  mine: [],
  relaysUp: 0,
  relaysTotal: 0,
  synced: false,
  connecting: true,
});

const byId = new Map<string, number>(); // id -> slot in store.topics
const remoteIds = new Set<string>(); // owned topics do not consume the relay admission budget
const idxByText = new Map<string, string>(); // normalized text -> id (dedup blames by text)
// Dedup relay echoes before requesting a recount. Live events never add to a COUNT snapshot.
const seen = new Map<string, 1>();
const SEEN_MAX = 20000;
const SEEN_EVICT = 5000; // drop in chunks so the eviction stays amortized O(1) per insert
const snapshots = new Map<string, Map<string, { count: number; at: number }>>();
type Delivery = { id: string; event?: NostrEvent; failures: number };
let queue: Delivery[] = [];
let failed: Delivery[] = [];
const unpublished = new Map<string, NostrEvent>();
const recount = new Set<string>();
let recountTimer: ReturnType<typeof setTimeout> | undefined;
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

function addTopic(id: string, txt: string, confirmed = 0, owned = false): boolean {
  if (byId.has(id)) return false;
  const topic = { id, txt, confirmed, hot: 0, pending: 0 };
  if (!owned && remoteIds.size >= MAX_REMOTE_TOPICS) {
    // Replace the oldest unowned target so a full cached board can still receive live topics.
    const oldest = remoteIds.values().next().value!;
    const slot = byId.get(oldest)!;
    const oldKey = store.topics[slot].txt.toLowerCase();
    store.topics[slot] = topic;
    byId.delete(oldest);
    byId.set(id, slot);
    remoteIds.delete(oldest);
    snapshots.delete(`${oldest}:false`);
    snapshots.delete(`${oldest}:true`);
    recount.delete(oldest);
    if (idxByText.get(oldKey) === oldest) {
      idxByText.delete(oldKey);
      const other = store.topics.find(t => t.txt.toLowerCase() === oldKey);
      if (other) idxByText.set(oldKey, other.id);
    }
  } else {
    store.topics.push(topic);
    byId.set(id, store.topics.length - 1);
  }
  if (!owned) remoteIds.add(id);
  const key = txt.toLowerCase();
  if (!idxByText.has(key)) idxByText.set(key, id);
  return true;
}

// ---- Public API ----
export function init(): void {
  store.relaysTotal = pool.total;
  try {
    const saved = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
    if (saved) {
      if (Array.isArray(saved.mine)) store.mine = [...new Set<string>(saved.mine.filter((id: unknown) => typeof id === 'string'))];
      const owned = new Set(store.mine);
      if (Array.isArray(saved.t)) {
        for (const row of saved.t) {
          if (!row || typeof row.id !== 'string' || typeof row.txt !== 'string' || !row.txt || checkContent(row.txt)) continue; // drop now-filtered cache
          addTopic(row.id, row.txt, Number.isSafeInteger(row.vts) && row.vts >= 0 ? row.vts : 0, owned.has(row.id));
        }
      }
      store.mine = store.mine.filter(id => byId.has(id));
    }
  } catch {}
  pool.connect();
  setTimeout(() => { store.connecting = false; }, 8000);
}

export function vote(id: string): void {
  const t = get(id);
  if (!t) return;
  t.pending += 1; // affects the ↑n badge only — never the count or the order
  if (!store.mine.includes(id)) {
    store.mine.push(id); // remember it's yours
    remoteIds.delete(id);
    schedulePersist();
  }
  queue.push({ id, failures: 0 });
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
  unpublished.set(ev.id, ev);
  addTopic(ev.id, clip(txt), 0, true);
  vote(ev.id); // creator's opening blame
  return ev.id;
}

export function retryFailed(id: string): void {
  const retry = failed.filter(entry => entry.id === id);
  failed = failed.filter(entry => entry.id !== id);
  for (const entry of retry) { entry.failures = 0; queue.push(entry); }
  const t = get(id);
  if (t) { t.pending += retry.length; t.failed = 0; }
  void drain();
}

// ---- Relay events -> state ----
function onStatus(up: number, loaded: number): void {
  store.relaysUp = up;
  if (up > 0) store.connecting = false;
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
  if (!addTopic(id, clip(raw), 0)) return;
  if (started) {
    pool.countAll([id]);
    pool.countAll([id], dayAgo());
  }
}

function markSeen(id: string): void {
  seen.set(id, 1);
  if (seen.size <= SEEN_MAX) return;
  let n = SEEN_EVICT;
  for (const k of seen.keys()) {
    seen.delete(k); // Map keys iterate oldest-first, so this drops the coldest ids
    if (--n === 0) break;
  }
}

function onReaction({ id, target }: { id: string; target?: string }): void {
  if (seen.has(id)) return; // our own echo, or the same vote from another relay
  markSeen(id);
  const t = target ? get(target) : null;
  if (!t) return; // unknown topic: ignore; the next COUNT/resync catches it
  requestCounts(t.id);
}

// NIP-45 gives relay estimates, not event IDs. Use their maximum; never add live events to it.
// A fresh snapshot can correct a cached total downward. Expire disconnected relay estimates.
function onCount(targetId: string, count: number, recent: boolean, relay = 'relay'): void {
  const t = get(targetId);
  if (!t || !Number.isSafeInteger(count) || count < 0) return;
  const key = `${targetId}:${recent}`;
  const values = snapshots.get(key) ?? new Map();
  values.set(relay, { count, at: Date.now() });
  for (const [url, sample] of values) if (Date.now() - sample.at > RESYNC_MS * 2) values.delete(url);
  snapshots.set(key, values);
  t[recent ? 'hot' : 'confirmed'] = Math.max(...Array.from(values.values(), sample => sample.count));
  if (!recent) schedulePersist();
}

function requestCounts(id: string): void {
  recount.add(id);
  if (recountTimer) return;
  recountTimer = setTimeout(() => {
    const ids = [...recount];
    recount.clear();
    recountTimer = undefined;
    pool.countAll(ids);
    pool.countAll(ids, dayAgo());
  }, 250);
}

function resync(): void {
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
      const entry = queue[0];
      const id = entry.id;
      const target = unpublished.get(id);
      let ev: NostrEvent;
      try {
        ev = target ?? (entry.event ??= await signVote(id));
      } catch {
        failDelivery(entry);
        continue;
      }
      markSeen(ev.id); // pre-mark so our own echoes (from every relay) are deduped
      const accepted = pool.waitOk(ev.id, 8000);
      if (!pool.publish(ev)) break;
      const ok = await accepted;
      const t = get(id);
      if (ok === true) {
        entry.failures = 0;
        backoff = 0;
        if (target) { unpublished.delete(id); continue; }
        queue.shift();
        if (t) {
          t.pending = Math.max(0, t.pending - 1);
        }
        requestCounts(id);
        schedulePersist();
        await sleep(120);
      } else if (++entry.failures >= MAX_VOTE_ATTEMPTS) {
        failDelivery(entry);
        backoff = 0;
      } else {
        backoff = backoff ? Math.min(backoff * 2, 8000) : 800;
        await sleep(backoff);
      }
    }
  } finally {
    draining = false;
  }
}

function failDelivery(entry: Delivery): void {
  queue.shift();
  failed.push(entry);
  const t = get(entry.id);
  if (t) { t.pending = Math.max(0, t.pending - 1); t.failed = (t.failed ?? 0) + 1; }
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
