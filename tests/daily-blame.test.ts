import { describe, it, expect, vi } from 'vitest';
import { FALLBACK_POOL, buildPrompt, pickN, pickTopics, validate } from '../scripts/daily-blame.mjs';
import { MAX_LENGTH } from '$lib/filter';

describe('validate (#28)', () => {
  it('keeps clean everyday annoyances', () => {
    const { kept, rejected } = validate(['loading spinners', 'the snooze button', 'rainy weekends']);
    expect(kept).toEqual(['loading spinners', 'the snooze button', 'rainy weekends']);
    expect(rejected).toEqual([]);
  });

  it('drops anything the board itself would reject, using the shipped filter', () => {
    const { kept, rejected } = validate([
      'loading spinners',
      'damn printers', // profanity
      'a'.repeat(MAX_LENGTH + 1), // over the composer's length cap
      'me@example.com', // PII
      'asdfasdf', // keyboard mash
    ]);
    expect(kept).toEqual(['loading spinners']);
    expect(rejected.map((r) => r.why)).toEqual(['No bad words!', 'Too long!', 'No PII!', 'Real words only!']);
  });

  it('drops duplicates case-insensitively and skips empties and non-strings', () => {
    const { kept, rejected } = validate(['printers', 'Printers', '   ', 42, null]);
    expect(kept).toEqual(['printers']);
    expect(rejected.map((r) => r.why)).toEqual(['duplicate', 'empty', 'empty', 'empty']);
  });

  it('survives a model that returns something that is not an array', () => {
    expect(validate(null).kept).toEqual([]);
    expect(validate('not an array').kept).toEqual([]);
  });
});

// The pool is the safety net, so it must never be the thing that poisons the board. If a future
// filter change outlaws one of these, this test says so instead of the nightly vulgarity audit
// finding our own seed data on the leaderboard.
describe('fallback pool (#28)', () => {
  it('every entry passes the shipped filter', () => {
    const { kept, rejected } = validate(FALLBACK_POOL);
    expect(rejected).toEqual([]);
    expect(kept).toHaveLength(FALLBACK_POOL.length);
  });
});

describe('pickN', () => {
  it('returns n items drawn from the source without mutating it', () => {
    const src = ['a', 'b', 'c', 'd'];
    const got = pickN(src, 2, () => 0.5);
    expect(got).toHaveLength(2);
    for (const g of got) expect(src).toContain(g);
    expect(src).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('buildPrompt', () => {
  it('carries the real length cap so the model is not asked for targets the filter will drop', () => {
    expect(buildPrompt(10)).toContain(`Under ${MAX_LENGTH} characters`);
    expect(buildPrompt(10)).toContain('Give me 10 things to blame');
  });
});

describe('pickTopics fallback (#28)', () => {
  it('uses the pool when there is no api key', async () => {
    const { topics, source } = await pickTopics(5, {});
    expect(topics).toHaveLength(5);
    expect(source).toContain('fallback pool');
    for (const t of topics) expect(FALLBACK_POOL).toContain(t);
  });

  it('falls back to the pool rather than dying when gemini refuses', async () => {
    // 401 is a die-immediately status, so this exercises the fallback without the retry sleeps.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    try {
      const { topics, source } = await pickTopics(5, { GEMINI_API_KEY: 'not-a-real-key' });
      expect(topics).toHaveLength(5);
      expect(source).toContain('fallback pool');
      for (const t of topics) expect(FALLBACK_POOL).toContain(t);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tops up from the pool when the model returns too few usable targets', async () => {
    const reply = (arr: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(arr) }] } }] }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => reply(['loading spinners', 'damn printers'])));
    try {
      const { topics } = await pickTopics(4, { GEMINI_API_KEY: 'k' });
      expect(topics).toHaveLength(4); // 1 usable from the model, 3 from the pool
      expect(topics[0]).toBe('loading spinners');
      expect(topics).not.toContain('damn printers');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
