# OpenTofu config for the blame.today Cloudflare zone — the "clicky layer" (DNS, zone
# settings, redirect rules, email routing) as declarative IaC. wrangler still owns the
# worker code deploy; this owns everything around it. See the adoption plan in personas:
# roy/corpus/2026-05-apps-free-tier-stack/opentofu-adoption-plan-2026-06-16.md
#
# Auth: the CF API token is injected from the keychain at run time, never written here:
#   secret run CLOUDFLARE_API_TOKEN=cf-iac-token -- tofu plan
# (the cloudflare provider reads CLOUDFLARE_API_TOKEN from the env automatically.)

terraform {
  required_version = ">= 1.9"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {}

# Stable identifiers for blame.today (zone) + Roy's account. Not secret.
locals {
  account_id = "b13c1cf2483bdad430b91ae25126e984"
  zone_id    = "ab714a5c20b69d7c836188b2c725184a"
}
