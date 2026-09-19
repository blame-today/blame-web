// The blame.today Nostr layer: relay connection pool, wire framing (REQ / COUNT / EVENT /
// OK / EOSE), reconnection, fan-out publishing, OK-matching, and our two event types.
// It knows how we speak Nostr; it knows nothing about app state. Parsed domain events go
// out through the handlers — no raw Nostr shapes leak into the store.
import { signEvent, nowSec, isNostrEvent, verifyEvent } from './crypto';
import type { NostrEvent, RelayHandlers, RelayPool } from './types';

export { RELAYS, TAG } from './relays';
import { RELAYS, TAG } from './relays';

// Our two event types — kind 1 = a blame target, kind 7 = a vote — tagged so the relays can
// find them. Throwaway key per event (see crypto.ts).
export const signTarget = (text: string): Promise<NostrEvent> => signEvent(1, text, [['t', TAG]]);
export const signVote = (targetId: string): Promise<NostrEvent> => signEvent(7, '💥', [['e', targetId], ['t', TAG]]);

// A page-load "hit" ping for rough traffic counts. Tagged HIT_TAG (NOT TAG) on purpose so it
// never matches the topic/live REQs and can't surface on the board; count it any time with a
// COUNT on { kinds: [1], '#t': [HIT_TAG] }. Throwaway key like everything else.
export const HIT_TAG = 'pureblameapphit';
export const signHit = (): Promise<NostrEvent> => signEvent(1, '👀', [['t', HIT_TAG]]);

// Fire-and-forget the page-load hit to the relays on their own short-lived sockets, so it
// stays decoupled from the app pool's lifecycle. Entirely best-effort: failures are swallowed
// and each socket self-closes a few seconds after sending.
export async function publishHit(): Promise<void> {
  let ev: NostrEvent;
  try {
    ev = await signHit();
  } catch {
    return;
  }
  const msg = JSON.stringify(['EVENT', ev]);
  for (const url of RELAYS) {
    try {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        try {
          ws.send(msg);
        } catch {}
        setTimeout(() => {
          try {
            ws.close();
          } catch {}
        }, 3000);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
    } catch {
      /* skip this relay, best-effort */
    }
  }
}

type Conn = { ws: WebSocket; loaded: boolean };
const MAX_FRAME_BYTES = 128 * 1024;
const MAX_QUEUED_BYTES = 1024 * 1024;
const MAX_QUEUED_FRAMES = 1024; // admit the requested 1,000-event initial page plus its EOSE
const MAX_COUNT_SUBS = 12000; // 1,000 remote topics, two windows, across the five relays, plus owned topics

// Create the relay pool. `handlers` receives only parsed domain events:
//   onStatus(up, loaded) · onRelayReady(url) · onTarget({id,text}) ·
//   onReaction({id,target}) · onCount(targetId, count, recent)
export function createRelayPool(handlers: RelayHandlers = {}): RelayPool {
  const conns: Record<string, Conn> = {};
  const okWaiters = new Map<string, () => void>();
  // An entry is normally cleared by the COUNT reply. A relay that doesn't implement NIP-45 (or
  // drops the frame) never replies, so without a sweep resync would leak one entry per counted
  // topic per cycle, forever. Stamp each and drop the unanswered ones. (#6)
  const countSubs = new Map<string, { id: string; recent: boolean; at: number; relay: string; key: string }>();
  const latestCount = new Map<string, string>();
  const COUNT_SUB_TTL = 60000; // a relay that's going to answer does so well inside a resync cycle
  let lastSweep = 0;
  let countN = 0;

  const isOpen = (c: Conn | undefined): c is Conn => !!c && c.ws.readyState === 1;

  function open(url: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setTimeout(() => open(url), 2000);
      return;
    }
    conns[url] = { ws, loaded: false };
    ws.onopen = () => {
      conns[url].loaded = false;
      ws.send(JSON.stringify(['REQ', 'tg', { kinds: [1], '#t': [TAG], limit: 1000 }])); // topic list
      emitStatus();
    };
    // Bound admission before asynchronous verification retains any data. EOSE remains behind
    // accepted events. An overflowing relay reconnects instead of dropping events silently.
    const frames: { text: string; bytes: number }[] = [];
    let queuedBytes = 0;
    let processing = false;
    async function drainFrames(): Promise<void> {
      processing = true;
      try {
        while (frames.length && conns[url]?.ws === ws && ws.readyState === 1) {
          const frame = frames.shift()!;
          queuedBytes -= frame.bytes;
          try { await onFrame(url, ws, frame.text); }
          catch (error) { console.warn('relay message failed', error); }
        }
      } finally { processing = false; }
    }
    ws.onmessage = (m) => {
      if (ws.readyState !== 1 || conns[url]?.ws !== ws) return;
      if (typeof m.data !== 'string' || m.data.length > MAX_FRAME_BYTES) { ws.close(1009, 'frame too large'); return; }
      const bytes = new TextEncoder().encode(m.data).byteLength;
      if (bytes > MAX_FRAME_BYTES) { ws.close(1009, 'frame too large'); return; }
      if (frames.length >= MAX_QUEUED_FRAMES || queuedBytes + bytes > MAX_QUEUED_BYTES) { ws.close(1008, 'relay backlog'); return; }
      frames.push({ text: m.data, bytes });
      queuedBytes += bytes;
      if (!processing) void drainFrames();
    };
    ws.onclose = () => {
      frames.length = 0;
      queuedBytes = 0;
      if (conns[url]?.ws !== ws) return;
      conns[url].loaded = false;
      for (const [sub, meta] of countSubs) if (meta.relay === url) {
        countSubs.delete(sub);
        if (latestCount.get(meta.key) === sub) latestCount.delete(meta.key);
      }
      emitStatus();
      setTimeout(() => open(url), 2000);
    };
    ws.onerror = () => {};
  }

  async function onFrame(url: string, ws: WebSocket, text: string): Promise<void> {
    let p: any;
    try {
      p = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(p) || typeof p[1] !== 'string') return;
    switch (p[0]) {
      case 'EOSE': // initial topic list for this relay is in
        if (p[1] === 'tg' && conns[url] && !conns[url].loaded) {
          conns[url].loaded = true;
          emitStatus();
          handlers.onRelayReady?.(url);
        }
        return;
      case 'COUNT': {
        const meta = countSubs.get(p[1]);
        if (!meta || meta.relay !== url) return;
        countSubs.delete(p[1]);
        if (latestCount.get(meta.key) !== p[1]) return;
        latestCount.delete(meta.key);
        const count = p[2]?.count;
        if (Number.isSafeInteger(count) && count >= 0) handlers.onCount?.(meta.id, count, meta.recent, url);
        return;
      }
      case 'OK': // first relay to accept resolves the waiter; rejections handled by retry
        if (p[2] === true) okWaiters.get(p[1])?.();
        return;
      case 'EVENT': {
        const e = p[2];
        if (!['tg', 'lv'].includes(p[1]) || !isNostrEvent(e)) return;
        if (!e.tags.some(tag => tag[0] === 't' && tag[1] === TAG)) return;
        if (e.created_at > nowSec() + 60 || ![1, 7].includes(e.kind)) return;
        if (p[1] === 'tg' && e.kind !== 1) return;
        const target = e.tags.filter(tag => tag[0] === 'e').at(-1)?.[1];
        if (e.kind === 7 && (e.content !== '💥' || !target || !/^[a-f0-9]{64}$/.test(target))) return;
        if (!await verifyEvent(e)) return;
        if (conns[url]?.ws !== ws || ws.readyState !== 1) return;
        if (e.kind === 1) handlers.onTarget?.({ id: e.id, text: e.content });
        else handlers.onReaction?.({ id: e.id, target });
        return;
      }
    }
  }

  function emitStatus(): void {
    let up = 0;
    let loaded = 0;
    for (const url in conns) {
      if (isOpen(conns[url])) up++;
      if (conns[url].loaded) loaded++;
    }
    handlers.onStatus?.(up, loaded);
  }

  function sendCount(url: string, ws: WebSocket, targetId: string, since?: number): void {
    const now = Date.now();
    if (now - lastSweep > COUNT_SUB_TTL) {
      lastSweep = now; // throttled: sendCount fires hundreds of times per resync, the sweep once
      for (const [sub, meta] of countSubs) if (now - meta.at > COUNT_SUB_TTL) {
        countSubs.delete(sub);
        if (latestCount.get(meta.key) === sub) latestCount.delete(meta.key);
      }
    }
    const key = `${url}:${targetId}:${since !== undefined}`;
    const previous = latestCount.get(key);
    if (previous) countSubs.delete(previous);
    if (countSubs.size >= MAX_COUNT_SUBS) return;
    const sub = 'c' + ++countN;
    latestCount.set(key, sub);
    countSubs.set(sub, { id: targetId, recent: since !== undefined, at: now, relay: url, key });
    const filter: Record<string, unknown> = { kinds: [7], '#e': [targetId], '#t': [TAG] };
    if (since !== undefined) filter.since = since; // windowed count (e.g. last 24h) for "hot"
    ws.send(JSON.stringify(['COUNT', sub, filter])); // count votes, don't fetch them
  }

  return {
    total: RELAYS.length,
    connect: () => RELAYS.forEach(open),

    // Go live (new topics + new votes) on one relay, after its topic list has loaded.
    live(url) {
      const c = conns[url];
      if (isOpen(c)) c.ws.send(JSON.stringify(['REQ', 'lv', { kinds: [1, 7], '#t': [TAG], since: nowSec() }]));
    },

    // COUNT the given target ids on one relay / on every open relay.
    // Pass `since` (unix seconds) for a windowed count (e.g. last 24h); omit for all-time.
    countOn(url, ids, since) {
      const c = conns[url];
      if (isOpen(c)) for (const id of ids) sendCount(url, c.ws, id, since);
    },
    countAll(ids, since) {
      for (const url in conns) if (isOpen(conns[url])) for (const id of ids) sendCount(url, conns[url].ws, id, since);
    },

    // Fan a signed event out to every open relay; returns how many got it.
    publish(ev) {
      const msg = JSON.stringify(['EVENT', ev]);
      let sent = 0;
      for (const url in conns) {
        if (isOpen(conns[url])) {
          try {
            conns[url].ws.send(msg);
            sent++;
          } catch {}
        }
      }
      return sent;
    },

    // Resolve true on the first relay that accepts the event id; null on timeout.
    waitOk(id, ms) {
      return new Promise((res) => {
        let done = false;
        const fin = (v: true | null) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (okWaiters.get(id) === accept) okWaiters.delete(id);
          res(v);
        };
        const accept = () => fin(true);
        const timer = setTimeout(() => fin(null), ms);
        okWaiters.set(id, accept);
      });
    },

    anyOpen() {
      for (const url in conns) if (isOpen(conns[url])) return true;
      return false;
    },
  };
}
