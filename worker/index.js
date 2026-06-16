// blame.today is a Worker + Static Assets. The worker runs in front of the assets
// (assets.run_worker_first) so it can canonicalize the host: www.blame.today 301-redirects to
// the bare apex, everything else is served straight from the static assets binding.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.blame.today") {
      url.hostname = "blame.today";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
