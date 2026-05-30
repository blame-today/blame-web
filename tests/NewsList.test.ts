import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const mock = vi.hoisted(() => ({
  news: { status: 'ready', items: [] as any[], error: '', fetchedAt: 0, source: { name: 'CNN Lite', url: 'https://lite.cnn.com/' } },
  loadNews: vi.fn(),
  nextRefreshAt: vi.fn(() => Date.now() + 3_600_000), // cooldown active by default
  store: { topics: [] as any[] },
  vote: vi.fn(),
  blame: vi.fn(() => Promise.resolve('id1')),
}));
vi.mock('$lib/news.svelte', () => ({ news: mock.news, loadNews: mock.loadNews, nextRefreshAt: mock.nextRefreshAt }));
vi.mock('$lib/store.svelte', () => ({ store: mock.store, vote: mock.vote, blame: mock.blame }));

import NewsList from '$components/NewsList.svelte';

beforeEach(() => {
  mock.loadNews.mockClear();
  mock.vote.mockClear();
  mock.blame.mockClear();
  mock.nextRefreshAt.mockReturnValue(Date.now() + 3_600_000);
  mock.news.status = 'ready';
  mock.news.error = '';
  mock.news.fetchedAt = Date.now();
  mock.news.items = [
    { text: 'Trump', mentions: 4, url: 'https://lite.cnn.com/a', headline: 'Judge says Trump cannot rename the Kennedy Center' },
    { text: 'NATO', mentions: 1, url: 'https://lite.cnn.com/b', headline: 'NATO condemns the latest drone incident' },
  ];
  // Trump is already a topic with votes; NATO is not yet on the board
  mock.store.topics = [{ id: 't1', txt: 'Trump', confirmed: 12, hot: 0, pending: 0 }];
});

const rowFor = (name: string) => screen.getByText(name).closest('.justify-between') as HTMLElement;

describe('NewsList', () => {
  it('lists entities with heat, source links, and existing vote counts', () => {
    render(NewsList);
    expect(mock.loadNews).toHaveBeenCalled();
    expect(screen.getByText('🔥4')).toBeInTheDocument(); // heat moved to the left
    const link = screen.getByText(/Judge says Trump/).closest('a');
    expect(link).toHaveAttribute('href', 'https://lite.cnn.com/a');
    // Trump already has votes -> its count shows; NATO (no topic) has none
    expect(rowFor('Trump').querySelector('.bg-slate-950')).toHaveTextContent('12');
    expect(rowFor('NATO').querySelector('.bg-slate-950')).toBeNull();
  });

  it('+1 on an existing topic votes it directly', async () => {
    render(NewsList);
    await fireEvent.click(rowFor('Trump').querySelector('button')!);
    expect(mock.vote).toHaveBeenCalledWith('t1');
    expect(mock.blame).not.toHaveBeenCalled();
  });

  it('+1 on a brand-new entity blames it into existence', async () => {
    render(NewsList);
    await fireEvent.click(rowFor('NATO').querySelector('button')!);
    expect(mock.blame).toHaveBeenCalledWith('NATO');
  });

  it('credits the source with a CNN Lite link and a fetch timestamp', () => {
    render(NewsList);
    expect(screen.getByText(/You got this from/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CNN Lite' })).toHaveAttribute('href', 'https://lite.cnn.com/');
    expect(screen.getByText(/^@ /)).toBeInTheDocument();
  });

  it('shows a live "wait … to refresh" countdown while cooling down', () => {
    mock.nextRefreshAt.mockReturnValue(Date.now() + 3_600_000);
    render(NewsList);
    expect(screen.getByText(/wait \d{2}:\d{2}:\d{2}\.\d{3} to refresh/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
  });

  it('shows a refresh button once the cooldown elapses', () => {
    mock.nextRefreshAt.mockReturnValue(Date.now() - 1000);
    render(NewsList);
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });
});
