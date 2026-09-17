import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRelayPool, TAG } from '$lib/nostr';
import { signEvent } from '$lib/crypto';

class Socket {
  static all: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (message: { data: string }) => void;
  send = vi.fn();
  constructor(public url: string) { Socket.all.push(this); }
  emit(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}
beforeEach(() => { Socket.all = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => vi.unstubAllGlobals());

it('verifies signed events and preserves event-before-EOSE ordering', async () => {
  const onTarget = vi.fn(), onRelayReady = vi.fn();
  createRelayPool({ onTarget, onRelayReady }).connect();
  const ws = Socket.all[0]; ws.onopen?.();
  const valid = await signEvent(1, 'Traffic', [['t', TAG]]);
  for (const frame of [null, {}, ['EVENT', 'tg', {}], ['EVENT', 'tg', { ...valid, content: 'Forged' }]]) ws.emit(frame);
  ws.emit(['EVENT', 'tg', valid]); ws.emit(['EOSE', 'tg']);
  await vi.waitFor(() => expect(onRelayReady).toHaveBeenCalledTimes(1));
  expect(onTarget).toHaveBeenCalledExactlyOnceWith({ id: valid.id, text: 'Traffic' });
  expect(onTarget.mock.invocationCallOrder[0]).toBeLessThan(onRelayReady.mock.invocationCallOrder[0]);
});

it('ignores wrong subscriptions, wrong tags and non-blame reactions', async () => {
  const onTarget = vi.fn(), onReaction = vi.fn(), onRelayReady = vi.fn();
  createRelayPool({ onTarget, onReaction, onRelayReady }).connect();
  const ws = Socket.all[0]; ws.onopen?.();
  ws.emit(['EVENT', 'other', await signEvent(1, 'Traffic', [['t', TAG]])]);
  ws.emit(['EVENT', 'tg', await signEvent(1, 'Traffic', [['t', 'elsewhere']])]);
  ws.emit(['EVENT', 'lv', await signEvent(7, '-', [['t', TAG], ['e', 'a'.repeat(64)]])]);
  ws.emit(['EVENT', 'lv', await signEvent(7, '💥', [['t', TAG], ['e', 'a'.repeat(64)], ['e', 'invalid-last-target']])]);
  ws.emit(['EOSE', 'tg']);
  await vi.waitFor(() => expect(onRelayReady).toHaveBeenCalled());
  expect(onTarget).not.toHaveBeenCalled(); expect(onReaction).not.toHaveBeenCalled();
});

it('accepts only the newest matching relay COUNT and validates its value', async () => {
  const onCount = vi.fn();
  const pool = createRelayPool({ onCount }); pool.connect();
  const ws = Socket.all[0]; ws.onopen?.();
  pool.countOn(ws.url, ['target']); pool.countOn(ws.url, ['target']);
  const counts = ws.send.mock.calls.map(([s]) => JSON.parse(s)).filter(p => p[0] === 'COUNT');
  expect(counts[0][2]['#t']).toEqual([TAG]);
  ws.emit(['COUNT', counts[1][1], { count: 2 }]); ws.emit(['COUNT', counts[0][1], { count: 99 }]);
  await vi.waitFor(() => expect(onCount).toHaveBeenCalledExactlyOnceWith('target', 2, false, ws.url));
  pool.countOn(ws.url, ['target']);
  const last = JSON.parse(ws.send.mock.calls.at(-1)![0]);
  ws.emit(['COUNT', last[1], { count: -1 }]); ws.emit(['COUNT', '__proto__', { count: 10 }]);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(onCount).toHaveBeenCalledTimes(1);
});
