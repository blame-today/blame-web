// The blame.today Nostr layer: relay connection pool, wire framing (REQ / COUNT / EVENT /
// OK / EOSE), reconnection, fan-out publishing, OK-matching, and our two event types.
// It knows how we speak Nostr; it knows nothing about app state. Parsed domain events go
// out through the handlers — no raw Nostr shapes leak into the store.
import { signEvent, nowSec } from './crypto';
import type { NostrEvent, RelayHandlers, RelayPool } from './types';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
];
const TAG = 'pureblameapp';

// Our two event types — kind 1 = a blame target, kind 7 = a vote — tagged so the relays can
// find them. Throwaway key per event (see crypto.ts).
export const signTarget = (text: string): Promise<NostrEvent> => signEvent(1, text, [['t', TAG]]);
export const signVote = (targetId: string): Promise<NostrEvent> => signEvent(7, '💥', [['e', targetId], ['t', TAG]]);

type Conn = { ws: WebSocket; loaded: boolean };

// Create the relay pool. `handlers` receives only parsed domain events:
//   onStatus(up, loaded) · onRelayReady(url) · onTarget({id,text}) ·
//   onReaction({id,target}) · onCount(targetId, count, recent)
export function createRelayPool(handlers: RelayHandlers = {}): RelayPool {
  const conns: Record<string, Conn> = {};
  const okWaiters: Record<string, () => void> = {};
  const countSubs: Record<string, { id: string; recent: boolean }> = {};
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
    ws.onmessage = (m) => onFrame(url, m);
    ws.onclose = () => {
      if (conns[url]) conns[url].loaded = false;
      emitStatus();
      setTimeout(() => open(url), 2000);
    };
    ws.onerror = () => {};
  }

  function onFrame(url: string, m: MessageEvent): void {
    let p: any;
    try {
      p = JSON.parse(m.data);
    } catch {
      return;
    }
    switch (p[0]) {
      case 'EOSE': // initial topic list for this relay is in
        if (p[1] === 'tg' && conns[url] && !conns[url].loaded) {
          conns[url].loaded = true;
          emitStatus();
          handlers.onRelayReady?.(url);
        }
        return;
      case 'COUNT': {
        const meta = countSubs[p[1]];
        delete countSubs[p[1]];
        if (meta) handlers.onCount?.(meta.id, p[2] && p[2].count, meta.recent);
        return;
      }
      case 'OK': // first relay to accept resolves the waiter; rejections handled by retry
        if (p[2] === true) okWaiters[p[1]]?.();
        return;
      case 'EVENT': {
        const e = p[2];
        if (!e) return;
        if (e.kind === 1) handlers.onTarget?.({ id: e.id, text: e.content || '' });
        else if (e.kind === 7) handlers.onReaction?.({ id: e.id, target: (e.tags.find((t: string[]) => t[0] === 'e') || [])[1] });
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

  function sendCount(ws: WebSocket, targetId: string, since?: number): void {
    const sub = 'c' + ++countN;
    countSubs[sub] = { id: targetId, recent: since !== undefined };
    const filter: Record<string, unknown> = { kinds: [7], '#e': [targetId] };
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
      if (isOpen(c)) for (const id of ids) sendCount(c.ws, id, since);
    },
    countAll(ids, since) {
      for (const url in conns) if (isOpen(conns[url])) for (const id of ids) sendCount(conns[url].ws, id, since);
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
          delete okWaiters[id];
          res(v);
        };
        okWaiters[id] = () => fin(true);
        setTimeout(() => fin(null), ms);
      });
    },

    anyOpen() {
      for (const url in conns) if (isOpen(conns[url])) return true;
      return false;
    },
  };
}
