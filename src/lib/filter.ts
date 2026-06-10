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

// Invisible characters (zero-width space/joiner/non-joiner, word-joiner, BOM, soft
// hyphen) are never legit in a blame or a headline — their only job here is
// splitting a curse word so the matcher can't see it. Strip them up front.
const INVISIBLES_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

// "f u c k" / "f.u.c.k" defeats obscenity (it sees lone letters). Collapse runs of
// 3+ SINGLE-char tokens into one word and re-check only that. Deliberately NOT an
// all-separator collapse: "mass hit parade" must not become "masshitparade" (a
// cross-word false positive); single-char-token runs don't occur in legit text.
// \b-anchored so the run is made of WHOLE single-char tokens: in "the s h i t hit"
// it grabs exactly "s h i t" (not the glued "e s h i t h" -> "eshith").
const SPACED_RUN_RE = /\b(?:[a-z0-9][ .\-_*]){2,}[a-z0-9]\b/gi;

function hasProfanity(txt: string): boolean {
  if (PROFANITY.hasMatch(txt)) return true;
  const collapsed = txt.replace(SPACED_RUN_RE, (m) => m.replace(/[ .\-_*]/g, ''));
  return collapsed !== txt && PROFANITY.hasMatch(collapsed);
}

// Foul language or PII in arbitrary text (e.g. a news headline), independent of length/gibberish —
// checkContent can't be used there since real headlines always blow the length cap.
export function isFoul(txt: string): boolean {
  // Cap the input first: EMAIL_RE is O(n^2) on a long no-"@" run and isFoul runs
  // on uncapped news text, so a giant headline could freeze the tab. A real
  // headline is far under 500 chars. (#5)
  const t = (txt.length > 500 ? txt.slice(0, 500) : txt).replace(INVISIBLES_RE, '');
  return EMAIL_RE.test(t) || (t.match(/\d/g) || []).length >= 9 || hasProfanity(t);
}

// Returns null when clean, else a short fiery reason string.
export function checkContent(txt: string): string | null {
  const t = txt.replace(INVISIBLES_RE, '');
  if (!t) return 'Say something!';
  if (t.length > MAX_LENGTH) return 'Too long!';
  if (EMAIL_RE.test(t) || (t.match(/\d/g) || []).length >= 7) return 'No PII!'; // email / phone / SSN / card / IP
  if (hasProfanity(t)) return 'No bad words!';
  for (const w of t.toLowerCase().split(/[^a-z0-9]+/)) if (w && (looksGibberish(w) || looksKeyboardMash(w))) return 'Real words only!';
  return null;
}

// Keyboard-walk mash ("qwerty", "asdfasdf", "qazwsx") that the vowel/consonant
// heuristic below can't see. Bake-offed 2026-06-09 against the npm options:
// gibberish-detective (markov, sherlock-holmes-trained) catches the same mash
// but false-positives on 17/49 REAL topics (trump, taxes, GOP, tiktok...), so
// we stay heuristic. Flags: whole-token contiguous keyboard walks (fwd/rev) of
// 5+, the classic 4-char clusters, and 2x+ repetitions of a 3-5 char walk
// chunk ("qweqwe", "wasdwasd"). "wert"/"property"/"salad"/"haha" all pass.
const KEY_WALKS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'qazwsxedcrfvtgbyhnujmikolp', 'wasd'];
const MASH4 = new Set(['asdf', 'wasd', 'hjkl', 'zxcv', 'uiop', 'qwer', 'sdfg']);
const reverse = (s: string) => [...s].reverse().join('');
function isKeyRun(s: string): boolean {
  return s.length >= 3 && KEY_WALKS.some((row) => row.includes(s) || row.includes(reverse(s)));
}
function looksKeyboardMash(tok: string): boolean {
  if (tok.length === 4 && (MASH4.has(tok) || MASH4.has(reverse(tok)))) return true;
  if (tok.length >= 5 && isKeyRun(tok)) return true;
  const m = tok.match(/^(.{3,5})\1+$/);
  return !!(m && (isKeyRun(m[1]) || MASH4.has(m[1])));
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
