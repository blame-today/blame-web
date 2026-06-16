# blame.today zone settings managed as IaC.

# HSTS (HTTP Strict Transport Security). The first real CHANGE made through OpenTofu
# (2026-06-16): browsers that have seen this header refuse plain http for blame.today + its
# subdomains for max_age, hardening the https-everywhere posture we already set (Always Use
# HTTPS + the worker upgrade guard). preload is deliberately OFF — it's the genuinely
# hard-to-undo commitment (browser preload list), so we keep that escape hatch.
resource "cloudflare_zone_setting" "hsts" {
  zone_id    = local.zone_id
  setting_id = "security_header"
  value = {
    strict_transport_security = {
      enabled            = true
      max_age            = 15552000 # 6 months
      include_subdomains = true
      nosniff            = true
      preload            = false
    }
  }
}
