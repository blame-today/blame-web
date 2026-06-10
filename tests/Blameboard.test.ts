import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { ui } from '$lib/ui.svelte';

const mock = vi.hoisted(() => ({
  store: { topics: [] as any[], mine: [] as string[], relaysUp: 5, relaysTotal: 5, synced: true },
  vote: vi.fn(),
}));
vi.mock('$lib/store.svelte', () => ({ store: mock.store, vote: mock.vote, blame: vi.fn(), TOP: 100 }));

import Blameboard from '$components/Blameboard.svelte';

beforeEach(() => {
  mock.vote.mockClear();
  ui.filter = 'all';
  ui.blazeId = '';
  mock.store.topics = [
    { id: 'a', txt: 'Mondays', confirmed: 50, hot: 2, pending: 0 },
    { id: 'b', txt: 'Taxes', confirmed: 10, hot: 30, pending: 0 },
    { id: 'c', txt: 'Brunch', confirmed: 5, hot: 0, pending: 0 },
  ];
  mock.store.mine = ['b'];
});

describe('Blameboard', () => {
  it('shows the per-filter sub label with All / 24h / Mine / News filters', () => {
    // the "Blameboard" title was trimmed (b651f79); the header shows the
    // sub label instead ("top 100" / "yours" / "in the news").
    render(Blameboard);
    expect(screen.getByText('top 100')).toBeInTheDocument();
    for (const f of ['All', '24h', 'Mine', 'News']) expect(screen.getByText(f)).toBeInTheDocument();
  });

  it('ranks by all-time votes under All', () => {
    render(Blameboard);
    const names = screen.getAllByText(/^(Mondays|Taxes|Brunch)$/).map((e) => e.textContent);
    expect(names[0]).toBe('Mondays'); // 50 confirmed
  });

  it('re-ranks by 24h votes under the 24h tab and drops zero-hot topics', async () => {
    render(Blameboard);
    await fireEvent.click(screen.getByText('24h'));
    const names = screen.getAllByText(/^(Mondays|Taxes|Brunch)$/).map((e) => e.textContent);
    expect(names[0]).toBe('Taxes'); // hot 30 > 2
    expect(names).not.toContain('Brunch'); // hot 0 -> excluded
  });

  it('shows only your topics under Mine', async () => {
    render(Blameboard);
    await fireEvent.click(screen.getByText('Mine'));
    expect(screen.getByText('Taxes')).toBeInTheDocument();
    expect(screen.queryByText('Mondays')).not.toBeInTheDocument();
    expect(screen.queryByText('Brunch')).not.toBeInTheDocument();
  });

  it('blazes the just-blamed row (ui.blazeId)', async () => {
    ui.blazeId = 'a';
    render(Blameboard);
    expect(screen.getByText('Mondays').closest('.blaze')).not.toBeNull();
  });

  it('calls vote when a +1 is clicked', async () => {
    render(Blameboard);
    await fireEvent.click(screen.getAllByText('+1')[0]);
    expect(mock.vote).toHaveBeenCalledWith('a');
  });

  it('stickers your blames on the All board', () => {
    render(Blameboard);
    const stickers = screen.getAllByTitle('you blamed this');
    expect(stickers).toHaveLength(1); // only Taxes (id 'b') is mine
    expect(stickers[0].closest('.flex')).toHaveTextContent('Taxes');
  });

  it('omits the sticker on the Mine board (redundant there)', async () => {
    render(Blameboard);
    await fireEvent.click(screen.getByText('Mine'));
    expect(screen.queryByTitle('you blamed this')).toBeNull();
  });
});
