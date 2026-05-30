// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as secp from '@noble/secp256k1';
import { signEvent, nowSec } from '$lib/crypto';

describe('signEvent', () => {
  it('produces a well-formed NIP-01 event', async () => {
    const ev = await signEvent(7, '💥', [['e', 'abc'], ['t', 'pureblameapp']]);
    expect(ev.kind).toBe(7);
    expect(ev.content).toBe('💥');
    expect(ev.tags).toEqual([['e', 'abc'], ['t', 'pureblameapp']]);
    expect(ev.pubkey).toMatch(/^[0-9a-f]{64}$/); // 32-byte x-only pubkey
    expect(ev.id).toMatch(/^[0-9a-f]{64}$/); // sha256
    expect(ev.sig).toMatch(/^[0-9a-f]{128}$/); // 64-byte Schnorr sig
  });

  it('signs a verifiable BIP340 Schnorr signature over the id', async () => {
    const ev = await signEvent(1, 'Taxes', [['t', 'pureblameapp']]);
    const valid = await secp.schnorr.verify(ev.sig, ev.id, ev.pubkey);
    expect(valid).toBe(true);
  });

  it('uses a fresh ephemeral key on every call', async () => {
    const a = await signEvent(1, 'x', []);
    const b = await signEvent(1, 'x', []);
    expect(a.pubkey).not.toBe(b.pubkey);
  });
});

describe('nowSec', () => {
  it('returns whole unix seconds', () => {
    const n = nowSec();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(1_700_000_000);
  });
});
