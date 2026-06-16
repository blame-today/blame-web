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

  # State lives in an R2 bucket (S3-compatible), per-project + locked so CI and any other
  # applier agree on reality. The R2 S3 creds come from the env (AWS_ACCESS_KEY_ID /
  # AWS_SECRET_ACCESS_KEY) at run time, never hardcoded — locally via `secret run`, in CI via
  # GH secrets. The skip_*/use_path_style/skip_s3_checksum flags are the standard "this is R2,
  # not real AWS S3" set; use_lockfile = S3-native locking (no DynamoDB).
  backend "s3" {
    bucket                      = "blame-tfstate"
    key                         = "blame.tfstate"
    region                      = "auto"
    endpoints                   = { s3 = "https://b13c1cf2483bdad430b91ae25126e984.r2.cloudflarestorage.com" }
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_path_style              = true
    use_lockfile                = true
  }
}

provider "cloudflare" {}

# Stable identifiers for blame.today (zone) + Roy's account. Not secret.
locals {
  account_id = "b13c1cf2483bdad430b91ae25126e984"
  zone_id    = "ab714a5c20b69d7c836188b2c725184a"
}
