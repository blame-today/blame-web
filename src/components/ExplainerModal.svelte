<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { explainer, closeExplainer } from '$lib/explainer.svelte';

  const TABS = [
    { k: 'All', d: 'the all-time top 100' },
    { k: '24h', d: "who's hot right now" },
    { k: 'Mine', d: 'just the ones you blamed' },
    { k: 'News', d: 'blame straight from the headlines' },
  ] as const;
</script>

<svelte:window onkeydown={(e) => explainer.open && e.key === 'Escape' && closeExplainer()} />

{#if explainer.open}
  <!-- backdrop: a click on the backdrop itself (not a bubbled click from inside the panel)
       closes. Escape is the keyboard equivalent, handled on svelte:window above. -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    transition:fade={{ duration: 150 }}
    onclick={(e) => e.target === e.currentTarget && closeExplainer()}
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="presentation"
  >
    <div
      transition:scale={{ duration: 180, start: 0.96 }}
      role="dialog"
      aria-modal="true"
      aria-label="what is blame.today"
      tabindex="-1"
      class="relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900"
    >
      <!-- header -->
      <div class="relative border-b border-slate-800 px-4 pb-3.5 pt-4 text-center">
        <button
          onclick={closeExplainer}
          aria-label="close"
          class="absolute right-3 top-3 text-slate-500 hover:text-slate-300 text-lg leading-none touch-manipulation"
        >✕</button>
        <span class="block text-[11px] font-bold italic text-slate-400">wtf is this?</span>
        <span class="block text-2xl font-black italic leading-tight tracking-tight bg-gradient-to-b from-red-400 to-orange-600 bg-clip-text text-transparent">blame.today in 10 seconds</span>
      </div>

      <!-- body -->
      <div class="flex flex-col gap-4 p-4">
        <div>
          <p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-orange-400">it's a giant anonymous finger</p>
          <p class="text-[13px] leading-relaxed text-slate-300">blame someone (or something) for your day. the board ranks who's catching the most heat right now. that's the whole site.</p>
        </div>

        <div>
          <p class="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-orange-400">how</p>
          <p class="mb-2 text-[13px] leading-relaxed text-slate-300">type a name + hit blame to start one. already on the board? just hit its <span class="font-bold text-red-300">+1</span> to pile on, no typing needed.</p>
          <!-- a non-interactive sample row showing the real count badge + +1 button -->
          <div class="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2">
            <span class="text-[13px] font-bold text-slate-200">the weather</span>
            <span class="flex items-center gap-1.5">
              <span class="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-orange-500">1,204</span>
              <span class="rounded-lg bg-red-600 px-3 py-1 text-xs font-black text-white">+1</span>
            </span>
          </div>
          <p class="mt-1.5 text-right text-[11px] italic text-slate-500">↑ tap the +1. that's the vote.</p>
          <p class="mt-2 text-[13px] leading-relaxed text-slate-300">click all you want, votes queue then sync. no login, no account, nobody knows it's you.</p>
        </div>

        <div>
          <p class="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-orange-400">the tabs</p>
          <div class="flex flex-col gap-1.5 text-[13px] text-slate-300">
            {#each TABS as t (t.k)}
              <div><span class="inline-block min-w-[42px] font-bold text-orange-300">{t.k}</span>{t.d}</div>
            {/each}
          </div>
        </div>

        <div>
          <p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-orange-400">the point</p>
          <p class="text-[13px] leading-relaxed text-slate-300">bad day? blame.today. it's catharsis, not a courtroom. anonymous, decentralized, lives on nostr so nobody owns it. point a finger, feel a little better, move on.</p>
        </div>

        <button
          onclick={closeExplainer}
          class="mt-1 w-full rounded-full bg-gradient-to-b from-red-400 to-orange-600 py-2.5 text-sm font-extrabold text-white active:scale-[0.98] transition touch-manipulation"
        >ok, let me blame someone →</button>
      </div>
    </div>
  </div>
{/if}
