<script lang="ts">
  import { slide } from 'svelte/transition';
  import { explainer, openExplainer, dismissBanner } from '$lib/explainer.svelte';
</script>

{#if !explainer.seen}
  <div
    transition:slide={{ duration: 200 }}
    class="flex items-center justify-between gap-2 rounded-xl border border-orange-900/60 bg-orange-950/30 px-3 py-2"
  >
    <button
      onclick={openExplainer}
      class="min-w-0 truncate text-left text-xs font-bold text-orange-200 hover:text-orange-100 touch-manipulation"
    >wtf is this? blame.today in 10 sec →</button>
    <button
      onclick={dismissBanner}
      aria-label="dismiss"
      class="shrink-0 text-sm leading-none text-slate-500 hover:text-slate-300 touch-manipulation"
    >✕</button>
  </div>
{/if}
