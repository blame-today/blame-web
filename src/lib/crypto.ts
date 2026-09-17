import * as secp from '@noble/secp256k1';
import type { NostrEvent } from './types';

const enc = new TextEncoder();
const toHex = (u8: Uint8Array): string => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as NostrEvent;
  return typeof e.id === 'string' && /^[a-f0-9]{64}$/.test(e.id)
    && typeof e.pubkey === 'string' && /^[a-f0-9]{64}$/.test(e.pubkey)
    && typeof e.sig === 'string' && /^[a-f0-9]{128}$/.test(e.sig)
    && Number.isSafeInteger(e.created_at) && e.created_at >= 0
    && Number.isSafeInteger(e.kind) && e.kind >= 0
    && typeof e.content === 'string'
    && Array.isArray(e.tags) && e.tags.every(tag => Array.isArray(tag) && tag.every(part => typeof part === 'string'));
}

export async function verifyEvent(event: NostrEvent): Promise<boolean> {
  try {
    const raw = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
    const hash = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(raw))));
    return hash === event.id && await secp.schnorr.verify(event.sig, event.id, event.pubkey);
  } catch { return false; }
}

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
