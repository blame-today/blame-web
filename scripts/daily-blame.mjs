// daily-blame.mjs — the daily seeding run for blame.today, moved off a personal machine's
// crontab and into CI (#28). Picks the day's targets, casts a random pile of votes on each,
// and publishes anonymous throwaway-keyed Nostr events across all the relays.
//
// Half the day's picks pile onto targets ALREADY on the board so it gets deeper and not only
// wider; the rest are fresh. Same split as the vulgarity audit otherwise: the MODEL decides WHAT
// to blame, deterministic code decides HOW it reaches the board. Gemini proposes the targets; nothing it proposes is trusted. Every
// one is validated by the SHIPPED filter (imported straight from src/lib/filter.ts, so there is
// zero drift between what this posts and what the board would accept from a human), and gemini
// being down or rate limited just falls back to the static pool.
//
// Signing (src/lib/crypto.ts) and the relay list + tag (src/lib/relays.ts) are imported for the
// same reason: one copy of each, not a second one here quietly going stale.
//
// Env: GEMINI_API_KEY (optional, without it the run uses the fallback pool), TOPICS (default 10),
// PILE_ON (default half of TOPICS, how many picks come from targets already on the board),
// MAX_VOTES (default 67), DRY_RUN=1 to pick and validate without publishing anything.
// Needs Node 24+ (imports the .ts modules via type stripping) and a native global WebSocket.
//
// Exit codes: 0 = ran clean, 1 = error.
import { checkContent, MAX_LENGTH } from '../src/lib/filter.ts';
import { signEvent } from '../src/lib/crypto.ts';
import { RELAYS, TAG } from '../src/lib/relays.ts';

const TOPICS = Number(process.env.TOPICS || 10);
const MAX_VOTES = Number(process.env.MAX_VOTES || 67);
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// The pool the machine cron ran off since June, kept as the fallback so a gemini outage is a
// duller run and not a dead one. Two entries are reworded from the original: both were 36 chars,
// one over MAX_LENGTH, so the cron had been posting targets the composer would have REFUSED from
// a human. The pool-passes-the-filter test in tests/daily-blame.test.ts is what caught that, and
// is why it exists. (#28)
export const FALLBACK_POOL = [
  'random MCP servers',
  'Wi-Fi dropping at the worst moment',
  'Monday mornings',
  'autocorrect',
  'loading spinners',
  'printers',
  'the spinning beach ball',
  'low battery at 1%',
  'cookie consent banners',
  'buffering',
  'CAPTCHAs that think I am a robot',
  'tangled earbuds',
  'the snooze button',
  'software updates at the worst time',
  'merge conflicts',
  '404 errors',
  'AI that starts with "As an AI"',
  'slow elevators',
  'rainy weekends',
  'Friday afternoon traffic',
  'movie spoilers',
  'robocalls',
  'the cloud being down',
  '200 unread group chat messages',
];

const log = (...a) => console.log('daily-blame:', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pickN(arr, n, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export function buildPrompt(n) {
  return `Give me ${n} things to blame for a bad day, for a public humor board.

Rules, all of them hard:
- Everyday universal annoyances only. Objects, software, weather, chores, small daily frustrations.
- Under ${MAX_LENGTH} characters each. Shorter is better.
- No people. No public figures, politicians, parties, companies by name, or anyone real.
- Nothing political, sexual, crude, medical, or mean about any group.
- Funny because it is relatable, not because it is edgy.
- No hashtags, no quotes, no numbering, no emoji.

Good: "loading spinners", "the snooze button", "socks that vanish in the wash"
Bad: anything naming a person, anything political, anything crude.

Return ONLY a JSON array of strings, nothing else.`;
}

// Nothing the model returns reaches a relay unvalidated. checkContent is the SAME function the
// composer runs on a human's blame, so a generated target can never be something the board itself
// would have rejected. Dupes and over-length are dropped here too, not "fixed", because a silently
// truncated target is a different target.
export function validate(raw) {
  const kept = [];
  const rejected = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const t = typeof item === 'string' ? item.trim() : '';
    const key = t.toLowerCase();
    const why = !t ? 'empty' : seen.has(key) ? 'duplicate' : checkContent(t);
    if (why) rejected.push({ text: t, why });
    else {
      seen.add(key);
      kept.push(t);
    }
  }
  return { kept, rejected };
}

async function geminiTopics(n, key, fetchImpl = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  // Same retry shape as the vulgarity audit: back off on transient overload, die on a bad key.
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(n * 2) }] }], // ask for extra; validation culls some
        generationConfig: { temperature: 1.0, responseMimeType: 'application/json' },
      }),
    });
    if (res.ok) {
      const body = await res.json();
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      return JSON.parse(text);
    }
    if (![429, 500, 503].includes(res.status)) throw new Error(`gemini HTTP ${res.status}`);
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error('gemini still overloaded after 4 attempts');
}

// Pull the targets already on the board, for two jobs: piling onto one instead of posting a
// duplicate, and supplying the pile-on half of the day's picks (see pickPileOn).
export function listTargets(timeoutMs = 8000, WS = WebSocket) {
  return new Promise((resolve) => {
    const map = new Map(); // normalized content -> { id, at, text }
    let ws;
    const done = () => {
      try {
        ws?.close();
      } catch {}
      resolve(map);
    };
    try {
      ws = new WS('wss://nos.lol');
    } catch {
      return resolve(map);
    }
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'l', { kinds: [1], '#t': [TAG], limit: 500 }]));
    ws.onmessage = (m) => {
      let p;
      try {
        p = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data));
      } catch {
        return;
      }
      if (p[0] === 'EVENT') {
        const text = (p[2]?.content || '').trim();
        const c = text.toLowerCase();
        if (c && !map.has(c)) map.set(c, { id: p[2].id, at: p[2].created_at || 0, text });
      }
      if (p[0] === 'EOSE') done();
    };
    ws.onerror = done;
    setTimeout(done, timeoutMs);
  });
}

// One socket per relay, sends spaced out so we don't trip rate limits, then close.
function publishAll(events, spacingMs = 25, WS = WebSocket) {
  return new Promise((resolve) => {
    let pending = RELAYS.length;
    const finishOne = () => {
      if (--pending <= 0) resolve();
    };
    for (const url of RELAYS) {
      let ws;
      try {
        ws = new WS(url);
      } catch {
        finishOne();
        continue;
      }
      ws.onopen = () => {
        let i = 0;
        const tick = () => {
          if (i >= events.length) {
            setTimeout(() => {
              try {
                ws.close();
              } catch {}
              finishOne();
            }, 800);
            return;
          }
          try {
            ws.send(JSON.stringify(['EVENT', events[i++]]));
          } catch {}
          setTimeout(tick, spacingMs);
        };
        tick();
      };
      ws.onerror = finishOne;
      setTimeout(() => {
        try {
          ws.close();
        } catch {}
        finishOne();
      }, 60000);
    }
  });
}

// Half the day's picks pile onto things ALREADY on the board instead of inventing yet another
// target (Roy's call, 2026-07-30). Without this the board only ever gets wider: ~10 brand-new
// targets a day, each carrying up to MAX_VOTES, which crowds real people's blames off the 24h
// view. Drawn from the RECENT end of the board on purpose, since the freshly-created targets are
// the topical ones (what the news tab surfaced, what people actually blamed this week) rather
// than something from June.
//
// Validated too, and that is not paranoia: the board holds targets older than the current filter,
// so an entry that a later filter change outlawed is still sitting there.
//
// checkContent is NOT enough on its own here, and this is the important part. It catches profanity,
// PII and gibberish, which is the right bar for what a person may POST. It is the wrong bar for what
// our bot may AMPLIFY. A live draw off the board offered up "the jews" and "Putin": both pass
// checkContent cleanly, and a person choosing to blame either is their own business, but us pouring
// 43 automated votes onto them is us taking a position. So pile-on candidates go through a screen
// with the same standard the fresh half is held to (no people, no groups, nothing political), and
// the screen has to APPROVE a candidate rather than merely not object.
export function pickPileOn(existing, n, approved, recentWindow = 60) {
  const recent = [...existing.values()].sort((a, b) => b.at - a.at).slice(0, recentWindow);
  const ok = new Set([...approved].map((t) => t.toLowerCase()));
  const { kept } = validate(recent.map((t) => t.text));
  return pickN(
    kept.filter((t) => ok.has(t.toLowerCase())),
    n,
  );
}

export function buildScreenPrompt(candidates) {
  return `Below is a numbered list of entries from a public humor board where people blame things for their bad day.

I want to know which ones are safe for an automated bot to add votes to. The bot piling votes onto an entry reads as the site taking a position, so the bar is high.

APPROVE only entries that are impersonal everyday annoyances: objects, software, weather, chores, traffic, small daily frustrations.

REJECT, always:
- any person, real or named, living or dead, famous or not
- any group of people: nationality, ethnicity, religion, race, gender, political party, profession
- anything political, governmental, electoral, or about a country's actions
- anything about war, crime, disease, death, or disaster
- anything mean-spirited toward anyone

If you are unsure about an entry, REJECT it. A missed approval costs nothing. A wrong approval means the site is publicly piling on a person or a group.

${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return ONLY a JSON array of the numbers you APPROVE, for example [1,4,7]. No other text.`;
}

// Ask the model which board entries are safe to amplify, then let deterministic code do the
// selecting. Same shape as the vulgarity audit: the model judges WHAT, code decides HOW. Fails
// CLOSED on purpose, an outage means no pile-on rather than an unscreened one.
export async function screenPileOn(candidates, key, fetchImpl = fetch) {
  if (!candidates.length || !key) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildScreenPrompt(candidates) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (res.ok) {
      const body = await res.json();
      let nums;
      try {
        nums = JSON.parse(body?.candidates?.[0]?.content?.parts?.[0]?.text || '[]');
      } catch {
        return [];
      }
      // Index back into OUR list rather than trusting any text the model echoes, so it cannot
      // approve a string we never showed it.
      return (Array.isArray(nums) ? nums : []).map((i) => candidates[Number(i) - 1]).filter((t) => typeof t === 'string');
    }
    if (![429, 500, 503].includes(res.status)) return [];
    await sleep(2000 * 2 ** attempt);
  }
  return [];
}

export async function pickTopics(n, env = process.env, existing = new Map()) {
  const pileOnWanted = Math.min(Number(env.PILE_ON ?? Math.floor(n / 2)), n);
  const recent = [...existing.values()].sort((a, b) => b.at - a.at).slice(0, 60);
  const approved = await screenPileOn(validate(recent.map((t) => t.text)).kept, env.GEMINI_API_KEY);
  const pileOn = pickPileOn(existing, pileOnWanted, approved);
  if (existing.size && !pileOn.length) log('no board entry cleared the amplify screen; all picks will be fresh');
  const freshWanted = n - pileOn.length; // a thin board just means more fresh ones, never a short day
  const isDupe = (t) => pileOn.some((p) => p.toLowerCase() === t.toLowerCase());

  const withPileOn = (fresh, source) => ({
    topics: [...pileOn, ...fresh.filter((t) => !isDupe(t)).slice(0, freshWanted)],
    source: `${pileOn.length} from the board + ${source}`,
  });

  if (!env.GEMINI_API_KEY) {
    log('no GEMINI_API_KEY; using the fallback pool');
    return withPileOn(pickN(FALLBACK_POOL, FALLBACK_POOL.length), 'fallback pool (no key)');
  }
  let proposed;
  try {
    proposed = await geminiTopics(freshWanted, env.GEMINI_API_KEY);
  } catch (e) {
    log(`gemini unavailable (${e.message}); falling back to the pool`);
    return withPileOn(pickN(FALLBACK_POOL, FALLBACK_POOL.length), 'fallback pool (gemini down)');
  }
  const { kept, rejected } = validate(proposed);
  for (const r of rejected) log(`rejected "${r.text}": ${r.why}`);
  const fresh = kept.filter((t) => !isDupe(t));
  if (fresh.length < freshWanted) {
    // Top up from the pool rather than post a short day. Pool entries go through validate too,
    // so a filter change that outlaws one of them can't sneak it onto the board either.
    const topUp = validate(pickN(FALLBACK_POOL, FALLBACK_POOL.length)).kept.filter((t) => !isDupe(t) && !fresh.some((k) => k.toLowerCase() === t.toLowerCase()));
    fresh.push(...topUp.slice(0, freshWanted - fresh.length));
    log(`gemini gave ${kept.length} usable fresh; topped up from the pool`);
  }
  return withPileOn(fresh, `${freshWanted} fresh via gemini ${GEMINI_MODEL}`);
}

async function main() {
  const dry = process.env.DRY_RUN === '1';
  // Read the board FIRST, even on a dry run. It feeds the pile-on half of the picks, and it means
  // a dry run exercises listTargets instead of skipping it (a DRY_RUN that skips the risky code is
  // not a rehearsal, it just proves the safe half).
  const existing = await listTargets();
  log(`${existing.size} targets already on the board`);

  const { topics, source } = await pickTopics(TOPICS, process.env, existing);
  log(`${topics.length} topics: ${source}`);
  if (!topics.length) throw new Error('no usable topics');

  const events = [];
  const summary = [];
  for (const topic of topics) {
    const key = topic.trim().toLowerCase();
    let targetId = existing.get(key)?.id;
    const isNew = !targetId;
    if (isNew) {
      const ev = await signEvent(1, topic, [['t', TAG]]);
      targetId = ev.id;
      events.push(ev);
      existing.set(key, { id: targetId, at: ev.created_at, text: topic });
    }
    const votes = Math.floor(Math.random() * MAX_VOTES) + 1;
    for (let i = 0; i < votes; i++) events.push(await signEvent(7, '💥', [['e', targetId], ['t', TAG]]));
    summary.push({ topic, votes, isNew });
  }

  if (dry) log(`DRY_RUN: would publish ${events.length} events, nothing sent`);
  else await publishAll(events);

  log(`blamed ${topics.length} topics, ${events.length} total events`);
  for (const s of summary) console.log(`  ${String(s.votes).padStart(2)}x  ${s.topic}${s.isNew ? '  (new target)' : ''}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = summary.map((s) => `- \`${s.topic}\` x${s.votes}${s.isNew ? ' (new)' : ''}`).join('\n');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### daily blame\n${topics.length} topics via ${source}, ${events.length} events.\n\n${rows}\n`, { flag: 'a' });
  }
}

// Importable for tests without firing a run.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
