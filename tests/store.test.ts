import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RELAYS } from '$lib/relays';

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
const reports = (id: string, count: number, recent = false) => {
  for (const url of RELAYS.slice(0, 2)) h.handlers.onCount(id, count, recent, url);
};

it('bounds remote topics before and after EOSE while retaining live admission and owned pending topics', async () => {
  h.pool.anyOpen.mockReturnValue(false);
  for (let n = 0; n < 1500; n++) target(`remote-${n}`);
  expect(m.store.topics).toHaveLength(1000);
  h.handlers.onRelayReady('relay');
  expect(h.pool.countOn.mock.calls.every(call => call[1].length === 1000)).toBe(true);
  for (let n = 1500; n < 3000; n++) target(`remote-${n}`);
  expect(m.store.topics).toHaveLength(1000);
  expect(m.store.topics.some(t => t.id === 'remote-2999')).toBe(true);
  expect(m.store.topics.some(t => t.id === 'remote-0')).toBe(false);
  h.pool.countAll.mockClear();
  const mine = await m.blame('Weather');
  expect(m.store.mine).toContain(mine);
  expect(m.store.topics.find(t => t.id === mine)).toMatchObject({ pending: 1 });
  m.vote('remote-2999'); // ownership frees one remote slot without discarding the topic
  target('new-remote', 'Taxes');
  expect(m.store.topics).toHaveLength(1002);
  expect(h.pool.countAll).toHaveBeenCalledTimes(2);
  await m.blame('weather'); // text lookup still resolves the owned topic
  expect(m.store.topics).toHaveLength(1002);
  expect(m.store.topics.find(t => t.id === mine)).toMatchObject({ pending: 2 });
  await vi.advanceTimersByTimeAsync(500);
  expect(JSON.parse(localStorage.getItem('blm_v8')!).t).toHaveLength(1002);
});

it('eviction clears snapshots and repairs text lookup without removing owned topics', async () => {
  h.pool.anyOpen.mockReturnValue(false);
  target('first', 'Traffic'); target('second', 'Traffic');
  reports('first', 100);
  for (let n = 0; n < 999; n++) target(`remote-${n}`, 'Taxes');
  expect(m.store.topics.some(t => t.id === 'first')).toBe(false);
  expect(await m.blame('traffic')).toBe('second');
  for (let n = 999; n < 2100; n++) target(`remote-${n}`, 'Taxes');
  expect(m.store.topics.find(t => t.id === 'second')).toMatchObject({ pending: 1 });
  target('first', 'Traffic');
  h.handlers.onCount('first', 1, false, RELAYS[2]);
  expect(m.store.topics.find(t => t.id === 'first')?.confirmed).toBeNull();
  h.handlers.onCount('first', 1, false, RELAYS[1]);
  expect(m.store.topics.find(t => t.id === 'first')?.confirmed).toBe(1);
});

it('bounds restored remote topics even when owned entries follow an oversized old cache', () => {
  const t = Array.from({ length: 3000 }, (_, n) => ({ id: `saved-${n}`, txt: 'Traffic', vts: 1 }));
  t.push({ id: 'owned', txt: 'Weather', vts: 7 });
  localStorage.setItem('blm_v8', JSON.stringify({ t, mine: ['owned'] }));
  m.init();
  expect(m.store.topics).toHaveLength(1001);
  expect(m.store.topics.find(topic => topic.id === 'owned')).toMatchObject({ confirmed: null });
  expect(m.store.mine).toEqual(['owned']);
  h.handlers.onRelayReady('relay');
  expect(h.pool.countOn.mock.calls.every(call => call[1].length === 1001)).toBe(true);
});

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
  expect(m.store.topics[0].confirmed).toBeNull(); // ACK is delivery, not a count.
  expect(h.pool.countAll).toHaveBeenCalledWith([id]);
  h.handlers.onCount(id, 1, false, RELAYS[0]);
  expect(m.store.topics[0].confirmed).toBeNull();
  h.handlers.onCount(id, 1, false, RELAYS[1]);
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
  target(); reports('target', 1);
  h.handlers.onReaction({ id: 'already-counted', target: 'target' });
  h.handlers.onReaction({ id: 'already-counted', target: 'target' });
  expect(m.store.topics[0].confirmed).toBe(1);
  await vi.advanceTimersByTimeAsync(300);
  expect(h.pool.countAll).toHaveBeenCalledTimes(2);
  reports('target', 1);
  expect(m.store.topics[0].confirmed).toBe(1);
});

it('corrects totals downward and expires old relay estimates', async () => {
  target();
  h.handlers.onCount('target', 50, false, RELAYS[0]);
  h.handlers.onCount('target', 30, false, RELAYS[1]);
  expect(m.store.topics[0].confirmed).toBe(30);
  h.handlers.onCount('target', 25, false, RELAYS[0]);
  expect(m.store.topics[0].confirmed).toBe(25);
  await vi.advanceTimersByTimeAsync(90_001);
  h.handlers.onCount('target', 20, false, RELAYS[0]);
  expect(m.store.topics[0].confirmed).toBeNull();
  h.handlers.onCount('target', 18, false, RELAYS[1]);
  expect(m.store.topics[0].confirmed).toBe(18);
  reports('target', 3, true);
  expect(m.store.topics[0].hot).toBe(3);
});

it('ignores malformed counts, unknown topics and filtered content', () => {
  target();
  for (const count of [NaN, Infinity, -1, 1.5]) h.handlers.onCount('target', count, false, RELAYS[0]);
  h.handlers.onReaction({ id: 'unknown', target: 'missing' });
  target('bad', 'shit');
  expect(m.store.topics).toHaveLength(1);
  expect(m.store.topics[0].confirmed).toBeNull();
});

it('persists ownership and re-filters the cached board', async () => {
  await m.blame('Traffic'); await vi.advanceTimersByTimeAsync(500);
  expect(JSON.parse(localStorage.getItem('blm_v8')!).mine).toContain('topic-Traffic');
  localStorage.setItem('blm_v8', JSON.stringify({ t: [{ id: 'a', txt: 'Taxes', vts: 9 }, { id: 'b', txt: 'shit', vts: 3 }], mine: ['a'] }));
  m.init();
  expect(m.store.topics.find(t => t.id === 'a')?.confirmed).toBeNull();
  expect(m.store.mine).toContain('a');
  expect(m.store.topics.find(t => t.id === 'b')).toBeUndefined();
});

it('a long-lived stream and an evicted echo still cannot inflate a total', async () => {
  target(); reports('target', 10);
  for (let i = 0; i < 20001; i++) h.handlers.onReaction({ id: 'fill-' + i, target: 'target' });
  h.handlers.onReaction({ id: 'fill-0', target: 'target' });
  await vi.advanceTimersByTimeAsync(300);
  expect(m.store.topics[0].confirmed).toBe(10);
  expect(h.pool.countAll).toHaveBeenCalledTimes(2);
});

it('one configured relay cannot invent a supported total, even with repeated or cross-window claims', () => {
  target();
  h.handlers.onCount('target', Number.MAX_SAFE_INTEGER, false, RELAYS[0]);
  h.handlers.onCount('target', Number.MAX_SAFE_INTEGER, false, RELAYS[0]);
  h.handlers.onCount('target', Number.MAX_SAFE_INTEGER, false, 'wss://not-configured.example');
  h.handlers.onCount('target', Number.MAX_SAFE_INTEGER, true, RELAYS[1]);
  expect(m.store.topics[0]).toMatchObject({ confirmed: null, hot: null });
  h.handlers.onCount('target', 10, false, RELAYS[1]);
  expect(m.store.topics[0].confirmed).toBe(10);
  h.handlers.onCount('target', 12, false, RELAYS[2]);
  expect(m.store.topics[0].confirmed).toBe(12);
  h.handlers.onCount('target', 3, true, RELAYS[0]);
  expect(m.store.topics[0]).toMatchObject({ confirmed: 12, hot: 3 });
});

it('silent relays lose their corroboration on resync without any new reply', async () => {
  target(); reports('target', 100); reports('target', 5, true);
  h.handlers.onRelayReady(RELAYS[0]);
  await vi.advanceTimersByTimeAsync(135_000);
  expect(m.store.topics[0]).toMatchObject({ confirmed: null, hot: null });
  h.handlers.onCount('target', 1_000_000, false, RELAYS[0]);
  expect(m.store.topics[0].confirmed).toBeNull();
});

it('discards an inflated legacy cache and persists topics and ownership without stale totals', async () => {
  localStorage.setItem('blm_v8', JSON.stringify({ t: [{ id: 'saved', txt: 'Traffic', vts: Number.MAX_SAFE_INTEGER }], mine: ['saved'] }));
  m.init();
  expect(m.store.topics[0]).toMatchObject({ id: 'saved', confirmed: null, hot: null });
  expect(m.store.mine).toEqual(['saved']);
  h.handlers.onCount('saved', Number.MAX_SAFE_INTEGER, false, RELAYS[0]);
  expect(m.store.topics[0].confirmed).toBeNull();
  target('new', 'Taxes');
  await vi.advanceTimersByTimeAsync(250);
  const saved = JSON.parse(localStorage.getItem('blm_v8')!);
  expect(saved.t.find((t: any) => t.id === 'saved')).toEqual({ id: 'saved', txt: 'Traffic' });
  expect(saved.mine).toEqual(['saved']);
});
