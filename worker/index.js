// blame.today is a Worker + Static Assets. The worker runs in front of the assets
// (assets.run_worker_first) so it can:
//   1. force HTTPS: any plain-http hit 301s to https (belt-and-suspenders with the zone's
//      Always Use HTTPS toggle, so the worker is correct even if that toggle is ever off),
//   2. canonicalize the host: www.blame.today 301-redirects to the bare apex (over https),
//   3. serve the MCP inline at blame.today/mcp (a tiny stateless JSON-RPC server, see worker/mcp.js
//      — folded in from the old standalone blame-mcp worker; a one-tool pointer never needed its own),
//   4. serve everything else straight from the static assets binding.
import { handleMcp } from "./mcp.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.protocol === "http:" && url.hostname.endsWith("blame.today")) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    if (url.hostname === "www.blame.today") {
      url.hostname = "blame.today";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return handleMcp(request);
    }

    return env.ASSETS.fetch(request);
  },
};
