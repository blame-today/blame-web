import { describe, it, expect } from 'vitest';
import { judge, mtokConfigFromEnv, parseJudgeResponse } from '../scripts/vulgarity-audit.mjs';

const HOUSE = '0x3c1F928B7e685c84661A4296E2333FeDB9e1d06e';

describe('vulgarity audit mtok judge', () => {
  it('parses flagged indexes and exact labels from JSON only', () => {
    const labels = ['Boom Boom', 'Grandma', 'Donkey Boy'];
    const text = '```json\n{"vulgar":[0,"2. Donkey Boy","invented"]}\n```';

    expect(parseJudgeResponse(text, labels)).toEqual(['Boom Boom', 'Donkey Boy']);
  });

  it('buys one bounded draw from the house seller defaults', async () => {
    const calls: unknown[] = [];
    const fakeMtok = {
      create: async (opts: unknown) => ({
        identity: { address: HOUSE },
        async buy(opts2: unknown) {
          calls.push({ opts, buy: opts2 });
          return {
            status: 'ok',
            completions: [{ choices: [{ message: { content: '{"vulgar":["Boom Boom"]}' } }] }],
          };
        },
      }),
    };

    const got = await judge(['Boom Boom', 'Grandma'], {
      env: { MTOK_EVM_PRIVATE_KEY: '0x' + '1'.repeat(64) },
      importMtok: async () => ({ Mtok: fakeMtok }),
    });

    expect(got).toEqual(['Boom Boom']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      opts: {
        apiBase: 'https://mtok.market/api',
        chainId: 8453,
        evmPrivateKey: '0x' + '1'.repeat(64),
        agentId: 'agt_4kq6eypt',
      },
      buy: {
        model: '@cf/mistralai/mistral-small-3.1-24b-instruct',
        sellerId: 'agt_4kq6eypt',
        maxPrice: 2.5,
        budget: 0.006,
      },
    });
  });

  it('chunks large label batches into separate tiny paid draws', async () => {
    const buys: unknown[] = [];
    const fakeMtok = {
      create: async () => ({
        identity: { address: HOUSE },
        async buy(opts: unknown) {
          buys.push(opts);
          return {
            status: 'ok',
            completions: [{ choices: [{ message: { content: buys.length === 1 ? '{"vulgar":[1]}' : '{"vulgar":[0]}' } }] }],
          };
        },
      }),
    };

    const got = await judge(['ok', 'Boom Boom', 'Donkey Boy'], {
      env: { MTOK_EVM_PRIVATE_KEY: '0x' + '1'.repeat(64), MTOK_CHUNK_SIZE: '2' },
      importMtok: async () => ({ Mtok: fakeMtok }),
    });

    expect(got).toEqual(['Boom Boom', 'Donkey Boy']);
    expect(buys).toHaveLength(2);
    expect(buys).toEqual([
      expect.objectContaining({ budget: 0.006, requests: [expect.objectContaining({ messages: [expect.objectContaining({ content: expect.stringContaining('1. Boom Boom') })] })] }),
      expect.objectContaining({ budget: 0.006, requests: [expect.objectContaining({ messages: [expect.objectContaining({ content: expect.stringContaining('0. Donkey Boy') })] })] }),
    ]);
  });

  it('skips a model with no offer under the price cap instead of discarding paid chunks', async () => {
    const buys: { model: string }[] = [];
    const fakeMtok = {
      create: async () => ({
        identity: { address: HOUSE },
        async buy(opts: { model: string }) {
          buys.push(opts);
          if (!opts.model.includes('mistral')) return { status: 'no_offers', model: opts.model, maxPrice: 2.5 };
          return { status: 'ok', completions: [{ choices: [{ message: { content: '{"vulgar":[0]}' } }] }] };
        },
      }),
    };

    const got = await judge(['Boom Boom', 'Donkey Boy'], {
      env: { MTOK_EVM_PRIVATE_KEY: '0x' + '1'.repeat(64), MTOK_CHUNK_SIZE: '1' },
      importMtok: async () => ({ Mtok: fakeMtok }),
    });

    expect(got).toEqual(['Boom Boom', 'Donkey Boy']);
    expect(buys.map((b) => b.model.split('/').pop())).toEqual([
      'mistral-small-3.1-24b-instruct',
      'llama-3.3-70b-instruct-fp8-fast', 'qwen2.5-coder-32b-instruct', 'mistral-small-3.1-24b-instruct',
    ]);
  });

  it('still fails the mtok path when no model in the mix has an offer', async () => {
    const fakeMtok = {
      create: async () => ({
        identity: { address: HOUSE },
        async buy(opts: { model: string }) { return { status: 'no_offers', model: opts.model }; },
      }),
    };
    const logged: string[] = [];
    const err = console.error;
    console.error = (m: string) => { logged.push(String(m)); };
    try {
      // no GEMINI_API_KEY, so the fallback itself fails: what matters is that mtok gave up with no_offers
      await judge(['Boom Boom'], {
        env: { MTOK_EVM_PRIVATE_KEY: '0x' + '1'.repeat(64) },
        importMtok: async () => ({ Mtok: fakeMtok }),
      }).catch(() => {});
    } finally {
      console.error = err;
    }
    expect(logged.some((m) => m.includes('mtok buy failed: no_offers'))).toBe(true);
  });

  it('refuses to spend unless the buyer key derives the house seller wallet', async () => {
    const fakeMtok = {
      create: async () => ({
        identity: { address: '0x0000000000000000000000000000000000000001' },
        async buy() {
          throw new Error('should not buy');
        },
      }),
    };

    await expect(judge(['Boom Boom'], {
      env: { MTOK_EVM_PRIVATE_KEY: '0x' + '2'.repeat(64) },
      importMtok: async () => ({ Mtok: fakeMtok }),
    })).rejects.toThrow('buyer wallet');
  });

  it('can still restore a full mtok identity JSON fallback', () => {
    expect(mtokConfigFromEnv({ MTOK_IDENTITY_JSON: '{"agentId":"agt_4kq6eypt"}' })).toEqual({
      method: 'fromIdentity',
      identity: { agentId: 'agt_4kq6eypt' },
      opts: { apiBase: 'https://mtok.market/api', chainId: 8453 },
    });
    expect(() => mtokConfigFromEnv({ MTOK_IDENTITY_JSON: 'not json' })).toThrow('MTOK_IDENTITY_JSON must be a JSON mtok identity');
  });
});
