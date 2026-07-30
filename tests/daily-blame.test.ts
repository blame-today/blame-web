import { describe, it, expect, vi } from 'vitest';
import { FALLBACK_POOL, buildPrompt, pickN, pickPileOn, pickTopics, screenPileOn, validate } from '../scripts/daily-blame.mjs';
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

// The amplify screen. checkContent decides what a PERSON may post; this decides what the BOT may
// pile votes onto, which is a higher bar. A live board draw offered "the jews" and "Putin", both
// clean by checkContent, which is why this exists.
describe('amplify screen (#28)', () => {
  const board = (entries: string[]) => new Map(entries.map((t, i) => [t.toLowerCase(), { id: 'id' + i, at: 1000 + i, text: t }]));

  it('only picks entries the screen approved', () => {
    const got = pickPileOn(board(['traffic lights', 'Putin', 'the jews', 'printers']), 4, ['traffic lights', 'printers']);
    expect(got.sort()).toEqual(['printers', 'traffic lights']);
  });

  it('picks nothing when the screen approved nothing, rather than falling back to unscreened', () => {
    expect(pickPileOn(board(['Putin', 'the jews']), 4, [])).toEqual([]);
  });

  it('still applies checkContent on top of the screen', () => {
    // A target that predates a filter tightening is still sitting on the board. Even an approval
    // must not get it re-promoted.
    const got = pickPileOn(board(['damn printers', 'traffic lights']), 4, ['damn printers', 'traffic lights']);
    expect(got).toEqual(['traffic lights']);
  });

  it('prefers the recent end of the board, since those are the topical ones', () => {
    const old = { id: 'a', at: 1, text: 'ancient gripe' };
    const fresh = { id: 'b', at: 9999, text: 'todays gripe' };
    const m = new Map([
      ['ancient gripe', old],
      ['todays gripe', fresh],
    ]);
    const got = pickPileOn(m, 1, ['ancient gripe', 'todays gripe'], 1); // window of 1 = newest only
    expect(got).toEqual(['todays gripe']);
  });

  it('fails CLOSED when the screening call errors, so an outage means no pile-on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    try {
      expect(await screenPileOn(['traffic lights'], 'k', vi.fn(async () => new Response('nope', { status: 401 })))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails closed with no api key at all', async () => {
    expect(await screenPileOn(['traffic lights'], undefined)).toEqual([]);
  });

  it('resolves approvals by index into our own list, so the model cannot approve a string we never showed it', async () => {
    const reply = (v: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(v) }] } }] }), { status: 200 });
    const got = await screenPileOn(['traffic lights', 'Putin'], 'k', vi.fn(async () => reply([1, 99, 'the jews'])));
    expect(got).toEqual(['traffic lights']); // 99 out of range and the raw string both dropped
  });
});

describe('the day mix (#28)', () => {
  it('splits the picks between the board and fresh material', async () => {
    const reply = (arr: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(arr) }] } }] }), { status: 200 });
    const boardMap = new Map(['printers', 'traffic lights', 'rainy weekends'].map((t, i) => [t, { id: 'i' + i, at: i, text: t }]));
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++;
        return call === 1 ? reply([1, 2, 3]) : reply(['wet socks', 'empty fridge', 'printer jams']); // screen, then fresh
      }),
    );
    try {
      const { topics, source } = await pickTopics(4, { GEMINI_API_KEY: 'k', PILE_ON: '2' }, boardMap);
      expect(topics).toHaveLength(4);
      expect(topics.filter((t) => boardMap.has(t))).toHaveLength(2);
      expect(source).toContain('2 from the board');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
