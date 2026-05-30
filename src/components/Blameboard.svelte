<script lang="ts">
  import { flip } from 'svelte/animate';
  import { store, TOP } from '$lib/store.svelte';
  import { ui } from '$lib/ui.svelte';
  import Row from '$components/Row.svelte';
  import NewsList from '$components/NewsList.svelte';

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: '24h', label: '24h' },
    { key: 'mine', label: 'Mine' },
    { key: 'news', label: 'News' },
  ] as const;

  const visible = $derived.by(() => {
    if (ui.filter === '24h') {
      return store.topics
        .filter((t) => t.hot > 0)
        .sort((a, b) => b.hot - a.hot)
        .slice(0, TOP)
        .map((t, i) => ({ ...t, rank: i + 1, count: t.hot, mine: store.mine.includes(t.id) }));
    }
    if (ui.filter === 'mine') {
      return store.topics
        .filter((t) => store.mine.includes(t.id))
        .sort((a, b) => b.confirmed - a.confirmed)
        .map((t) => ({ ...t, count: t.confirmed })); // no rank — it's your personal list
    }
    return [...store.topics]
      .sort((a, b) => b.confirmed - a.confirmed)
      .slice(0, TOP)
      .map((t, i) => ({ ...t, rank: i + 1, count: t.confirmed, mine: store.mine.includes(t.id) }));
  });

  const sub = $derived(ui.filter === 'mine' ? 'yours' : ui.filter === 'news' ? 'in the news' : 'top 100');
  const emptyMsg = $derived(
    ui.filter === '24h'
      ? 'Nothing hot in the last 24h — go start something.'
      : ui.filter === 'mine'
        ? "You haven't blamed anything yet — type one above."
        : 'No blame yet. Be the first to point a finger.',
  );
</script>

<!-- no overflow-hidden: the "I voted" stickers hang off the left edge. corners are rounded on
     the header (top) and last row (bottom) instead so nothing else pokes out. -->
<div class="bg-slate-900 rounded-2xl border border-slate-800">
  <div class="p-4 bg-slate-900/50 border-b border-slate-800 rounded-t-2xl flex flex-wrap justify-between items-center gap-x-2 gap-y-2">
    <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">Blameboard <span class="text-slate-600 normal-case font-mono">({sub})</span></span>
    <div class="flex gap-1 shrink-0">
      {#each FILTERS as f (f.key)}
        <button
          onclick={() => (ui.filter = f.key)}
          class:chip-flash={f.key === 'mine' && ui.blazeId !== ''}
          class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors {ui.filter === f.key ? 'bg-orange-600 text-white' : 'text-slate-500 hover:text-slate-300'}"
        >{f.label}</button>
      {/each}
    </div>
  </div>
  {#if ui.filter === 'news'}
    <NewsList />
  {:else}
    <!-- spam-click instruction, top line of the board (moved off the composer
         so it doesn't stack under the input on narrow screens) -->
    <div class="p-3 px-4 border-b border-slate-800/60">
      <p class="text-[10px] text-slate-500">Click all you want — votes queue and sync to the relays. <span class="text-amber-500/70">↑n</span> = still in flight.</p>
    </div>
    <div class="divide-y divide-slate-800/60 [&>div:last-child>div]:rounded-b-2xl">
      {#each visible as t (t.id)}
        <div animate:flip={{ duration: 340 }}>
          <Row topic={t} />
        </div>
      {/each}
      {#if visible.length === 0}
        <div class="p-8 text-center text-xs text-slate-600">{emptyMsg}</div>
      {/if}
    </div>
  {/if}
</div>
