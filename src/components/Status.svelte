<script lang="ts">
  import { store } from '$lib/store.svelte';

  // One dot per relay (green = connected), plus a word for the state — no "5/5" that reads as a date.
  const tone = $derived(
    store.relaysUp === 0
      ? { label: 'offline', text: 'text-red-400', dot: 'bg-red-500' }
      : !store.synced
        ? { label: 'syncing', text: 'text-amber-400', dot: 'bg-amber-500 animate-pulse' }
        : { label: 'live', text: 'text-green-400', dot: 'bg-green-500' },
  );
</script>

<span
  class="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-2 py-0.5 text-[10px]"
  title="{store.relaysUp} of {store.relaysTotal} relays connected"
>
  <span class="flex gap-[3px]" aria-hidden="true">
    {#each Array.from({ length: store.relaysTotal }) as _, i (i)}
      <span class="h-1.5 w-1.5 rounded-full {i < store.relaysUp ? tone.dot : 'bg-slate-700'}"></span>
    {/each}
  </span>
  <span class="font-mono uppercase tracking-wider {tone.text}">{tone.label}</span>
</span>
