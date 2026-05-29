# blame.today — marketing site

Static HTML for **[blame.today](https://blame.today)** — the public face
of the blame app. Hosted on GitHub Pages from this repo.

## what's in this repo

- `index.html` — the home page
- `costs.html` — the running costs ledger (modeled on cushion's)
- `CNAME` — points GitHub Pages at `blame.today`

That's it. Vanilla HTML, vanilla CSS, no build step. The home page
fetches `https://blame-worker.royashbrook.workers.dev/leaderboard`
client-side and renders today's board.

## why this is its own repo

The main app code lives at
[`blame-today/blame`](https://github.com/blame-today/blame) (private during
dev). This marketing repo is **public** so:

- GitHub Pages can serve it (private repo Pages requires a paid plan)
- "open source by default" — `view source` in the browser gives you the whole site
- separation of concerns — marketing changes don't churn the app repo

When we sync changes from the app repo's `web/` directory, copy the
files here and push.

## deploy

Push to `main` and it auto-builds:

```
git push origin main
```

GitHub Pages auto-publishes from `main` → `blame.today` (via the CNAME).
DNS at godaddy points `blame.today` → `blame-today.github.io`.

## license

MIT. See the [main repo](https://github.com/blame-today/blame) for the
canonical source + the architecture docs.
