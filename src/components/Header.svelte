<script lang="ts">
  import Status from '$components/Status.svelte';
  import { openExplainer } from '$lib/explainer.svelte';
</script>

<div class="text-center">
  <div class="inline-block text-left">
    <span class="block pl-1 text-lg font-bold italic leading-none text-slate-400">who do you…</span>
    <h1 class="pl-7 pr-3 whitespace-nowrap text-[clamp(1.75rem,11.5vw,2.6rem)] font-black italic leading-none tracking-tighter bg-gradient-to-b from-red-400 to-orange-600 bg-clip-text text-transparent">BLAME.TODAY?</h1>
  </div>
  <div class="flex flex-nowrap items-center justify-center gap-x-1.5 mt-2">
    <!-- flex row so the · separators get an exact, tight margin instead of collapsed
         markup-whitespace (which read too airy under tracking-wider). -->
    <div class="flex shrink-0 flex-wrap items-center justify-center gap-x-0.5 text-[clamp(7px,2.3vw,10px)] font-mono text-slate-500 uppercase tracking-wider">
      <a href="https://github.com/nostr-protocol/nostr" target="_blank" rel="noopener noreferrer" title="Nostr: an open, decentralized protocol" class="transition-colors hover:text-orange-400 hover:underline">decentralized</a>
      <span class="text-slate-600">·</span>
      <a href="https://github.com/nostr-protocol/nips" target="_blank" rel="noopener noreferrer" title="The NIPs — Nostr's open specs" class="transition-colors hover:text-orange-400 hover:underline">open</a>
      <span class="text-slate-600">·</span>
      <a href="https://github.com/nostr-protocol/nips/blob/master/01.md" target="_blank" rel="noopener noreferrer" title="NIP-01: every vote is a Schnorr-signed event" class="transition-colors hover:text-orange-400 hover:underline">tamperproof</a>
      <span class="text-slate-600">·</span>
      <a href="https://nostr.com" target="_blank" rel="noopener noreferrer" title="What is Nostr?" class="transition-colors hover:text-orange-400 hover:underline">nostr</a>
      <span class="text-slate-600">·</span>
      <button onclick={openExplainer} title="what is this?" aria-label="what is this?" class="font-bold transition-colors hover:text-orange-400 touch-manipulation">?</button>
    </div>
    <Status />
  </div>
</div>
