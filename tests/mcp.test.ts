import { describe, it, expect } from "vitest";
// @ts-expect-error — plain-JS worker module, no types
import { handleRpc, handleMcp, KIT } from "../worker/mcp.js";

const rpc = (method: string, params?: unknown, id: unknown = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("handleRpc (pure JSON-RPC)", () => {
  it("initialize returns serverInfo + a protocol version", () => {
    const r: any = handleRpc(rpc("initialize", { protocolVersion: "2025-06-18" }));
    expect(r.result.serverInfo.name).toBe("blame-today");
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.capabilities.tools).toBeDefined();
  });

  it("tools/list exposes exactly get_blame_recipe", () => {
    const r: any = handleRpc(rpc("tools/list"));
    expect(r.result.tools).toHaveLength(1);
    expect(r.result.tools[0].name).toBe("get_blame_recipe");
  });

  it("tools/call get_blame_recipe returns the KIT text", () => {
    const r: any = handleRpc(rpc("tools/call", { name: "get_blame_recipe" }));
    expect(r.result.isError).toBe(false);
    expect(r.result.content[0].text).toBe(KIT);
    expect(r.result.content[0].text).toContain("blame.today");
  });

  it("tools/call on an unknown tool is a -32602 error", () => {
    const r: any = handleRpc(rpc("tools/call", { name: "nope" }));
    expect(r.error.code).toBe(-32602);
  });

  it("unknown method is a -32601 error", () => {
    const r: any = handleRpc(rpc("frobnicate"));
    expect(r.error.code).toBe(-32601);
  });

  it("resources/list and prompts/list are empty (client-probe friendly)", () => {
    expect((handleRpc(rpc("resources/list")) as any).result.resources).toEqual([]);
    expect((handleRpc(rpc("prompts/list")) as any).result.prompts).toEqual([]);
  });

  it("a notification (no id) returns null", () => {
    expect(handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
});

describe("handleMcp (HTTP wrapper)", () => {
  const post = (body: unknown) =>
    handleMcp(new Request("https://blame.today/mcp", { method: "POST", body: JSON.stringify(body) }));

  it("bounds batches and body bytes before generating recipes", async () => {
    const message = rpc("tools/call", { name: "get_blame_recipe" });
    for (const count of [1, 15, 16]) {
      const response = await post(Array(count).fill(message));
      expect(response.status).toBe(200);
      expect(await response.json()).toHaveLength(count);
    }
    for (const body of [Array(17).fill(message), { ...message, padding: "x".repeat(65536) }]) {
      const response = await post(body);
      expect(response.status).toBe(413);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect((await response.json()).error.code).toBe(-32600);
    }
  });

  it("rejects invalid batch members and empty batches without throwing", async () => {
    const response = await post([null, false, 1, [], rpc("ping")]);
    const messages = await response.json();
    expect(messages.slice(0, 4).map((m: any) => m.error.code)).toEqual([-32600, -32600, -32600, -32600]);
    expect(messages[4].result).toEqual({});
    expect((await (await post([])).json()).error.code).toBe(-32600);
  });

  it("counts chunked multibyte data without trusting Content-Length", async () => {
    for (const length of [undefined, "1"]) {
      let cancelled = false;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"padding":"'));
          controller.enqueue(new TextEncoder().encode("é".repeat(33000)));
        },
        cancel() { cancelled = true; }
      });
      const response = await handleMcp(new Request("https://blame.today/mcp", {
        method: "POST", body, duplex: "half", headers: length ? { "content-length": length } : {}
      } as RequestInit));
      expect(response.status).toBe(413);
      expect(cancelled).toBe(true);
    }
  });

  it("OPTIONS is a 204 CORS preflight", async () => {
    const res = await handleMcp(new Request("https://blame.today/mcp", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("GET is 405 (stateless, no SSE)", async () => {
    const res = await handleMcp(new Request("https://blame.today/mcp"));
    expect(res.status).toBe(405);
  });

  it("POST initialize is a 200 JSON-RPC result", async () => {
    const res = await post(rpc("initialize"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.result.serverInfo.name).toBe("blame-today");
  });

  it("POST of only a notification is a 202 with no body", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });

  it("malformed JSON is a -32700 parse error", async () => {
    const res = await handleMcp(new Request("https://blame.today/mcp", { method: "POST", body: "{not json" }));
    const body: any = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it("a batch returns an array of responses", async () => {
    const res = await post([rpc("ping", undefined, 1), rpc("tools/list", undefined, 2)]);
    const body: any = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });
});
