import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRelayPool, TAG } from '$lib/nostr';
import { signEvent } from '$lib/crypto';
import * as crypto from '$lib/crypto';

class Socket {
  static all: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (message: { data: string }) => void;
  onclose?: () => void;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  constructor(public url: string) { Socket.all.push(this); }
  emit(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}
beforeEach(() => { Socket.all = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('bounds the verification backlog synchronously and recovers on reconnect', async () => {
  vi.useFakeTimers();
  let finish!: (valid: boolean) => void;
  const verify = vi.spyOn(crypto, 'verifyEvent').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const onTarget = vi.fn(), onRelayReady = vi.fn();
  createRelayPool({ onTarget, onRelayReady }).connect();
  const ws = Socket.all[0]; ws.onopen?.();
  const event = await signEvent(1, 'Traffic', [['t', TAG]]);
  ws.emit(['EVENT', 'tg', event]);
  expect(verify).toHaveBeenCalledOnce();
  for (let n = 0; n < 1025; n++) ws.emit(['EOSE', 'tg']);
  expect(ws.close).toHaveBeenCalledOnce();
  finish(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(onTarget).not.toHaveBeenCalled();
  expect(onRelayReady).not.toHaveBeenCalled();
  const reconnected = Socket.all.at(-1)!;
  expect(reconnected).not.toBe(ws);
  reconnected.onopen?.(); reconnected.emit(['EVENT', 'tg', event]); reconnected.emit(['EOSE', 'tg']);
  await vi.waitFor(() => expect(onRelayReady).toHaveBeenCalledOnce());
  expect(onTarget).toHaveBeenCalledExactlyOnceWith({ id: event.id, text: 'Traffic' });
});

it('admits a complete requested initial page before EOSE', async () => {
  const onTarget = vi.fn(), onRelayReady = vi.fn();
  const events = await Promise.all(Array.from({ length: 1000 }, (_, n) => signEvent(1, `Traffic ${n}`, [['t', TAG]])));
  createRelayPool({ onTarget, onRelayReady }).connect();
  const ws = Socket.all[0]; ws.onopen?.();
  for (const event of events) ws.emit(['EVENT', 'tg', event]);
  ws.emit(['EOSE', 'tg']);
  await vi.waitFor(() => expect(onRelayReady).toHaveBeenCalledOnce(), { timeout: 15000 });
  expect(ws.close).not.toHaveBeenCalled();
  expect(onTarget).toHaveBeenCalledTimes(1000);
  expect(onTarget.mock.invocationCallOrder.at(-1)).toBeLessThan(onRelayReady.mock.invocationCallOrder[0]);
}, 20000);

it('rejects large or non-text frames before retaining or verifying them', async () => {
  vi.useFakeTimers();
  const verify = vi.spyOn(crypto, 'verifyEvent');
  for (const data of ['x'.repeat(131073), 'é'.repeat(66000), new Blob(['x'])]) {
    createRelayPool().connect();
    const ws = Socket.all.at(-1)!;
    ws.onmessage?.({ data: data as string });
    expect(ws.close).toHaveBeenCalledOnce();
  }
  expect(verify).not.toHaveBeenCalled();
});

it('bounds total queued bytes even below the frame-count limit', async () => {
  vi.useFakeTimers();
  let finish!: (valid: boolean) => void;
  vi.spyOn(crypto, 'verifyEvent').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  createRelayPool().connect();
  const ws = Socket.all[0];
  ws.emit(['EVENT', 'tg', await signEvent(1, 'Traffic', [['t', TAG]])]);
  for (let n = 0; n < 9; n++) ws.onmessage?.({ data: 'x'.repeat(128 * 1024) });
  expect(ws.close).toHaveBeenCalledOnce();
  finish(true);
});

it('caps unanswered COUNT metadata, frees replied slots, and replaces superseded requests', async () => {
  const onCount = vi.fn();
  const pool = createRelayPool({ onCount }); pool.connect();
  const ws = Socket.all[0];
  pool.countOn(ws.url, Array.from({ length: 13000 }, (_, n) => `target-${n}`));
  expect(ws.send).toHaveBeenCalledTimes(12000);
  const first = JSON.parse(ws.send.mock.calls[0][0]);
  for (let n = 0; n < 100; n++) pool.countOn(ws.url, ['target-0']);
  expect(ws.send).toHaveBeenCalledTimes(12100);
  const latest = JSON.parse(ws.send.mock.calls.at(-1)![0]);
  ws.emit(['COUNT', first[1], { count: 99 }]);
  ws.emit(['COUNT', latest[1], { count: 1 }]);
  await vi.waitFor(() => expect(onCount).toHaveBeenCalledExactlyOnceWith('target-0', 1, false, ws.url));
  pool.countOn(ws.url, ['new-target']);
  expect(ws.send).toHaveBeenCalledTimes(12101);
});

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
