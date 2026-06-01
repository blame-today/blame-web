import { describe, it, expect } from 'vitest';
import nlp from 'compromise';
import { cleanEntity, parseCnnLite, parseRss, extractItems, news, canRefresh, REFRESH_COOLDOWN_MS, type Nlp } from '$lib/news.svelte';

describe('cleanEntity', () => {
  it('strips trailing possessives and edge punctuation so variants merge', () => {
    expect(cleanEntity("Iran's")).toBe('Iran');
    expect(cleanEntity('America’s')).toBe('America');
    expect(cleanEntity('Dulles Airport,')).toBe('Dulles Airport');
    expect(cleanEntity('  NATO  ')).toBe('NATO');
    expect(cleanEntity('“Hawaii”')).toBe('Hawaii');
  });

  it('leaves mid-phrase possessives intact', () => {
    expect(cleanEntity("Alaska's Mount McKinley")).toBe("Alaska's Mount McKinley");
  });

  it('strips curly single quotes left on quoted-phrase fragments (the ‘Highway / Hel’ bug)', () => {
    expect(cleanEntity('‘Highway')).toBe('Highway'); // leading curly-left quote (U+2018)
    expect(cleanEntity('Hel’')).toBe('Hel');         // trailing curly-right quote (U+2019)
    expect(cleanEntity("'Highway")).toBe('Highway'); // straight leading
    expect(cleanEntity("Hel'")).toBe('Hel');         // straight trailing
  });
});

describe('parseCnnLite', () => {
  it('keeps long multi-word links, de-dupes, and absolutizes urls', () => {
    const html = `<html><body>
      <a href="/2026/01/01/x">Judge says Trump cannot add his name to the Kennedy Center</a>
      <a href="/2026/01/01/x">Judge says Trump cannot add his name to the Kennedy Center</a>
      <a href="https://lite.cnn.com/y">Five people dead after a bus hits cars on a Virginia interstate</a>
      <a href="/z">Short</a>
      <a href="/nav">Home Page</a>
    </body></html>`;
    const out = parseCnnLite(html);
    expect(out).toHaveLength(2); // dup + short + too-few-words dropped
    expect(out[0].url).toBe('https://lite.cnn.com/2026/01/01/x');
    expect(out[1].url).toBe('https://lite.cnn.com/y');
  });

  it('drops foul headlines wholesale', () => {
    const html = `<html><body>
      <a href="/a">A perfectly ordinary and clean news headline about policy</a>
      <a href="/b">Politician calls them shithole countries during a long speech</a>
    </body></html>`;
    const out = parseCnnLite(html);
    expect(out).toHaveLength(1);
    expect(out[0].title).toMatch(/perfectly ordinary/);
  });
});

describe('parseRss', () => {
  it('extracts item title + link, de-dupes, drops short/foul', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>NATO allies meet in Brussels to discuss the drone threat</title><link>https://www.foxnews.com/a</link></item>
      <item><title>NATO allies meet in Brussels to discuss the drone threat</title><link>https://www.foxnews.com/a</link></item>
      <item><title>Politician calls them shithole countries in a long speech today</title><link>https://www.foxnews.com/b</link></item>
      <item><title>Short title</title><link>https://www.foxnews.com/c</link></item>
    </channel></rss>`;
    const out = parseRss(xml);
    expect(out).toHaveLength(1); // dup + foul + too-short dropped
    expect(out[0].url).toBe('https://www.foxnews.com/a');
    expect(out[0].title).toMatch(/^NATO allies/);
  });
});

describe('refresh cooldown', () => {
  it('locks refresh within 24h and frees it afterward', () => {
    news.fetchedAt = Date.now();
    expect(canRefresh()).toBe(false);
    news.fetchedAt = Date.now() - REFRESH_COOLDOWN_MS - 1000;
    expect(canRefresh()).toBe(true);
    news.fetchedAt = 0; // never fetched yet
    expect(canRefresh()).toBe(true);
  });
});

// A stub nlp so we test our aggregation/cleanup/ranking deterministically, independent of
// compromise's (finicky) NER. Maps each headline title to the entities it should "yield".
function stubNlp(byTitle: Record<string, { people?: string[]; orgs?: string[]; places?: string[]; proper?: string[] }>): Nlp {
  return ((title: string) => {
    const e = byTitle[title] || {};
    const arr = (a?: string[]) => ({ out: () => a || [] });
    return { people: () => arr(e.people), organizations: () => arr(e.orgs), places: () => arr(e.places), match: () => arr(e.proper) };
  }) as unknown as Nlp;
}

describe('extractItems', () => {
  it('aggregates mentions, merges cleaned variants, filters junk, ranks by heat', () => {
    const nlpStub = stubNlp({
      h1: { people: ['Reid Hoffman'], places: ['Iran'], orgs: ['NATO'] },
      h2: { places: ["Iran's"], orgs: ['NATO'] }, // Iran's -> Iran (merge); NATO again
      h3: { places: ['Iran'], orgs: ['NATO', 'shit'] }, // profanity dropped; Iran again
    });
    const items = extractItems([
      { title: 'h1', url: 'u1' },
      { title: 'h2', url: 'u2' },
      { title: 'h3', url: 'u3' },
    ], nlpStub);

    const m = Object.fromEntries(items.map((i) => [i.text, i.mentions]));
    expect(m['NATO']).toBe(3); // every headline
    expect(m['Iran']).toBe(3); // Iran + Iran's + Iran all merge
    expect(m['Reid Hoffman']).toBe(1);
    expect(items.some((i) => i.text.toLowerCase() === 'shit')).toBe(false); // profanity filtered
    expect(items.find((i) => i.text === 'Iran')!.url).toBe('u1'); // first source kept
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].mentions).toBeGreaterThanOrEqual(items[i].mentions); // descending heat
    }
  });

  it('counts an entity once per headline even if it appears in two categories', () => {
    const nlpStub = stubNlp({ h1: { places: ['Texas'], orgs: ['Texas'], proper: ['Texas'] } });
    const items = extractItems([{ title: 'h1', url: 'u1' }], nlpStub);
    expect(items.find((i) => i.text === 'Texas')!.mentions).toBe(1);
  });

  it('picks up proper nouns the NER misses (e.g. lone surnames like Trump)', () => {
    const nlpStub = stubNlp({
      h1: { proper: ['Trump'] }, // tagged ProperNoun/Noun, never a Person
      h2: { places: ['Iran'], proper: ['Trump', 'Iran'] },
    });
    const items = extractItems([{ title: 'h1', url: 'u1' }, { title: 'h2', url: 'u2' }], nlpStub);
    const m = Object.fromEntries(items.map((i) => [i.text, i.mentions]));
    expect(m['Trump']).toBe(2); // caught in both headlines via #ProperNoun
    expect(m['Iran']).toBe(1); // place + proper in h2 -> still once per headline
  });

  it('wires up the real compromise library', () => {
    const items = extractItems([{ title: 'Kenya and NATO clash over policy in Brussels this week', url: 'a' }], nlp as unknown as Nlp);
    expect(items.map((i) => i.text.toLowerCase())).toContain('kenya');
  });

  // 'Highway to Hel' bug (#198): a quoted phrase is one named thing, not separate entities.
  const helHeadline = 'Poland revives its ‘Highway to Hel’ 666 bus route';

  it('does not split a quoted phrase into bare fragments (negative)', () => {
    const texts = extractItems([{ title: helHeadline, url: 'u' }], nlp as unknown as Nlp).map((i) => i.text);
    expect(texts).not.toContain('Highway'); // bare fragment of the quoted phrase
    expect(texts).not.toContain('Hel');     // bare fragment of the quoted phrase
  });

  it('keeps a quoted phrase as one votable item (positive)', () => {
    const texts = extractItems([{ title: helHeadline, url: 'u' }], nlp as unknown as Nlp).map((i) => i.text);
    expect(texts).toContain('Highway to Hel');
  });
});
