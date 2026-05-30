<script lang="ts">
  import { fade } from 'svelte/transition';
  import { vote } from '$lib/store.svelte';
  import { ui } from '$lib/ui.svelte';
  import { fireFloat, bump } from '$lib/fx';
  import Sticker from '$components/Sticker.svelte';
  import type { RowTopic } from '$lib/types';

  let { topic }: { topic: RowTopic } = $props();
</script>

<div
  class:blaze={topic.id === ui.blazeId}
  class="relative flex justify-between items-center p-4 hover:bg-slate-900/30 transition-colors"
>
  {#if topic.mine}
    <!-- floats off the left edge, straddling the row's left border, to the left of the rank;
         the two nested layers give it a subtle, slightly-random warble -->
    <div class="pointer-events-none absolute -left-4 top-1/3 z-20 -translate-y-1/2 -rotate-[12deg]" title="you blamed this">
      <div class="warble-spin"><div class="warble-drift"><Sticker /></div></div>
    </div>
  {/if}
  <div class="flex items-center space-x-3 min-w-0 pr-2">
    {#if topic.rank != null}
      <span class="text-xs font-mono font-black w-6 text-slate-600">{topic.rank}</span>
    {/if}
    <span class="font-bold text-slate-200 truncate select-text cursor-text min-w-0">{topic.txt}</span>
  </div>
  <div class="flex items-center space-x-2 shrink-0">
    {#if topic.pending > 0}
      <span transition:fade={{ duration: 150 }} class="text-[10px] font-mono font-bold text-amber-400 animate-pulse" title="votes queued — syncing to relays">↑{topic.pending}</span>
    {/if}
    <span use:bump={topic.count} class="text-xs font-mono font-bold bg-slate-950 border border-slate-800 text-orange-500 px-2.5 py-1 rounded-lg tabular-nums inline-block">{topic.count.toLocaleString()}</span>
    <button onclick={(e) => { vote(topic.id); fireFloat(e.currentTarget); }} class="bg-slate-800 hover:bg-red-600 active:scale-95 font-black text-xs px-3 py-1 rounded-lg transition">+1</button>
  </div>
</div>
