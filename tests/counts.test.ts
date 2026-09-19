import { it, expect, vi } from 'vitest';
import { RELAYS, TAG, corroboratedCount } from '$lib/relays';
import { countVotes } from '../scripts/vulgarity-audit.mjs';

it('corroborates divergent reports without trusting a lone maximum or inventing evidence for a timeout', () => {
  const samples = (values: number[]) => new Map(values.map((value, i) => [RELAYS[i], value]));
  expect(corroboratedCount(samples([66, 1319, 1320]))).toBe(1319);
  expect(corroboratedCount(samples([10, Number.MAX_SAFE_INTEGER]))).toBe(10);
  expect(corroboratedCount(samples([Number.MAX_SAFE_INTEGER]))).toBeNull();
  expect(corroboratedCount(samples([0, 0]))).toBe(0);
  expect(corroboratedCount(samples([10, NaN, Infinity, -1, 1.5]))).toBeNull();
  expect(corroboratedCount(new Map([[RELAYS[0], 100], ['wss://unknown.example', 100]]))).toBeNull();
});

it('the audit ranks with the same corroborated counts and application filter as the board', async () => {
  vi.useFakeTimers();
  const requests: any[] = [];
  class Socket {
    onopen?: () => void;
    onmessage?: (message: { data: string }) => void;
    onerror?: () => void;
    constructor(public url: string) { queueMicrotask(() => this.onopen?.()); }
    send(raw: string) {
      const request = JSON.parse(raw);
      requests.push(request);
      const count = this.url === RELAYS[0] ? 999999 : this.url === RELAYS[1] ? 7 : -1;
      this.onmessage?.({ data: JSON.stringify(['COUNT', request[1], { count }]) });
      if (this.url === RELAYS[0]) this.onmessage?.({ data: JSON.stringify(['COUNT', request[1], { count: 999999 }]) });
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  try {
    const result = countVotes([{ id: 'target', label: 'Traffic' }]);
    await vi.advanceTimersByTimeAsync(8001);
    expect((await result).get('target')).toBe(7);
    expect(requests).toHaveLength(RELAYS.length);
    expect(requests.every(p => p[2]['#t'][0] === TAG)).toBe(true);
  } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});
