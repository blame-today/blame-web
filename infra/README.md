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

The CF API token is **account-owned**, scoped to the `blame.today` zone, with: DNS:Edit,
Zone Settings:Edit, Dynamic URL Redirects:Edit, Email Routing Rules/Addresses. It is injected from
the keychain at run time and never written to disk:

```sh
cd infra
secret run CLOUDFLARE_API_TOKEN=cf-iac-token -- tofu plan     # review the diff
secret run CLOUDFLARE_API_TOKEN=cf-iac-token -- tofu apply    # apply it
```

(No keychain helper? `export CLOUDFLARE_API_TOKEN=<token>` then run `tofu` directly.)

## state

Local for now (`*.tfstate`, gitignored). Move to an R2 backend if/when CI or a second machine needs
to apply. The provider lock file (`.terraform.lock.hcl`) **is** committed — it pins the version.

## adding/changing a resource

1. edit (or add) the `.tf` file.
2. `tofu plan` — read the diff. zone-setting resources can't be destroyed from TF, only re-set.
3. `tofu apply`.

To **adopt** an existing CF resource instead of recreating it: add an `import` block, run
`tofu plan -generate-config-out=generated.tf` (the provider writes the matching HCL from live
reality — don't hand-author the v5 schema), tidy it into the right file, then `apply`. Note: a
`cloudflare_ruleset` import id needs the `zones/<zone_id>/<ruleset_id>` prefix; DNS records use the
plain `<zone_id>/<record_id>` form.
