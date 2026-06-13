// The onboarding explainer ("wtf is this?"). Two doors into one modal: a fresh-visit banner
// (shown once, until the visitor has opened or dismissed it) and a persistent `?` in the
// header. `blm_seen` in localStorage is the once-only flag. Storage is injectable so the
// flag logic is unit-testable; reads/writes are guarded so private-mode (throwing storage)
// degrades to "always show the banner" rather than crashing the app.
export const SEEN_KEY = 'blm_seen';

export function hasSeen(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistSeen(storage: Storage = localStorage): void {
  try {
    storage.setItem(SEEN_KEY, '1');
  } catch {
    // private mode / blocked storage: the banner just re-shows next visit, no crash.
  }
}

export const explainer = $state<{ open: boolean; seen: boolean }>({
  open: false,
  seen: hasSeen(),
});

// Opening it (from either door) counts as seen, so the banner never auto-nags again.
export function openExplainer(): void {
  explainer.open = true;
  explainer.seen = true;
  persistSeen();
}

export function closeExplainer(): void {
  explainer.open = false;
}

// The banner's close x: stop showing it, but don't open the modal.
export function dismissBanner(): void {
  explainer.seen = true;
  persistSeen();
}
