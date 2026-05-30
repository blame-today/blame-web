// Shared types for the app.

// A blame target as held in the store. confirmed = all-time votes, hot = votes in the last 24h,
// pending = votes queued/in-flight (the ↑n badge).
export type Topic = {
  id: string;
  txt: string;
  confirmed: number;
  hot: number;
  pending: number;
};

// What a Row renders — a topic projected for a given view. `count` is the metric for the active
// filter (all-time confirmed, or 24h hot); `rank` is omitted on the Mine filter; `mine` flags a
// topic you've blamed so it gets the "I blamed" sticker on the All/Today boards.
// A blame-suggestion mined from the news: an entity pulled from a headline, with how many of
// today's headlines mentioned it (its heat) and a link back to a source article.
export type NewsItem = {
  text: string;
  mentions: number;
  url: string;
  headline: string;
};

export type RowTopic = {
  id: string;
  txt: string;
  pending: number;
  count: number;
  rank?: number;
  mine?: boolean;
};

// A signed Nostr event (NIP-01).
export type NostrEvent = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
};

// Parsed domain events the relay pool hands up to the store — no raw Nostr shapes leak out.
export type RelayHandlers = {
  onStatus?: (up: number, loaded: number) => void;
  onRelayReady?: (url: string) => void;
  onTarget?: (target: { id: string; text: string }) => void;
  onReaction?: (reaction: { id: string; target?: string }) => void;
  onCount?: (targetId: string, count: number, recent: boolean) => void;
};

// The command surface the store drives the relay layer through.
export type RelayPool = {
  total: number;
  connect: () => void;
  live: (url: string) => void;
  countOn: (url: string, ids: string[], since?: number) => void;
  countAll: (ids: string[], since?: number) => void;
  publish: (ev: NostrEvent) => number;
  waitOk: (id: string, ms: number) => Promise<true | null>;
  anyOpen: () => boolean;
};
