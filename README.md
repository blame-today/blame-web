# blame marketing site

static HTML for the marketing/web shell. hosted on **GitHub Pages** — really open source.

## why github pages and not cloudflare pages

- the marketing site lives in a public repo; visiting `view source` gives the whole site
- cloudflare hosts the worker + the data; github hosts the public-facing page
- reinforces "blame isn't powered by any single platform — we're a participant"
- soft 100GB/mo bandwidth on GH Pages is plenty for a marketing page

## hooks up to

- the worker at `BLAME_WORKER_URL` (currently `https://blame-worker.royashbrook.workers.dev` — update post-deploy)
- the worker's `/leaderboard` and `/trending` endpoints

## deploy

push to the `gh-pages` branch (or use the gh-pages source = main with `/web` directory):

```
# from repo root, once gh-pages source is set in repo settings:
git push origin main
```

settings → pages → source: main / `/web`

once Pages is wired up the site is live at `https://royashbrook.github.io/blame/`. add a custom
domain (e.g. `blame.app` or whatever) later.
