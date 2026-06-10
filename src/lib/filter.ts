import { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers, pattern } from 'obscenity';

export const MAX_LENGTH = 35;

// Mild terms obscenity's dataset omits but we still want blocked — a deliberate short supplement.
const EXTRA = ['damn'];

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const dataset = EXTRA.reduce(
  (ds, word) => ds.addPhrase((phrase) => phrase.setMetadata({ originalWord: word }).addPattern(pattern`${word}`)),
  new DataSet<{ originalWord: string }>().addAll(englishDataset),
);
const PROFANITY = new RegExpMatcher({ ...dataset.build(), ...englishRecommendedTransformers });

// Foul language or PII in arbitrary text (e.g. a news headline), independent of length/gibberish —
// checkContent can't be used there since real headlines always blow the length cap.
export function isFoul(txt: string): boolean {
  // Cap the input first: EMAIL_RE is O(n^2) on a long no-"@" run and isFoul runs
  // on uncapped news text, so a giant headline could freeze the tab. A real
  // headline is far under 500 chars. (#5)
  const t = txt.length > 500 ? txt.slice(0, 500) : txt;
  return EMAIL_RE.test(t) || (t.match(/\d/g) || []).length >= 9 || PROFANITY.hasMatch(t);
}

// Returns null when clean, else a short fiery reason string.
export function checkContent(txt: string): string | null {
  if (!txt) return 'Say something!';
  if (txt.length > MAX_LENGTH) return 'Too long!';
  if (EMAIL_RE.test(txt) || (txt.match(/\d/g) || []).length >= 7) return 'No PII!'; // email / phone / SSN / card / IP
  if (PROFANITY.hasMatch(txt)) return 'No bad words!';
  for (const w of txt.toLowerCase().split(/[^a-z0-9]+/)) if (w && looksGibberish(w)) return 'Real words only!';
  return null;
}

// Basic keyboard-mash detector: lenient for acronyms (CMBR) and proper nouns.
function looksGibberish(tok: string): boolean {
  if (tok.length < 5) return false;
  if (/(.)\1\1\1/.test(tok)) return true; // 4+ of the same char in a row
  if (/[bcdfghjklmnpqrstvwxz]{6,}/.test(tok)) return true; // 6+ consonants in a row
  if (tok.length >= 6 && !/[aeiouy]/.test(tok)) return true; // longish with zero vowels
  if (tok.length >= 10 && (tok.match(/[aeiouy]/g) || []).length / tok.length < 0.25) return true; // long, vowel-starved
  return false;
}

export function clip(s: string): string {
  return s.length > MAX_LENGTH ? s.slice(0, MAX_LENGTH - 1) + '…' : s;
}
