# blame-web

The **blame.today** web client — the "raw firehose." A pure client-side Svelte + Vite app that talks straight to nostr relays. No backend, no worker, no auth, no rate limit. This is the open, canonical realization of blame; the iOS app + its worker (the regulated version) live in the sibling **mobile** repo, and the canonical spec lives there at `docs/SPEC.md`.

Split out of `blame-today/blame-mobile` (the iOS app + worker repo, formerly `blame-today/blame`) so each surface is honestly its own thing — they share a brand and the `pureblameapp` nostr tag, but no code, build, or deploy.

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

Push to `main` → `.github/workflows/deploy-web.yml` builds `dist/` and publishes it to `blame-today/blame-today.github.io` (GitHub Pages serves blame.today). The `/about` prose lives in `public/about/` and Vite copies it into `dist/about/`. Needs a `WEB_DEPLOY_CLIENT_ID` variable + `WEB_DEPLOY_PRIVATE_KEY` secret (a GitHub App with Contents:write on the Pages repo).
