import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// vi.hoisted so the (hoisted) vi.mock factory can reference this mock state.
const mock = vi.hoisted(() => ({
  store: { topics: [] as any[], mine: [] as string[], relaysUp: 5, relaysTotal: 5, synced: true },
  blame: vi.fn(),
  vote: vi.fn(),
}));
vi.mock('$lib/store.svelte', () => ({ store: mock.store, blame: mock.blame, vote: mock.vote, TOP: 100 }));

import Composer from '$components/Composer.svelte';

beforeEach(() => {
  mock.blame.mockClear();
  mock.store.topics = [];
});

describe('Composer', () => {
  it('rejects profanity with a fiery placeholder and does not blame', async () => {
    render(Composer);
    const input = screen.getByPlaceholderText('Type target to blame...') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'shit' } });
    await fireEvent.click(screen.getByText('Blame'));
    expect(mock.blame).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('🔥 No bad words! 🔥');
  });

  it('blames a clean target and clears the input', async () => {
    render(Composer);
    const input = screen.getByPlaceholderText('Type target to blame...') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Brunch' } });
    await fireEvent.click(screen.getByText('Blame'));
    expect(mock.blame).toHaveBeenCalledWith('Brunch');
    expect(input.value).toBe('');
  });

  it('suggests matching existing topics as you type', async () => {
    mock.store.topics = [
      { id: '1', txt: 'silly web app side projects', confirmed: 16, hot: 0, pending: 0 },
      { id: '2', txt: 'spike round-trip check', confirmed: 26, hot: 0, pending: 0 },
      { id: '3', txt: 'Big Pharma', confirmed: 99, hot: 0, pending: 0 },
    ];
    render(Composer);
    const input = screen.getByPlaceholderText('Type target to blame...');
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 's' } });
    expect(screen.getByText('silly web app side projects')).toBeInTheDocument();
    expect(screen.getByText('spike round-trip check')).toBeInTheDocument();
    expect(screen.queryByText('Big Pharma')).not.toBeInTheDocument(); // no 's' -> not suggested
  });
});
