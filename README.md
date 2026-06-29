# blame-web

The **blame.today** web client — the "raw firehose." A client-side Svelte + Vite app that talks straight to nostr relays: the vote path has no backend, no auth, no rate limit (events go direct to relays). A thin Cloudflare Worker fronts the static site to force https, redirect `www` -> apex, and serve the MCP pointer at `/mcp`. This is the open, canonical realization of blame; the iOS app lives in the sibling **blame-ios** repo.

Split out of `blame-today/blame-mobile` (the old iOS app + worker repo) so each surface is honestly its own thing — they share a brand and the `pureblameapp` nostr tag, but no code, build, or deploy.

[check it out - blame.today](https://blame.today)

## what it is

- a blame target is a nostr `kind 1` event tagged `pureblameapp`; a vote is a `kind 7` reaction tagged `e:<targetId>` + `pureblameapp`. throwaway key per event.
- the leaderboard is built from relay `COUNT`s (all-time + a 24h "hot" window), not by fetching events.
- the News tab mines today's headlines client-side (`compromise`) into clickable suggestions.
- content filter (profanity / PII / gibberish) is the only gate — it's an open firehose.

## dev

```
npm install
npm run dev      # vite dev server
npm test         # vitest unit tests
npm run test:e2e # playwright
npm run build    # -> dist/
```

## deploy

Push to `main` → `.github/workflows/deploy-web.yml` builds `dist/` and runs `wrangler deploy`, publishing to the Cloudflare Worker (`blame-today`, Workers + Static Assets) that serves blame.today. The worker (`worker/index.js`) serves `dist/` as static assets, force-upgrades http → https, redirects `www` → apex, and serves the MCP inline at `/mcp` (`worker/mcp.js`). Needs `CLOUDFLARE_API_TOKEN` (Workers:Edit) + `CLOUDFLARE_ACCOUNT_ID` repo secrets. The `/about` prose lives in `public/about/` and Vite copies it into `dist/about/`.

Migrated off GitHub Pages 2026-06-16 — the zone is on Cloudflare now and blame.today is a custom domain on the worker. A push touching only `scripts/**` or `infra/**` skips the rebuild.

## infra (the Cloudflare config around the worker)

The CF "clicky layer" — DNS records, zone settings (HSTS, Always Use HTTPS), the `www` → apex redirect rule, and email routing (`*@blame.today` → gmail) — is declarative IaC in [`infra/`](infra/) (OpenTofu). **wrangler owns the worker code + the apex custom domain; OpenTofu owns everything else**, each resource with exactly one owner. See [`infra/README.md`](infra/README.md).
