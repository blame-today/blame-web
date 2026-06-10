import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { armAutoRefresh, MAX_SESSION_MS } from '$lib/auto-refresh';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('armAutoRefresh (#6)', () => {
  it('reloads at the session cap when the tab is hidden', () => {
    const reload = vi.fn();
    armAutoRefresh(reload, () => true);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MAX_SESSION_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits while visible, then reloads on the next hide', () => {
    const reload = vi.fn();
    let hidden = false;
    armAutoRefresh(reload, () => hidden);
    vi.advanceTimersByTime(MAX_SESSION_MS);
    expect(reload).not.toHaveBeenCalled(); // still visible -> defer
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload while the tab stays visible', () => {
    const reload = vi.fn();
    armAutoRefresh(reload, () => false);
    vi.advanceTimersByTime(MAX_SESSION_MS);
    document.dispatchEvent(new Event('visibilitychange')); // still visible
    expect(reload).not.toHaveBeenCalled();
  });
});
