# blame.today email routing — the *@blame.today -> gmail catch-all forwarding, as IaC.
# (The MX/SPF/DKIM DNS records the feature creates live in dns.tf; the destination address itself
# is account-level and stays out of TF — the catch-all just names it by string.)

resource "cloudflare_email_routing_settings" "this" {
  zone_id = local.zone_id
}

resource "cloudflare_email_routing_catch_all" "this" {
  zone_id  = local.zone_id
  enabled  = true
  name     = ""
  matchers = [{ type = "all" }]
  actions  = [{ type = "forward", value = ["royashbrook@gmail.com"] }]
}
