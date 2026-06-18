# infra — blame.today Cloudflare config as IaC (OpenTofu)

The Cloudflare config *around* the worker, managed declaratively with [OpenTofu](https://opentofu.org)
and the `cloudflare` provider. The worker code itself is **not** here — wrangler owns that.

## the ownership boundary (important)

Each Cloudflare resource has exactly **one** owner, so the two tools never fight:

| Owner        | Owns                                                                          |
|--------------|-------------------------------------------------------------------------------|
| **wrangler** | the worker code + bindings (`wrangler.jsonc`) and the **apex** custom domain   |
| **OpenTofu** | DNS records, zone settings (HSTS, Always Use HTTPS), the `www`→apex redirect rule, email routing |

`www` is deliberately **not** a worker custom domain — it's a proxied `CNAME` → apex (managed here)
that the redirect rule 301s at the edge before any worker runs. Don't add `www` back to
`wrangler.jsonc`.

## what's managed

- `dns.tf` — the email MX + SPF/DKIM records, the anti-spoof TXT (DMARC + null-DKIM), and the `www` CNAME.
- `settings.tf` — HSTS + Always Use HTTPS zone settings.
- `rules.tf` — the `www`→apex single redirect (dynamic-redirect phase).
- `email.tf` — email routing settings + the `*@blame.today` → gmail catch-all.
- `imports.tf` — import blocks used to adopt the existing resources (kept as the bootstrap for a fresh state).

## auth

Two credentials, both injected at run time, never on disk:
- the **CF API token** (account-owned, scoped to `blame.today`: DNS:Edit, Zone Settings:Edit,
  Dynamic URL Redirects:Edit, Email Routing Rules) — for the cloudflare provider.
- the **R2 S3 access key + secret** — for the state backend.

All three live in [hush](https://github.com/royashbrook/hush) under namespace `blame`
(`cf-iac-token`, `r2-access-key-id`, `r2-secret-access-key`). The `.hush` manifest at the repo root
maps them to the env vars tofu reads, so one command injects everything:

```sh
hush exec -- tofu -chdir=infra plan     # review the diff
hush exec -- tofu -chdir=infra apply    # apply it
```

(No hush? `export CLOUDFLARE_API_TOKEN=… AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…` then run
`tofu` directly. In CI the same three come from GH secrets, see `.github/workflows/infra.yml`.)

## state

State lives in an **R2 bucket** (`blame-tfstate`, S3 backend, locked via `use_lockfile`), so CI and
local runs agree on reality. The R2 S3 creds come from hush (above). The provider lock file
(`.terraform.lock.hcl`) **is** committed (pins the version); any local `*.tfstate` is gitignored
scratch now that R2 is authoritative.

## adding/changing a resource

1. edit (or add) the `.tf` file.
2. `tofu plan` — read the diff. zone-setting resources can't be destroyed from TF, only re-set.
3. `tofu apply`.

To **adopt** an existing CF resource instead of recreating it: add an `import` block, run
`tofu plan -generate-config-out=generated.tf` (the provider writes the matching HCL from live
reality — don't hand-author the v5 schema), tidy it into the right file, then `apply`. Note: a
`cloudflare_ruleset` import id needs the `zones/<zone_id>/<ruleset_id>` prefix; DNS records use the
plain `<zone_id>/<record_id>` form.
