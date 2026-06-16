// blame.today is a Worker + Static Assets. The worker runs in front of the assets
// (assets.run_worker_first) so it can:
//   1. canonicalize the host: www.blame.today 301-redirects to the bare apex,
//   2. expose the MCP at blame.today/mcp by forwarding to the separate blame-mcp worker
//      (service binding = direct worker-to-worker, no network hop; the MCP stays isolated),
//   3. serve everything else straight from the static assets binding.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.blame.today") {
      url.hostname = "blame.today";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return env.MCP.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
