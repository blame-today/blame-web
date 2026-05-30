import { test, expect } from '@playwright/test';

// Mock every relay WebSocket so flows are deterministic and never touch live Nostr:
//   REQ  -> EOSE (no stored topics)        COUNT -> 0        EVENT -> OK true (accepted)
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/.*/, (ws) => {
    ws.onMessage((message) => {
      let p: any;
      try {
        p = JSON.parse(String(message));
      } catch {
        return;
      }
      if (p[0] === 'REQ') ws.send(JSON.stringify(['EOSE', p[1]]));
      else if (p[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', p[1], { count: 0 }]));
      else if (p[0] === 'EVENT') ws.send(JSON.stringify(['OK', p[1].id, true, '']));
    });
  });
  await page.goto('/');
});

test('connects to all five relays', async ({ page }) => {
  await expect(page.getByTitle('5 of 5 relays connected')).toBeVisible();
});

test('blaming a target jumps to Mine and counts the opening vote', async ({ page }) => {
  await page.getByPlaceholder('Type target to blame...').fill('Robot Uprising');
  await page.getByRole('button', { name: 'Blame', exact: true }).click();

  // the board switches to the Mine filter
  await expect(page.getByRole('button', { name: 'Mine' })).toHaveClass(/bg-orange-600/);

  // the new topic is pinned, carrying its opening self-vote
  const row = page.locator('.divide-y > div').filter({ hasText: 'Robot Uprising' });
  await expect(row).toBeVisible();
  await expect(row.locator('.tabular-nums')).toHaveText('1');
});

test('+1 climbs the count', async ({ page }) => {
  await page.getByPlaceholder('Type target to blame...').fill('Slow Wifi');
  await page.getByRole('button', { name: 'Blame', exact: true }).click();

  const row = page.locator('.divide-y > div').filter({ hasText: 'Slow Wifi' });
  await expect(row.locator('.tabular-nums')).toHaveText('1');
  await row.getByRole('button', { name: '+1' }).click();
  await expect(row.locator('.tabular-nums')).toHaveText('2');
});

test('rejects profanity with a fiery placeholder and does not post', async ({ page }) => {
  // #inp, not getByPlaceholder — reject() rewrites the placeholder, so a placeholder locator
  // would stop matching the very element under test.
  const input = page.locator('#inp');
  await input.fill('shit');
  await page.getByRole('button', { name: 'Blame', exact: true }).click();
  await expect(input).toHaveJSProperty('placeholder', '🔥 No bad words! 🔥');
  await expect(input).toHaveValue('');
  // nothing was posted to the relays
  await expect(page.getByText('No blame yet. Be the first to point a finger.')).toBeVisible();
});

test('filters switch between All and Mine', async ({ page }) => {
  await page.getByPlaceholder('Type target to blame...').fill('Meetings');
  await page.getByRole('button', { name: 'Blame', exact: true }).click();

  const row = () => page.locator('.divide-y > div').filter({ hasText: 'Meetings' });
  await expect(row()).toBeVisible(); // on Mine (post-blame)
  await page.getByRole('button', { name: 'All' }).click();
  await expect(row()).toBeVisible(); // and on All (it has a confirmed vote)
  await expect(row().getByTitle('you blamed this')).toBeVisible(); // marked with the "I blamed" sticker
});

test('the News tab mines blameable entities from headlines and +1 promotes them', async ({ page }) => {
  // mock CNN Lite so the feed is deterministic and never hits the live site
  await page.route('https://lite.cnn.com/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><body>
        <a href="/2026/01/01/a">Kenya opens a controversial new health facility near the capital</a>
        <a href="/2026/01/01/b">Critics blast Kenya over its handling of the latest crisis</a>
        <a href="/2026/01/01/c">NATO allies meet in Brussels to discuss the drone threat</a>
      </body></html>`,
    }),
  );
  await page.getByRole('button', { name: 'News' }).click();

  // an entity mined from the headlines appears, carrying a link to its source article
  const row = page.locator('.divide-y > div').filter({ hasText: 'Kenya' }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row.locator('a')).toHaveAttribute('href', 'https://lite.cnn.com/2026/01/01/a');

  // +1 votes it up right here — minting the topic and casting the opening vote, no tab-switch
  await row.getByRole('button', { name: '+1' }).click();
  await expect(row.locator('span.bg-slate-950')).toHaveText('1');
});

test('the News tab falls back to the next source when the first is unreachable', async ({ page }) => {
  await page.route('https://lite.cnn.com/', (route) => route.abort()); // CNN rejects us
  await page.route('https://moxie.foxnews.com/google-publisher/latest.xml', (route) =>
    route.fulfill({
      contentType: 'application/xml',
      body: `<?xml version="1.0"?><rss><channel>
        <item><title>Kenya opens a controversial new health facility near the capital</title><link>https://www.foxnews.com/a</link></item>
        <item><title>NATO allies meet in Brussels to discuss the latest drone threat</title><link>https://www.foxnews.com/b</link></item>
      </channel></rss>`,
    }),
  );
  await page.getByRole('button', { name: 'News' }).click();

  // it fell through to Fox and still produced entities
  const row = page.locator('.divide-y > div').filter({ hasText: 'Kenya' }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  // and credits the source that actually answered
  await expect(page.getByRole('link', { name: 'Fox News' })).toBeVisible();
});
