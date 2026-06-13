import { describe, it, expect, beforeEach } from 'vitest';
import {
  explainer,
  hasSeen,
  persistSeen,
  openExplainer,
  closeExplainer,
  dismissBanner,
  SEEN_KEY,
} from '$lib/explainer.svelte';

// A throwing storage stands in for private-mode / blocked localStorage.
const throwingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
} as unknown as Storage;

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  } as unknown as Storage;
}

beforeEach(() => {
  localStorage.clear();
  explainer.open = false;
  explainer.seen = false;
});

describe('explainer seen-flag helpers', () => {
  it('hasSeen is false until the flag is the literal "1"', () => {
    const s = fakeStorage();
    expect(hasSeen(s)).toBe(false);
    s.setItem(SEEN_KEY, '1');
    expect(hasSeen(s)).toBe(true);
  });

  it('persistSeen writes the flag so hasSeen reads true', () => {
    const s = fakeStorage();
    persistSeen(s);
    expect(hasSeen(s)).toBe(true);
  });

  it('never throws when storage is blocked (private mode)', () => {
    expect(() => persistSeen(throwingStorage)).not.toThrow();
    expect(hasSeen(throwingStorage)).toBe(false);
  });
});

describe('explainer actions', () => {
  it('openExplainer opens the modal and marks seen (banner gone next time)', () => {
    openExplainer();
    expect(explainer.open).toBe(true);
    expect(explainer.seen).toBe(true);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('closeExplainer closes but leaves seen as-is', () => {
    openExplainer();
    closeExplainer();
    expect(explainer.open).toBe(false);
    expect(explainer.seen).toBe(true); // still seen from the open
  });

  it('dismissBanner marks seen without opening the modal', () => {
    dismissBanner();
    expect(explainer.open).toBe(false);
    expect(explainer.seen).toBe(true);
    expect(localStorage.getItem(SEEN_KEY)).toBe('1');
  });
});
