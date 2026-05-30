import type { Action } from 'svelte/action';

// A short haptic tap on vote. Android Chrome honors navigator.vibrate;
// iOS Safari has no web vibration API so this is a silent no-op there —
// the fireFloat 🔥 is the cross-platform feedback. Guarded so it never
// throws on browsers without the API.
let hapticSwitch: HTMLInputElement | null = null;
function hapticSwitchEl(): HTMLInputElement {
  if (hapticSwitch) return hapticSwitch;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  // ios fires a subtle haptic when an <input switch> toggles, but seemingly only when the
  // control is actually laid out. so keep it rendered (just invisible + non-interactive)
  // rather than collapsed to 0x0 like the first attempt.
  label.style.cssText = 'position:fixed;bottom:0;right:0;opacity:0;pointer-events:none;z-index:-1;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.appendChild(input);
  document.body.appendChild(label);
  hapticSwitch = input;
  return hapticSwitch;
}
export function haptic(ms = 12): void {
  // android chrome honors navigator.vibrate; ios safari ignores it, so we also toggle a
  // rendered-but-invisible <input switch>: ios 17.4+ fires a subtle haptic on the toggle.
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no vibration API */
  }
  try {
    hapticSwitchEl().click();
  } catch {
    /* ios switch-haptic unavailable */
  }
}

// A little 🔥 floating up from an element when a vote spins up.
export function fireFloat(anchor: HTMLElement | null): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const s = document.createElement('span');
  s.textContent = '🔥';
  const dx = Math.random() * 26 - 13;
  s.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top}px;transform:translate(-50%,-50%);pointer-events:none;z-index:60;font-size:16px;`;
  document.body.appendChild(s);
  s.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx}px),-190%) scale(1.25)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx * 2}px),-340%) scale(.8)`, opacity: 0 },
    ],
    { duration: 850, easing: 'ease-out' },
  ).onfinish = () => s.remove();
}

// Rejected input text floating up in flames.
export function burnAway(anchor: HTMLElement | null, text: string): void {
  if (!anchor || !text) return;
  const r = anchor.getBoundingClientRect();
  const s = document.createElement('span');
  s.textContent = text;
  s.style.cssText = `position:fixed;left:${r.left + 14}px;top:${r.top + r.height / 2}px;transform:translateY(-50%);pointer-events:none;z-index:60;color:#fb923c;font-weight:700;font-size:14px;text-shadow:0 0 8px #f97316;white-space:nowrap;`;
  document.body.appendChild(s);
  s.animate(
    [
      { transform: 'translateY(-50%)', opacity: 1, filter: 'blur(0)' },
      { transform: 'translateY(-260%)', opacity: 0, filter: 'blur(4px)' },
    ],
    { duration: 900, easing: 'ease-in' },
  ).onfinish = () => s.remove();
}

// Svelte action: pop a number when its bound value increases.
export const bump: Action<HTMLElement, number> = (node, value) => {
  let prev = value;
  return {
    update(v: number) {
      if (v > prev) {
        node.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.4)', color: '#fff' }, { transform: 'scale(1)' }],
          { duration: 260, easing: 'ease-out' },
        );
      }
      prev = v;
    },
  };
};
