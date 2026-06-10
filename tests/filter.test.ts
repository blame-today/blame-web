import { describe, it, expect } from 'vitest';
import { checkContent, clip, isFoul, MAX_LENGTH } from '$lib/filter';

describe('checkContent', () => {
  it('allows clean topics', () => {
    for (const t of ['Mondays', 'CMBR', 'late stage capitalism', 'Daylight Saving Time', 'chronically online millennials']) {
      expect(checkContent(t)).toBeNull();
    }
  });

  it('blocks profanity including leetspeak and variants', () => {
    for (const t of ['shit', 'sh1t', 'fuuuck', 'this is fucking dumb', 'damnit', 'goddamn']) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });

  it('is Scunthorpe-safe (no false positives on innocent words)', () => {
    for (const t of ['class', 'Scunthorpe', 'grape', 'assassin', 'analysis']) {
      expect(checkContent(t)).toBeNull();
    }
  });

  it('blocks PII — emails and long digit runs', () => {
    expect(checkContent('me@example.com')).toBe('No PII!');
    expect(checkContent('call 5551234567')).toBe('No PII!');
    expect(checkContent('123456789')).toBe('No PII!');
  });

  it('blocks gibberish but allows acronyms and consonant-heavy words', () => {
    expect(checkContent('asdfghjkl')).toBe('Real words only!');
    expect(checkContent('fdajkdjkadkffadkjl')).toBe('Real words only!');
    expect(checkContent('CMBR')).toBeNull();
    expect(checkContent('strengths')).toBeNull();
  });

  it('rejects empty and over-length input', () => {
    expect(checkContent('')).toBe('Say something!');
    expect(checkContent('x'.repeat(MAX_LENGTH + 1))).toBe('Too long!');
  });
});

describe('clip', () => {
  it('leaves short text untouched', () => {
    expect(clip('Mondays')).toBe('Mondays');
    expect(clip('x'.repeat(MAX_LENGTH))).toBe('x'.repeat(MAX_LENGTH));
  });

  it('truncates over-length text to MAX_LENGTH with an ellipsis', () => {
    const long = 'x'.repeat(MAX_LENGTH + 10);
    const clipped = clip(long);
    expect(clipped.length).toBe(MAX_LENGTH);
    expect(clipped.endsWith('…')).toBe(true);
  });
});

describe('isFoul', () => {
  it('flags emails, long digit runs, and profanity in news text', () => {
    expect(isFoul('contact me@example.com')).toBe(true);
    expect(isFoul('order number 123456789012')).toBe(true);
    expect(isFoul('this headline is shit')).toBe(true);
    expect(isFoul('A perfectly normal headline today')).toBe(false);
  });

  it('is bounded against a giant headline (no ReDoS) (#5)', () => {
    const evil = 'The big news is ' + 'a'.repeat(60000); // long run, no "@"
    const t = Date.now();
    expect(isFoul(evil)).toBe(false);
    expect(Date.now() - t).toBeLessThan(100); // input is capped => fast
  });
});
