import { describe, it, expect } from "vitest";
// @ts-expect-error — plain-JS worker entry, no types
import worker from "../worker/index.js";

// A mock ASSETS binding that records the request and returns a sentinel, so we can tell
// "served from static assets" apart from a redirect or the inline /mcp handler.
const sentinel = () => {
  let seen: Request | null = null;
  const env = { ASSETS: { fetch: (req: Request) => { seen = req; return new Response("ASSET", { status: 200 }); } } };
  return { env, served: () => seen };
};

const fetchUrl = (url: string, init?: RequestInit) => {
  const m = sentinel();
  return worker.fetch(new Request(url, init), m.env).then((res: Response) => ({ res, served: m.served() }));
};

describe("worker fetch routing", () => {
  it("plain http on the real domain 301s to https", async () => {
    const { res, served } = await fetchUrl("http://blame.today/agents");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://blame.today/agents");
    expect(served).toBeNull(); // never reached assets
  });

  it("does NOT redirect non-blame hosts (e.g. localhost dev) — serves assets", async () => {
    const { res, served } = await fetchUrl("http://localhost:8799/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ASSET");
    expect(served).not.toBeNull();
  });

  it("www 301s to the bare apex over https", async () => {
    const { res } = await fetchUrl("https://www.blame.today/x?y=1");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://blame.today/x?y=1");
  });

  it("https apex serves from static assets", async () => {
    const { res, served } = await fetchUrl("https://blame.today/");
    expect(res.status).toBe(200);
    expect(served).not.toBeNull();
  });

  it("/mcp is handled inline (no asset hit) — POST initialize returns a JSON-RPC result", async () => {
    const { res, served } = await fetchUrl("https://blame.today/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.result.serverInfo.name).toBe("blame-today");
    expect(served).toBeNull();
  });

  it("GET /mcp is 405 and never touches assets", async () => {
    const { res, served } = await fetchUrl("https://blame.today/mcp");
    expect(res.status).toBe(405);
    expect(served).toBeNull();
  });
});
