# blame.today DNS records, imported from live reality 2026-06-16 (see imports.tf).
# Grouped by who set them, because that's the co-management boundary we have to respect:
# wrangler owns the worker records today, CF Email Routing creates its own, we hand-set anti-spoof.

# The APEX (blame.today) stays a WORKER custom domain owned by wrangler (its proxied AAAA 100::
# record is wrangler's, not managed here) — it's the worker's front door for the site + /mcp.

# www is NOT a worker custom domain anymore: just a proxied CNAME -> apex, which brings www to
# CF's edge so the www->apex redirect rule (rules.tf) 301s it before any worker runs. TF owns this.
resource "cloudflare_dns_record" "www_cname" {
  zone_id = local.zone_id
  name    = "www.blame.today"
  type    = "CNAME"
  content = "blame.today"
  proxied = true
  ttl     = 1
}

# --- CF Email Routing records (created by the Email Routing feature) ---
resource "cloudflare_dns_record" "mx_route1" {
  zone_id  = local.zone_id
  name     = "blame.today"
  type     = "MX"
  content  = "route1.mx.cloudflare.net"
  priority = 90
  proxied  = false
  ttl      = 1
}

resource "cloudflare_dns_record" "mx_route2" {
  zone_id  = local.zone_id
  name     = "blame.today"
  type     = "MX"
  content  = "route2.mx.cloudflare.net"
  priority = 46
  proxied  = false
  ttl      = 1
}

resource "cloudflare_dns_record" "mx_route3" {
  zone_id  = local.zone_id
  name     = "blame.today"
  type     = "MX"
  content  = "route3.mx.cloudflare.net"
  priority = 99
  proxied  = false
  ttl      = 1
}

resource "cloudflare_dns_record" "txt_spf" {
  zone_id = local.zone_id
  name    = "blame.today"
  type    = "TXT"
  content = "\"v=spf1 include:_spf.mx.cloudflare.net ~all\""
  proxied = false
  ttl     = 1
}

resource "cloudflare_dns_record" "txt_dkim_cf2024" {
  zone_id = local.zone_id
  name    = "cf2024-1._domainkey.blame.today"
  type    = "TXT"
  content = "\"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiweykoi+o48IOGuP7GR3X0MOExCUDY/BCRHoWBnh3rChl7WhdyCxW3jgq1daEjPPqoi7sJvdg5hEQVsgVRQP4DcnQDVjGMbASQtrY4WmB1VebF+RPJB2ECPsEDTpeiI5ZyUAwJaVX7r6bznU67g7LvFq35yIo4sdlmtZGV+i0H4cpYH9+3JJ78k\" \"m4KXwaf9xUJCWF6nxeD+qG6Fyruw1Qlbds2r85U9dkNDVAS3gioCvELryh1TxKGiVTkg4wqHTyHfWsp7KD3WQHYJn0RyfJJu6YEmL77zonn7p2SRMvTMP3ZEXibnC9gz3nnhR6wcYL8Q7zXypKTMD58bTixDSJwIDAQAB\""
  proxied = false
  ttl     = 1
}

# --- anti-spoof (hand-set by us; nothing else manages these) ---
resource "cloudflare_dns_record" "txt_dmarc" {
  zone_id = local.zone_id
  name    = "_dmarc.blame.today"
  type    = "TXT"
  content = "\"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;\""
  proxied = false
  ttl     = 1
}

resource "cloudflare_dns_record" "txt_dkim_null" {
  zone_id = local.zone_id
  name    = "*._domainkey.blame.today"
  type    = "TXT"
  content = "\"v=DKIM1; p=\""
  proxied = false
  ttl     = 1
}

# --- MCP registry domain-ownership proof ---
# Lets us publish the MCP server under the `today.blame` namespace (reverse-DNS of blame.today).
# Public key only; the matching private key is a GH secret (MCP_DNS_PRIVATE_KEY in this repo) that
# the publish workflow (.github/workflows/publish-mcp.yml) signs with. Coexists with the SPF TXT on
# the apex (multiple TXT allowed).
resource "cloudflare_dns_record" "txt_mcp_registry" {
  zone_id = local.zone_id
  name    = "blame.today"
  type    = "TXT"
  content = "\"v=MCPv1; k=ed25519; p=7cj58WJMNfHjIz+XVsQn0EQth5ACiLN2erxItb92ZiI=\""
  proxied = false
  ttl     = 1
}
