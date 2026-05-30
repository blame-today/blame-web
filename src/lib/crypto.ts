import * as secp from '@noble/secp256k1';
import type { NostrEvent } from './types';

const enc = new TextEncoder();
const toHex = (u8: Uint8Array): string => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

export const nowSec = (): number => Math.floor(Date.now() / 1000);

// Build + sign a Nostr event with a throwaway key (NIP-01 id + BIP340 Schnorr).
// The signature is the relays' price of admission, not identity — hence infinite votes.
export async function signEvent(kind: number, content: string, tags: string[][]): Promise<NostrEvent> {
  const sk = secp.utils.randomPrivateKey();
  const pubkey = toHex(secp.schnorr.getPublicKey(sk));
  const created_at = nowSec();
  const raw = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(raw));
  const id = toHex(new Uint8Array(hash));
  const sig = toHex(await secp.schnorr.sign(id, sk));
  return { id, pubkey, created_at, kind, content, tags, sig };
}
