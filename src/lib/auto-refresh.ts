// Long-lived tabs slowly grow memory: the `seen` dedup map (store) and the relay
// `countSubs` (nostr) never fully evict (#6). Rather than per-map eviction, after
// a max session age we force a full page reload, which drops all module state and
// reclaims it (data rebuilds from the localStorage cache + the relays, so it's
// non-destructive). Polite: if the tab is currently visible we wait until it is
// next hidden, so an active user is never yanked mid-vote. Deps are injectable
// for tests.
export const MAX_SESSION_MS = 6 * 60 * 60 * 1000; // 6h

export function armAutoRefresh(
  reload: () => void = () => location.reload(),
  isHidden: () => boolean = () => document.hidden,
): void {
  setTimeout(() => {
    if (isHidden()) {
      reload();
      return;
    }
    const onHide = (): void => {
      if (isHidden()) {
        document.removeEventListener('visibilitychange', onHide);
        reload();
      }
    };
    document.addEventListener('visibilitychange', onHide);
  }, MAX_SESSION_MS);
}
