// The "News" tab: pull today's headlines from a CORS-open source, mine them for blameable entities
// with compromise (lazy-loaded only when the tab is opened), and rank them by how many headlines
// mention each one. Clicking +1 on one votes it like anything else.
//
// Sources are tried in order until one answers with headlines (CNN Lite, then Fox as a backup —
// the only two of the usual suspects that send permissive CORS headers to a browser). It's just a
// typing-saver, so we're gentle: fetched once, cached, manual refresh locked for 24h. Foul
// headlines are dropped wholesale so nothing crude is ever surfaced.
import { checkContent, isFoul } from './filter';
import type { NewsItem } from './types';

const CACHE_KEY = 'blm_news';
const MAX_HEADLINES = 90;
const MAX_ITEMS = 30;
export const REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000; // refresh at most once a day

export type Headline = { title: string; url: string };
type Source = { name: string; feed: string; site: string; parse: (text: string) => Headline[] };

// A tiny structural slice of compromise's API — all we use.
type NlpDoc = { people(): NlpDoc; organizations(): NlpDoc; places(): NlpDoc; match(pattern: string): NlpDoc; out(fmt: 'array'): string[] };
export type Nlp = (text: string) => NlpDoc;

export const news = $state<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: NewsItem[];
  error: string;
  fetchedAt: number;
  source: { name: string; url: string };
}>({
  status: 'idle',
  items: [],
  error: '',
  fetchedAt: 0,
  source: { name: '', url: '' },
});

export function nextRefreshAt(): number {
  return news.fetchedAt + REFRESH_COOLDOWN_MS;
}
export function canRefresh(): boolean {
  return Date.now() >= nextRefreshAt();
}

const headlineish = (title: string) => title.length >= 25 && title.split(' ').length >= 4;

// CNN Lite is plain HTML — pull headline-ish anchor text + absolutize the relative urls.
export function parseCnnLite(html: string): Headline[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set<string>();
  const out: Headline[] = [];
  for (const a of Array.from(doc.querySelectorAll('a'))) {
    const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!headlineish(title) || seen.has(title)) continue;
    seen.add(title);
    if (isFoul(title)) continue; // no crude headlines on the board, ever
    let href = a.getAttribute('href') || '';
    if (href.startsWith('/')) href = 'https://lite.cnn.com' + href;
    if (!/^https?:\/\//.test(href)) href = 'https://lite.cnn.com/';
    out.push({ title, url: href });
    if (out.length >= MAX_HEADLINES) break;
  }
  return out;
}

// Generic RSS/Atom parser — <item>/<entry> title + link.
export function parseRss(xml: string): Headline[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const seen = new Set<string>();
  const out: Headline[] = [];
  for (const item of Array.from(doc.querySelectorAll('item, entry'))) {
    const title = (item.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!headlineish(title) || seen.has(title)) continue;
    seen.add(title);
    if (isFoul(title)) continue;
    const link = item.querySelector('link');
    let url = link?.textContent?.trim() || link?.getAttribute('href')?.trim() || item.querySelector('guid')?.textContent?.trim() || '';
    if (!/^https?:\/\//.test(url)) continue;
    out.push({ title, url });
    if (out.length >= MAX_HEADLINES) break;
  }
  return out;
}

// Tried in order; the first that returns headlines wins. `feed` is what we fetch, `site` is the
// human-friendly page we credit/link to.
const SOURCES: Source[] = [
  { name: 'CNN Lite', feed: 'https://lite.cnn.com/', site: 'https://lite.cnn.com/', parse: parseCnnLite },
  { name: 'Fox News', feed: 'https://moxie.foxnews.com/google-publisher/latest.xml', site: 'https://www.foxnews.com/', parse: parseRss },
];

// Strip trailing possessives ("Iran's" -> "Iran") and stray edge punctuation so variants merge.
export function cleanEntity(raw: string): string {
  let t = (raw || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/(?:[’'`]s|[.,;:!?"“”])+$/giu, ''); // trailing 's / punctuation, repeated
  t = t.replace(/^[.,;:!?"“”'’`]+/u, '');
  return t.trim();
}

// Extract people / orgs / places from each headline, count headline mentions, rank by heat.
export function extractItems(headlines: Headline[], nlp: Nlp): NewsItem[] {
  const map = new Map<string, NewsItem>();
  for (const h of headlines) {
    let ents: string[] = [];
    try {
      const d = nlp(h.title);
      // people/orgs/places catch most entities; #ProperNoun also catches the ones compromise's NER
      // misses — notably lone surnames like "Trump" that it tags as a plain noun or adjective.
      ents = [...d.people().out('array'), ...d.organizations().out('array'), ...d.places().out('array'), ...d.match('#ProperNoun+').out('array')];
    } catch {
      continue;
    }
    const inThis = new Set<string>(); // count each entity at most once per headline
    for (const raw of ents) {
      const text = cleanEntity(raw);
      const key = text.toLowerCase();
      if (text.length < 3 || text.length > 35) continue;
      if (inThis.has(key)) continue;
      if (checkContent(text)) continue; // profanity / PII / gibberish never becomes a suggestion
      inThis.add(key);
      const existing = map.get(key);
      if (existing) existing.mentions += 1;
      else map.set(key, { text, mentions: 1, url: h.url, headline: h.title });
    }
  }
  return [...map.values()].sort((a, b) => b.mentions - a.mentions).slice(0, MAX_ITEMS);
}

function restoreCache(): void {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && Array.isArray(c.items) && typeof c.fetchedAt === 'number') {
      news.items = c.items;
      news.fetchedAt = c.fetchedAt;
      news.source = c.source || { name: SOURCES[0].name, url: SOURCES[0].site };
      news.status = 'ready';
    }
  } catch {}
}
function saveCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ items: news.items, fetchedAt: news.fetchedAt, source: news.source }));
  } catch {}
}

// Lazy entry point. First call restores the cache; only fetches when there's nothing cached, or on
// a forced refresh once the 24h cooldown has elapsed. Sources are tried in order until one answers.
export async function loadNews(force = false): Promise<void> {
  if (news.status === 'idle') restoreCache();
  if (news.status === 'loading') return;
  if (!force && news.status === 'ready') return; // already have a list — never auto-refresh
  if (force && !canRefresh()) return; // still cooling down
  news.status = 'loading';
  news.error = '';
  try {
    let headlines: Headline[] = [];
    let used: Source | null = null;
    const failures: string[] = [];
    for (const src of SOURCES) {
      try {
        const res = await fetch(src.feed);
        if (!res.ok) {
          failures.push(`${src.name}: HTTP ${res.status}`);
          continue;
        }
        const parsed = src.parse(await res.text());
        if (parsed.length) {
          headlines = parsed;
          used = src;
          break;
        }
        failures.push(`${src.name}: no headlines`);
      } catch {
        failures.push(`${src.name}: unreachable`); // CORS / network — move on to the next source
      }
    }
    if (!used || !headlines.length) throw new Error(failures.join(' · ') || 'no sources');
    const nlp = (await import('compromise')).default as unknown as Nlp;
    news.items = extractItems(headlines, nlp);
    news.source = { name: used.name, url: used.site };
    news.fetchedAt = Date.now();
    news.status = 'ready';
    saveCache();
  } catch (e) {
    news.error = e instanceof Error ? e.message : String(e);
    news.status = news.items.length ? 'ready' : 'error'; // keep a cached list if a refresh fails
  }
}
