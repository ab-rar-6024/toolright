import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolInfo } from "../src/mcp/connect.js";
import { anthropicProvider } from "../src/providers/anthropic.js";
import { createProvider } from "../src/providers/index.js";
import { openaiProvider } from "../src/providers/openai.js";

const tools: ToolInfo[] = [
  { name: "search.issues", description: "Search issues", inputSchema: { type: "object", properties: {} } },
  { name: "list_issues", description: "List issues", inputSchema: { type: "object", properties: {} } },
];

interface Seen {
  url: string;
  headers: IncomingMessage["headers"];
  body: any;
}

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function fake(handler: (seen: Seen, n: number) => { status?: number; json: unknown }): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const s: Seen = { url: req.url ?? "", headers: req.headers, body: JSON.parse(data || "{}") };
      seen.push(s);
      const out = handler(s, seen.length);
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
}

describe("openai-compatible provider", () => {
  it("sends tools with sanitized names and maps the pick back", async () => {
    const f = await fake((s) => ({
      json: { choices: [{ message: { tool_calls: [{ function: { name: s.body.tools[0].function.name } }] } }] },
    }));
    const p = openaiProvider({ id: "x", baseUrl: f.url + "/v1", model: "m", apiKey: "sk-secret" });
    const res = await p.pick(tools, "find bugs about login");
    expect(f.seen[0]!.url).toBe("/v1/chat/completions");
    expect(f.seen[0]!.headers.authorization).toBe("Bearer sk-secret");
    expect(f.seen[0]!.body.tools[0].function.name).toBe("search_issues"); // "." sanitized
    expect(f.seen[0]!.body.tools[0].function.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(res.tool).toBe("search.issues"); // mapped back to the real MCP name
  });

  it("returns null (not an error) when the model answers in text", async () => {
    const f = await fake(() => ({ json: { choices: [{ message: { content: "I would search." } }] } }));
    const res = await openaiProvider({ id: "x", baseUrl: f.url, model: "m" }).pick(tools, "hi");
    expect(res).toEqual({ tool: null });
  });

  it("retries without temperature when the model rejects it", async () => {
    const f = await fake((s, n) =>
      n === 1
        ? { status: 400, json: { error: { message: "Unsupported value: 'temperature' does not support 0" } } }
        : { json: { choices: [{ message: { tool_calls: [{ function: { name: "list_issues" } }] } }] } },
    );
    const res = await openaiProvider({ id: "x", baseUrl: f.url, model: "m" }).pick(tools, "hi");
    expect(f.seen).toHaveLength(2);
    expect(f.seen[0]!.body.temperature).toBe(0);
    expect("temperature" in f.seen[1]!.body).toBe(false);
    expect(res.tool).toBe("list_issues");
  });

  it("reports API failures as errors without leaking the key", async () => {
    const f = await fake(() => ({ status: 401, json: { error: "bad key" } }));
    const res = await openaiProvider({ id: "x", baseUrl: f.url, model: "m", apiKey: "sk-secret" }).pick(tools, "hi");
    expect(res.tool).toBeNull();
    expect(res.error).toContain("401");
    expect(res.error).not.toContain("sk-secret");
  });

  it("complete() returns text", async () => {
    const f = await fake(() => ({ json: { choices: [{ message: { content: "hello" } }] } }));
    expect(await openaiProvider({ id: "x", baseUrl: f.url, model: "m" }).complete("s", "u")).toBe("hello");
  });
});

describe("anthropic provider", () => {
  it("uses x-api-key + version headers and reads tool_use blocks", async () => {
    const f = await fake((s) => ({ json: { content: [{ type: "text", text: "..." }, { type: "tool_use", name: s.body.tools[1].name }] } }));
    const p = anthropicProvider({ id: "a", model: "m", apiKey: "ak-secret", baseUrl: f.url });
    const res = await p.pick(tools, "list them");
    expect(f.seen[0]!.url).toBe("/v1/messages");
    expect(f.seen[0]!.headers["x-api-key"]).toBe("ak-secret");
    expect(f.seen[0]!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(f.seen[0]!.body.tools[0].input_schema).toBeDefined();
    expect(res.tool).toBe("list_issues");
  });

  it("complete() joins text blocks", async () => {
    const f = await fake(() => ({ json: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }));
    expect(await anthropicProvider({ id: "a", model: "m", apiKey: "k", baseUrl: f.url }).complete("s", "u")).toBe("ab");
  });
});

describe("createProvider", () => {
  it("requires the right env var and never reads keys from anywhere else", () => {
    expect(() => createProvider("groq:llama", {})).toThrow(/GROQ_API_KEY/);
    expect(() => createProvider("openai:gpt", {})).toThrow(/OPENAI_API_KEY/);
    expect(() => createProvider("gemini:g", {})).toThrow(/GEMINI_API_KEY/);
    expect(() => createProvider("anthropic:c", {})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("ollama needs no key and is marked local; cloud providers are not", () => {
    expect(createProvider("ollama:qwen2.5:3b", {}).local).toBe(true);
    expect(createProvider("groq:llama", { GROQ_API_KEY: "k" }).local).toBe(false);
    expect(createProvider("ollama:qwen2.5:3b", {}).id).toBe("ollama:qwen2.5:3b");
  });

  it("rejects unknown providers and missing model ids", () => {
    expect(() => createProvider("nope:x", {})).toThrow(/Unknown provider/);
    expect(() => createProvider("groq", { GROQ_API_KEY: "k" })).toThrow(/needs a model id/);
    expect(() => createProvider("custom:m", {})).toThrow(/TOOLRIGHT_BASE_URL/);
  });
});
