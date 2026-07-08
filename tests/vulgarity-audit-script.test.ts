import { describe, it, expect } from 'vitest';
import { judge, parseJudgeResponse, parseMtokIdentity } from '../scripts/vulgarity-audit.mjs';

const HOUSE = '0x3c1F928B7e685c84661A4296E2333FeDB9e1d06e';

describe('vulgarity audit mtok judge', () => {
  it('parses exact flagged labels from JSON only', () => {
    const labels = ['Boom Boom', 'Grandma'];
    const text = '```json\n{"vulgar":["Boom Boom","invented"]}\n```';

    expect(parseJudgeResponse(text, labels)).toEqual(['Boom Boom']);
  });

  it('buys one bounded draw from the house seller defaults', async () => {
    const calls: unknown[] = [];
    const fakeMtok = {
      fromIdentity: async (identity: unknown, opts: unknown) => ({
        identity: { address: HOUSE },
        async buy(opts2: unknown) {
          calls.push({ identity, opts, buy: opts2 });
          return {
            status: 'ok',
            completions: [{ choices: [{ message: { content: '{"vulgar":["Boom Boom"]}' } }] }],
          };
        },
      }),
    };

    const got = await judge(['Boom Boom', 'Grandma'], {
      env: { MTOK_IDENTITY_JSON: '{"agentId":"agt_4kq6eypt"}' },
      importMtok: async () => ({ Mtok: fakeMtok }),
    });

    expect(got).toEqual(['Boom Boom']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      opts: { apiBase: 'https://mtok.market/api', chainId: 8453 },
      buy: {
        model: '@cf/mistral/mistral-7b-instruct-v0.1',
        sellerId: 'agt_4kq6eypt',
        maxPrice: 0.5,
        budget: 0.005,
      },
    });
  });

  it('refuses to spend unless the identity derives the house seller wallet', async () => {
    const fakeMtok = {
      fromIdentity: async () => ({
        identity: { address: '0x0000000000000000000000000000000000000001' },
        async buy() {
          throw new Error('should not buy');
        },
      }),
    };

    await expect(judge(['Boom Boom'], {
      env: { MTOK_IDENTITY_JSON: '{}' },
      importMtok: async () => ({ Mtok: fakeMtok }),
    })).rejects.toThrow('does not match expected house seller wallet');
  });

  it('keeps the mtok identity secret parseable without logging it', () => {
    expect(parseMtokIdentity('{"agentId":"agt_4kq6eypt"}')).toEqual({ agentId: 'agt_4kq6eypt' });
    expect(() => parseMtokIdentity('not json')).toThrow('MTOK_IDENTITY_JSON must be a JSON mtok identity');
  });
});
