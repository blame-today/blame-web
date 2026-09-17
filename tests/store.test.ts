import { it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: {} as any, sequence: 0,
  pool: { total: 5, connect: vi.fn(), live: vi.fn(), countOn: vi.fn(), countAll: vi.fn(), publish: vi.fn(), waitOk: vi.fn(), anyOpen: vi.fn() }
}));
vi.mock('$lib/nostr', () => ({
  createRelayPool: (handlers: any) => { h.handlers = handlers; return h.pool; },
  signTarget: async (text: string) => ({ id: 'topic-' + text, kind: 1, content: text }),
  signVote: async () => ({ id: 'vote-' + ++h.sequence, kind: 7 })
}));
let m: typeof import('$lib/store.svelte');
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetAllMocks(); vi.resetModules(); localStorage.clear();
  h.pool.anyOpen.mockReturnValue(true); h.pool.publish.mockReturnValue(1); h.pool.waitOk.mockResolvedValue(true);
  m = await import('$lib/store.svelte');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const target = (id = 'target', text = 'Traffic') => h.handlers.onTarget({ id, text });
const sent = () => h.pool.publish.mock.calls.map(call => call[0]);

it('sends a target before its opening vote, then refreshes relay counts', async () => {
  let accept!: (value: boolean) => void;
  h.pool.waitOk.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
  const id = await m.blame('Traffic');
  expect(sent().map(e => e.kind)).toEqual([1]);
  expect(m.store.mine).toContain(id);
  accept(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(sent().map(e => e.kind)).toEqual([1, 7]);
  expect(m.store.topics[0].pending).toBe(0);
  expect(m.store.topics[0].confirmed).toBe(0); // ACK is delivery, not a separate count.
  expect(h.pool.countAll).toHaveBeenCalledWith([id]);
  h.handlers.onCount(id, 1, false);
  expect(m.store.topics[0].confirmed).toBe(1);
});

it('reuses a signed vote after a lost ACK and registers the waiter first', async () => {
  target(); h.pool.waitOk.mockResolvedValueOnce(null).mockResolvedValue(true);
  m.vote('target');
  await vi.advanceTimersByTimeAsync(1200);
  expect(sent()).toHaveLength(2);
  expect(sent()[0].id).toBe(sent()[1].id);
  expect(h.pool.waitOk.mock.invocationCallOrder[0]).toBeLessThan(h.pool.publish.mock.invocationCallOrder[0]);
});

it('two clicks still produce independent votes', async () => {
  target(); m.vote('target'); m.vote('target');
  await vi.advanceTimersByTimeAsync(500);
  expect(new Set(sent().map(e => e.id)).size).toBe(2);
});

it('publishes an offline target before its queued votes on reconnect', async () => {
  h.pool.anyOpen.mockReturnValue(false);
  await m.blame('Traffic');
  expect(sent()).toHaveLength(0);
  h.pool.anyOpen.mockReturnValue(true); h.handlers.onStatus(1, 1);
  await vi.advanceTimersByTimeAsync(500);
  expect(sent().map(e => e.kind)).toEqual([1, 7]);
  expect(m.store.topics[0].pending).toBe(0);
});

it('failed delivery does not block the queue and manual retry keeps its identity', async () => {
  target(); target('other', 'Weather');
  for (let n = 0; n < 5; n++) h.pool.waitOk.mockResolvedValueOnce(null);
  m.vote('target'); m.vote('other');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(m.store.topics[0]).toMatchObject({ pending: 0, failed: 1 });
  expect(m.store.topics[1].pending).toBe(0);
  const original = sent()[0].id;
  m.retryFailed('target');
  await vi.advanceTimersByTimeAsync(500);
  expect(sent().at(-1).id).toBe(original);
  expect(m.store.topics[0]).toMatchObject({ pending: 0, failed: 0 });
});

it('deduplicates topic text without losing the second click', async () => {
  await m.blame('Traffic'); await m.blame('traffic');
  await vi.advanceTimersByTimeAsync(500);
  expect(m.store.topics).toHaveLength(1);
  expect(sent().filter(e => e.kind === 7)).toHaveLength(2);
});

it('COUNT/live overlap and duplicate echoes never add to the snapshot', async () => {
  target(); h.handlers.onCount('target', 1, false);
  h.handlers.onReaction({ id: 'already-counted', target: 'target' });
  h.handlers.onReaction({ id: 'already-counted', target: 'target' });
  expect(m.store.topics[0].confirmed).toBe(1);
  await vi.advanceTimersByTimeAsync(300);
  expect(h.pool.countAll).toHaveBeenCalledTimes(2);
  h.handlers.onCount('target', 1, false);
  expect(m.store.topics[0].confirmed).toBe(1);
});

it('corrects totals downward and expires old relay estimates', async () => {
  target();
  h.handlers.onCount('target', 50, false, 'a');
  h.handlers.onCount('target', 30, false, 'b');
  expect(m.store.topics[0].confirmed).toBe(50);
  h.handlers.onCount('target', 25, false, 'a');
  expect(m.store.topics[0].confirmed).toBe(30);
  await vi.advanceTimersByTimeAsync(90_001);
  h.handlers.onCount('target', 20, false, 'a');
  expect(m.store.topics[0].confirmed).toBe(20);
  h.handlers.onCount('target', 3, true, 'a');
  expect(m.store.topics[0].hot).toBe(3);
});

it('ignores malformed counts, unknown topics and filtered content', () => {
  target();
  for (const count of [NaN, Infinity, -1, 1.5]) h.handlers.onCount('target', count, false);
  h.handlers.onReaction({ id: 'unknown', target: 'missing' });
  target('bad', 'shit');
  expect(m.store.topics).toHaveLength(1);
  expect(m.store.topics[0].confirmed).toBe(0);
});

it('persists ownership and re-filters the cached board', async () => {
  await m.blame('Traffic'); await vi.advanceTimersByTimeAsync(500);
  expect(JSON.parse(localStorage.getItem('blm_v8')!).mine).toContain('topic-Traffic');
  localStorage.setItem('blm_v8', JSON.stringify({ t: [{ id: 'a', txt: 'Taxes', vts: 9 }, { id: 'b', txt: 'shit', vts: 3 }], mine: ['a'] }));
  m.init();
  expect(m.store.topics.find(t => t.id === 'a')?.confirmed).toBe(9);
  expect(m.store.topics.find(t => t.id === 'b')).toBeUndefined();
});

it('a long-lived stream and an evicted echo still cannot inflate a total', async () => {
  target(); h.handlers.onCount('target', 10, false);
  for (let i = 0; i < 20001; i++) h.handlers.onReaction({ id: 'fill-' + i, target: 'target' });
  h.handlers.onReaction({ id: 'fill-0', target: 'target' });
  await vi.advanceTimersByTimeAsync(300);
  expect(m.store.topics[0].confirmed).toBe(10);
  expect(h.pool.countAll).toHaveBeenCalledTimes(2);
});
