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
        model: '@cf/mistral/mistral-7b-instruct-v0.1',
        sellerId: 'agt_4kq6eypt',
        maxPrice: 0.5,
        budget: 0.005,
      },
    });
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
