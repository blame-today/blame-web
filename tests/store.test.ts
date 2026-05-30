import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared mock state for the relay layer. vi.hoisted so the vi.mock factory can reference it.
const h = vi.hoisted(() => {
  let handlers: any = null;
  let voteSeq = 0;
  const mkEvent = (kind: number, content: string, id: string) => ({
    id,
    pubkey: 'pub',
    kind,
    created_at: 0,
    content,
    tags: [] as string[][],
    sig: 'sig',
  });
  return {
    pool: {
      total: 5,
      connect: vi.fn(),
      live: vi.fn(),
      countOn: vi.fn(),
      countAll: vi.fn(),
      publish: vi.fn(() => 1),
      waitOk: vi.fn(async () => true as const),
      anyOpen: vi.fn(() => true),
    },
    getHandlers: () => handlers,
    setHandlers: (x: any) => {
      handlers = x;
    },
    mkEvent,
    nextVoteId: () => 'voteid-' + voteSeq++,
  };
});

vi.mock('$lib/nostr', () => ({
  createRelayPool: (handlers: any) => {
    h.setHandlers(handlers);
    return h.pool;
  },
  signTarget: async (txt: string) => h.mkEvent(1, txt, 'topic-' + txt),
  signVote: async () => h.mkEvent(7, '💥', h.nextVoteId()),
}));

// Fresh store module per test (it holds singleton state: byId, seen, the reactive store).
let m: typeof import('$lib/store.svelte');
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.resetModules();
  m = await import('$lib/store.svelte');
});

const find = (txt: string) => m.store.topics.find((t) => t.txt === txt);

describe('blame / vote', () => {
  it('creates a new topic, marks it yours, and confirms once a relay accepts', async () => {
    await m.blame('Inflation');
    const t = find('Inflation')!;
    expect(t).toBeTruthy();
    expect(t.pending).toBe(1);
    expect(m.store.mine).toContain(t.id);

    await vi.waitFor(() => expect(t.confirmed).toBe(1));
    expect(t.hot).toBe(1);
    expect(t.pending).toBe(0);
  });

  it('dedups by text — blaming an existing topic votes it instead of duplicating', async () => {
    await m.blame('Mondays');
    await m.blame('mondays'); // same text, different case
    expect(m.store.topics.filter((t) => t.txt.toLowerCase() === 'mondays')).toHaveLength(1);
  });
});

describe('relay events -> state', () => {
  it('onCount keeps the max for all-time (monotonic)', () => {
    h.getHandlers().onTarget({ id: 'tx', text: 'Politics' });
    const t = find('Politics')!;
    h.getHandlers().onCount('tx', 50, false);
    expect(t.confirmed).toBe(50);
    h.getHandlers().onCount('tx', 30, false); // lower -> ignored
    expect(t.confirmed).toBe(50);
  });

  it('onReaction bumps confirmed + hot and dedups by reaction id', () => {
    h.getHandlers().onTarget({ id: 'tx', text: 'Politics' });
    const t = find('Politics')!;
    h.getHandlers().onReaction({ id: 'r1', target: 'tx' });
    expect(t.confirmed).toBe(1);
    expect(t.hot).toBe(1);
    h.getHandlers().onReaction({ id: 'r1', target: 'tx' }); // same reaction -> ignored
    expect(t.confirmed).toBe(1);
    h.getHandlers().onReaction({ id: 'r2', target: 'tx' });
    expect(t.confirmed).toBe(2);
  });

  it('recent COUNT updates hot only, not all-time', () => {
    h.getHandlers().onTarget({ id: 'tx', text: 'CMBR' });
    const t = find('CMBR')!;
    h.getHandlers().onCount('tx', 7, true); // recent / 24h window
    expect(t.hot).toBe(7);
    expect(t.confirmed).toBe(0);
  });

  it('ignores reactions for unknown topics', () => {
    expect(() => h.getHandlers().onReaction({ id: 'r1', target: 'nope' })).not.toThrow();
    expect(m.store.topics).toHaveLength(0);
  });

  it('filters profanity/PII out of relay ingest', () => {
    h.getHandlers().onTarget({ id: 'bad', text: 'shit' });
    h.getHandlers().onTarget({ id: 'ok', text: 'Brunch' });
    expect(find('shit')).toBeUndefined();
    expect(find('Brunch')).toBeTruthy();
  });
});

describe('persistence', () => {
  it('persists your voted ids and rehydrates them on init', async () => {
    await m.blame('Comedians');
    const t = find('Comedians')!;
    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('blm_v8') || '{}');
      expect(saved.mine).toContain(t.id);
    });
  });

  it('init hydrates cached topics + mine (and re-filters)', () => {
    localStorage.setItem(
      'blm_v8',
      JSON.stringify({ t: [{ id: 'a', txt: 'Taxes', vts: 9 }, { id: 'b', txt: 'shit', vts: 3 }], mine: ['a'] }),
    );
    m.init();
    expect(find('Taxes')!.confirmed).toBe(9);
    expect(find('shit')).toBeUndefined(); // re-filtered on load
    expect(m.store.mine).toContain('a');
  });
});
