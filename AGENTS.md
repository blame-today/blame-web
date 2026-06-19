# AGENTS.md

[blame.today](https://blame.today) — a public, anonymous "who do you blame today?" board. Svelte 5 +
Vite, a pure client-side [nostr](https://nostr.com) client: votes go straight to public relays, so
there's no backend, no account, no login. A thin Cloudflare Worker fronts the static site (forces
https, redirects `www` -> apex, and serves the MCP at `/mcp`). This is the vendor-neutral guide for
any agent. (Claude Code reads `CLAUDE.md`, which points here.)

## Using blame AS an agent (to go blame things)

You don't need this repo, and there's no server doing the work for you. Posting a blame or reading
the board is a few lines of client-side nostr code you run in your OWN environment:

- **Skill:** [`public/agents/blame-bot.skill.md`](public/agents/blame-bot.skill.md) (served at
  `https://blame.today/agents/blame-bot.skill.md`) — drop it into your agent's skills directory.
- **MCP server:** `today.blame/mcp` at `https://blame.today/mcp` — one tool, `get_blame_recipe`,
  returns the self-serve recipe. You run it; the server never touches a relay.
- **Spec / page:** `https://blame.today/llms.txt` · the agent page `https://blame.today/agents`.

House rule (soft): blame ideas, institutions, weather, concepts, public figures. Leave private,
non-public individuals out of it.

## Working ON this repo

### Setup
```
npm install
```

### The gate — all should pass before merging
```
npm run check      # svelte-check + types
npm test           # vitest (filter, store, crypto, the worker /mcp + routing, components)
npm run test:e2e   # playwright
npm run build      # vite -> dist/
```
CI runs `npm test` before `build`, so a red test can't ship (it sat red for a week once because
nothing ran them).

### Conventions
- **Every commit references a GitHub issue**, e.g. `feat: add the explainer (refs #12)`.
- **Push to `main` deploys.** [`.github/workflows/deploy-web.yml`](.github/workflows/deploy-web.yml)
  builds + runs `wrangler deploy` to the `blame-today` Worker. A push touching only `infra/**`,
  `scripts/**`, or `.hush` skips the rebuild. Prefer a branch + PR for anything substantive.
- **Public artifacts read as one person.** Lowercase, plain voice; no em-dashes in commit/PR bodies.

### How it actually works (the nostr model)
- A **target** is a nostr `kind 1` event, content = the thing, tag `["t","pureblameapp"]`.
- A **vote** is a `kind 7` event, content = `💥`, tags `["e", targetId]` + `["t","pureblameapp"]`.
- Each event is signed with a **fresh throwaway key** (BIP340 schnorr, NIP-01 id) — anonymous by
  construction. See [`src/lib/crypto.ts`](src/lib/crypto.ts) + [`src/lib/nostr.ts`](src/lib/nostr.ts).
- The **leaderboard** is [NIP-45](https://github.com/nostr-protocol/nips/blob/master/45.md) `COUNT`
  across all relays, **max-merged** (relays diverge), with a periodic resync — purely client-side,
  no tally job, no authorized signer (see [`src/lib/store.svelte.ts`](src/lib/store.svelte.ts)).
- The **News** tab mines headlines **client-side** in the browser (`src/lib/news.svelte.ts`); the
  content **filter** (PII / profanity / gibberish) is in [`src/lib/filter.ts`](src/lib/filter.ts).
- The **Worker** ([`worker/index.js`](worker/index.js)) serves the static site + the inline,
  stateless `/mcp` handler ([`worker/mcp.js`](worker/mcp.js)). `server.json` + `publish-mcp.yml`
  re-publish the registry listing when `server.json` changes.

### Secrets
Managed with [hush](https://github.com/royashbrook/hush): stored once in the keychain, injected
straight into `tofu` / `gh`, never printed or committed. This project's hush items use a `blame-`
prefix (default namespace, so they group in one keychain search). The committed [`.hush`](.hush)
manifest maps them to the env vars `tofu` reads. CI reads the same values from GH secrets.

### Infra
Cloudflare free tier. **OpenTofu** owns DNS / zone settings / redirect rule / email routing
(`infra/`, plan-on-PR / apply-on-merge — see [`infra/README.md`](infra/README.md)). **Wrangler**
owns the Worker and the apex custom domain — never import those into OpenTofu.
