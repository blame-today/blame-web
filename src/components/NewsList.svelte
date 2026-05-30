<script lang="ts">
  import { fade } from 'svelte/transition';
  import { news, loadNews, nextRefreshAt } from '$lib/news.svelte';
  import { store, vote, blame } from '$lib/store.svelte';
  import { fireFloat, bump, haptic } from '$lib/fx';
  import type { NewsItem } from '$lib/types';

  // Lazy: restore the cache or do the one-time fetch the first time the tab is opened.
  loadNews();

  // A rolling clock so the cooldown counts down live, down to the millisecond.
  let now = $state(Date.now());
  $effect(() => {
    let raf = requestAnimationFrame(function tick() {
      now = Date.now();
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });
  const remaining = $derived(Math.max(0, nextRefreshAt() - now));
  const canRefreshNow = $derived(remaining === 0);
  const fetchedStamp = $derived(
    news.fetchedAt ? new Date(news.fetchedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '',
  );

  function fmt(ms: number): string {
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor((ms % 3_600_000) / 60_000))}:${p(Math.floor((ms % 60_000) / 1000))}.${p(ms % 1000, 3)}`;
  }

  // Vote it up right here. If it's already a topic, vote it; otherwise blame() mints it + casts the
  // opening vote. Either way you stay on this tab — no need to go hunting on the board.
  function topicFor(text: string) {
    const key = text.toLowerCase();
    return store.topics.find((t) => t.txt.toLowerCase() === key);
  }
  async function castVote(item: NewsItem, e: MouseEvent) {
    fireFloat(e.currentTarget as HTMLElement);
    haptic();
    const t = topicFor(item.text);
    if (t) vote(t.id);
    else await blame(item.text);
  }
</script>

<!-- provenance + refresh/countdown, up top -->
<div class="flex flex-nowrap items-center justify-between gap-x-2 p-3 px-4 border-b border-slate-800/60">
  <span class="text-[10px] text-slate-500 min-w-0 truncate">
    From
    <a href={news.source.url || 'https://lite.cnn.com/'} target="_blank" rel="noopener noreferrer" class="text-slate-300 underline decoration-slate-700 hover:text-orange-400">{news.source.name || 'the news'}</a>
    {#if fetchedStamp}<span class="text-slate-600">@ {fetchedStamp}</span>{/if}
  </span>
  {#if news.status === 'loading'}
    <span class="shrink-0 text-[10px] font-mono text-slate-500 animate-pulse">fetching…</span>
  {:else if canRefreshNow}
    <button onclick={() => loadNews(true)} class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-orange-500 hover:text-orange-400 transition-colors">↻ refresh</button>
  {:else}
    <span class="shrink-0 text-[10px] font-mono tabular-nums text-slate-600" title="we only re-scrape the news once a day">wait {fmt(remaining)}</span>
  {/if}
</div>

{#if news.status === 'loading'}
  <div class="p-8 text-center text-xs text-slate-500 animate-pulse">Reading the headlines…</div>
{:else if news.status === 'error'}
  <div class="p-8 text-center text-xs text-slate-500">Couldn't reach the news — {news.error}</div>
{:else if news.items.length === 0}
  <div class="p-8 text-center text-xs text-slate-600">Nothing blame-worthy in the headlines right now.</div>
{:else}
  <div class="divide-y divide-slate-800/60 [&>div:last-child]:rounded-b-2xl">
    {#each news.items as item (item.text)}
      {@const topic = topicFor(item.text)}
      <div class="flex items-center justify-between p-4 hover:bg-slate-900/30 transition-colors">
        <div class="flex items-center space-x-3 min-w-0 pr-2">
          <span class="w-8 shrink-0 text-[10px] font-mono font-bold text-amber-500/80 tabular-nums" title="mentioned in {item.mentions} of today's headlines">🔥{item.mentions}</span>
          <div class="min-w-0">
            <div class="font-bold text-slate-200 truncate select-text">{item.text}</div>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              class="block truncate text-[11px] text-slate-500 hover:text-orange-400 transition-colors"
              title={item.headline}
            >{item.headline} <span class="text-slate-600">↗</span></a>
          </div>
        </div>
        <div class="flex items-center space-x-2 shrink-0">
          {#if topic && topic.pending > 0}
            <span transition:fade={{ duration: 150 }} class="text-[10px] font-mono font-bold text-amber-400 animate-pulse" title="votes queued — syncing to relays">↑{topic.pending}</span>
          {/if}
          {#if topic}
            <span use:bump={topic.confirmed} class="text-xs font-mono font-bold bg-slate-950 border border-slate-800 text-orange-500 px-2.5 py-1 rounded-lg tabular-nums inline-block">{topic.confirmed.toLocaleString()}</span>
          {/if}
          <button onclick={(e) => castVote(item, e)} class="bg-slate-800 hover:bg-red-600 active:scale-95 font-black text-xs px-3 py-1 rounded-lg transition">+1</button>
        </div>
      </div>
    {/each}
  </div>
{/if}
