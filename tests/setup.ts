// jsdom lacks the Web Animations API; stub it so fx (fireFloat / bump / burnAway) is a no-op
// in component tests instead of throwing. (Skipped in the node test environment.)
if (typeof Element !== 'undefined') {
  if (!('animate' in Element.prototype)) {
    (Element.prototype as any).animate = () => ({ onfinish: null, cancel() {}, finished: Promise.resolve() });
  }
  // svelte's animate:flip calls getAnimations() to coordinate; jsdom lacks it.
  if (!('getAnimations' in Element.prototype)) {
    (Element.prototype as any).getAnimations = () => [];
  }
}

// Node 22+ ships an inert global `localStorage`, and jsdom's is origin-gated — so install a
// simple in-memory one. The store's persistence (getItem/setItem/clear) is then testable.
class MemoryStorage {
  #m = new Map<string, string>();
  get length() {
    return this.#m.size;
  }
  clear() {
    this.#m.clear();
  }
  getItem(k: string) {
    return this.#m.has(k) ? this.#m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.#m.set(k, String(v));
  }
  removeItem(k: string) {
    this.#m.delete(k);
  }
  key(i: number) {
    return [...this.#m.keys()][i] ?? null;
  }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
