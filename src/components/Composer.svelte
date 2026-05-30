<script lang="ts">
  import { store, blame } from '$lib/store.svelte';
  import { checkContent, MAX_LENGTH } from '$lib/filter';
  import { fireFloat, burnAway } from '$lib/fx';
  import { showMine } from '$lib/ui.svelte';
  import type { Topic } from '$lib/types';

  let value = $state('');
  let placeholder = $state('Type target to blame...');
  let burning = $state(false);
  let fading = $state(false);
  let focused = $state(false);
  let inputEl: HTMLInputElement;
  let blameBtnEl: HTMLButtonElement;
  let rt1: ReturnType<typeof setTimeout> | undefined;
  let rt2: ReturnType<typeof setTimeout> | undefined;

  const counterCls = $derived(
    value.length >= MAX_LENGTH
      ? 'text-orange-500'
      : value.length >= MAX_LENGTH - 5
        ? 'text-amber-500'
        : 'text-slate-600',
  );

  // Autocomplete: existing topics matching what's typed — prefix matches first, then by votes.
  const suggestions = $derived.by((): Topic[] => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return [...store.topics]
      .filter((t) => t.txt.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.txt.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.txt.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || b.confirmed - a.confirmed;
      })
      .slice(0, 6);
  });
  const showSuggest = $derived(focused && suggestions.length > 0);

  function pick(s: Topic, el: HTMLElement) {
    fireFloat(el);
    blame(s.txt); // existing topic -> dedups and votes it
    showMine(s.id); // jump to Mine + blaze the row
    value = '';
    focused = false;
  }

  function onInput() {
    value = value.replace(/^\s+/, ''); // ignore leading spaces -> honest char count
  }

  function reject(reason: string) {
    burnAway(inputEl, value);
    value = '';
    fading = false;
    burning = true;
    placeholder = `🔥 ${reason} 🔥`;
    inputEl.animate([{ borderColor: '#f97316', boxShadow: '0 0 14px #f9731699' }, {}], { duration: 800, easing: 'ease-out' });
    clearTimeout(rt1);
    clearTimeout(rt2);
    rt1 = setTimeout(() => (fading = true), 1300);
    rt2 = setTimeout(() => {
      burning = false;
      fading = false;
      placeholder = 'Type target to blame...';
    }, 2100);
  }

  async function submit() {
    const txt = value.trim();
    if (!txt) return;
    const why = checkContent(txt);
    if (why) return reject(why); // burn it up + show the fiery reason
    value = '';
    fireFloat(blameBtnEl);
    const id = await blame(txt);
    if (id) showMine(id); // jump to Mine so you see what you just blamed
  }
</script>

<div class="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-2">
  <div class="relative">
    <div class="flex gap-2">
      <input
        id="inp"
        type="text"
        bind:this={inputEl}
        bind:value
        oninput={onInput}
        onfocus={() => (focused = true)}
        onblur={() => setTimeout(() => (focused = false), 120)}
        onkeydown={(e) => e.key === 'Enter' && submit()}
        maxlength={MAX_LENGTH}
        {placeholder}
        class:burn={burning}
        class:fade={fading}
        class="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-orange-500 text-slate-200"
      />
      <button
        bind:this={blameBtnEl}
        onclick={submit}
        class="bg-gradient-to-r from-red-600 to-orange-600 text-xs font-black px-4 rounded-xl active:scale-95 transition uppercase"
      >Blame</button>
    </div>
    {#if showSuggest}
      <div class="absolute left-0 right-0 top-full mt-1 z-50 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl shadow-black/40">
        {#each suggestions as s (s.id)}
          <button
            type="button"
            onmousedown={(e) => { e.preventDefault(); pick(s, e.currentTarget); }}
            class="w-full flex justify-between items-center gap-2 px-4 py-2 text-left hover:bg-slate-800/70 transition-colors"
          >
            <span class="truncate text-sm text-slate-200">{s.txt}</span>
            <span class="shrink-0 text-xs font-mono font-bold text-orange-500 tabular-nums">{s.confirmed.toLocaleString()}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="flex justify-between items-center gap-2 px-1">
    <p class="text-[10px] text-slate-600">Click all you want — votes queue and sync to the relays. <span class="text-amber-500/70">↑n</span> = still in flight.</p>
    <span class="text-[10px] font-mono shrink-0 {counterCls}">{value.length}/{MAX_LENGTH}</span>
  </div>
</div>
