import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ExplainerBanner from '$components/ExplainerBanner.svelte';
import ExplainerModal from '$components/ExplainerModal.svelte';
import { explainer } from '$lib/explainer.svelte';

beforeEach(() => {
  localStorage.clear();
  explainer.open = false;
  explainer.seen = false;
});

describe('ExplainerBanner', () => {
  it('shows the fresh-visit nudge while unseen', () => {
    render(ExplainerBanner);
    expect(screen.getByText(/wtf is this\? blame\.today in 10 sec/i)).toBeInTheDocument();
  });

  it('clicking the nudge opens the modal and marks seen', async () => {
    render(ExplainerBanner);
    await fireEvent.click(screen.getByText(/wtf is this\?/i));
    expect(explainer.open).toBe(true);
    expect(explainer.seen).toBe(true);
  });

  it('the dismiss x marks seen without opening', async () => {
    render(ExplainerBanner);
    await fireEvent.click(screen.getByLabelText('dismiss'));
    expect(explainer.open).toBe(false);
    expect(explainer.seen).toBe(true);
  });

  it('renders nothing once seen', () => {
    explainer.seen = true;
    render(ExplainerBanner);
    expect(screen.queryByText(/wtf is this\?/i)).not.toBeInTheDocument();
  });
});

describe('ExplainerModal', () => {
  it('is hidden until open', () => {
    render(ExplainerModal);
    expect(screen.queryByText(/blame\.today in 10 seconds/i)).not.toBeInTheDocument();
  });

  it('renders the point, the +1 callout, and the tabs when open', () => {
    explainer.open = true;
    render(ExplainerModal);
    expect(screen.getByText(/blame\.today in 10 seconds/i)).toBeInTheDocument();
    expect(screen.getByText(/catharsis, not a courtroom/i)).toBeInTheDocument();
    expect(screen.getByText(/that's the vote/i)).toBeInTheDocument();
    expect(screen.getByText(/the all-time top 100/i)).toBeInTheDocument();
  });

  it('the CTA closes the modal', async () => {
    explainer.open = true;
    render(ExplainerModal);
    await fireEvent.click(screen.getByText(/let me blame someone/i));
    expect(explainer.open).toBe(false);
  });
});
