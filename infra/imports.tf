# Import blocks: adopt the EXISTING blame.today DNS records into OpenTofu state without
# recreating them. `tofu plan -generate-config-out=generated.tf` reads live reality and writes
# matching HCL, so we don't hand-guess the v5 provider schema. Record ids pulled live 2026-06-16.
#
# NOTE (the co-management boundary, to settle before any apply):
#  - aaaa_apex / aaaa_www (100:: proxied) are the WORKER custom-domain records, today managed by
#    wrangler. importing them here is read-only; we decide the owner before applying.
#  - the MX + spf + cf2024 DKIM are created by CF Email Routing. _dmarc + null-DKIM are ours.

import {
  to = cloudflare_dns_record.mx_route1
  id = "ab714a5c20b69d7c836188b2c725184a/b7d9032919432b91eced99138cf3ae78"
}
import {
  to = cloudflare_dns_record.mx_route2
  id = "ab714a5c20b69d7c836188b2c725184a/392ff77a4cfee2078715cc1b042c109c"
}
import {
  to = cloudflare_dns_record.mx_route3
  id = "ab714a5c20b69d7c836188b2c725184a/f60495d1bfbf0d0fa470112422d3fdd0"
}
import {
  to = cloudflare_dns_record.txt_spf
  id = "ab714a5c20b69d7c836188b2c725184a/9bf207da93f9916c9e93aac71bb41656"
}
import {
  to = cloudflare_dns_record.txt_dkim_cf2024
  id = "ab714a5c20b69d7c836188b2c725184a/a0da86d75127548493352952f50ab1bb"
}
import {
  to = cloudflare_dns_record.txt_dmarc
  id = "ab714a5c20b69d7c836188b2c725184a/2b2ac18aecb0e73257df8c1753b68026"
}
import {
  to = cloudflare_dns_record.txt_dkim_null
  id = "ab714a5c20b69d7c836188b2c725184a/fd63d1e5d8433290a18141737decdf3c"
}
import {
  to = cloudflare_dns_record.aaaa_apex
  id = "ab714a5c20b69d7c836188b2c725184a/b6fd20449674bf54c843b3e5a3fa4963"
}
import {
  to = cloudflare_dns_record.aaaa_www
  id = "ab714a5c20b69d7c836188b2c725184a/b0b012beddd2391817b13e34369bf4ce"
}
