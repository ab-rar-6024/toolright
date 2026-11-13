import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { Budget, ProviderUnavailable, evaluate } from "../src/eval/run.js";
import { generatePrompts, loadPrompts, type TestPrompt } from "../src/gen/prompts.js";
import { lint } from "../src/lint/index.js";
import { siblingMap } from "../src/lint/overlap.js";
import { loadTools, type ToolInfo } from "../src/mcp/connect.js";
import { heuristicProvider } from "../src/providers/heuristic.js";
import { openaiProvider } from "../src/providers/openai.js";
import { makeNameMap, type Provider } from "../src/providers/types.js";
import { descriptionDiff, evalReport, tuneJson, tuneReport } from "../src/report/index.js";
import { tune } from "../src/tune/index.js";
import { extractJson } from "../src/util.js";

const tool = (name: string, description: string): ToolInfo => ({ name, description, inputSchema: { type: "object", properties: {} } });

/** A port nothing is listening on (bind, note the port, release it). */
async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers = [];
});

describe("hostile tool names (prototype pollution / crashes)", () => {
  const nasty = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "__defineGetter__"];
  const tools = nasty.map((n) => tool(n, `Does the ${n} thing with some data and returns the result of the ${n} operation`));
  const prompts: TestPrompt[] = nasty.flatMap((n, k) =>
    ["train", "train", "validate", "test"].map((split, i) => ({
      id: `${n}#${i}`, text: `please run the ${n} operation number ${i} on my data ${k}`, expected: n, kind: "direct" as const, split: split as TestPrompt["split"],
    })),
  );
  const rewriter: Provider = {
    id: "rw", local: true, pick: async () => ({ tool: null }),
    complete: async () => JSON.stringify({ description: "A clearly rewritten description that is long enough to pass the length check." }),
  };

  it("survives lint, siblings, eval, tune and reporting without crashing or polluting Object.prototype", async () => {
    const lr = await lint(tools, { threshold: 0.1 });
    const sib = siblingMap(lr.pairs);
    expect(sib).toBeInstanceOf(Map);
    const res = await evaluate(heuristicProvider(), tools, prompts, { repeats: 2, concurrency: 2, seed: 1 });
    expect(res.items.length).toBe(prompts.length * 2);
    const t = await tune({ tools, prompts, providers: [heuristicProvider()], rewriter, evalOpts: { repeats: 3, concurrency: 2, seed: 1 }, maxRewrites: 6, weakThreshold: 1.01 });
    expect(() => [tuneReport(t), JSON.stringify(tuneJson(t)), descriptionDiff(t), evalReport([res], prompts, 2)]).not.toThrow();
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
  });

  it("gen survives hostile names too", async () => {
    const gen: Provider = {
      id: "g", local: true, pick: async () => ({ tool: null }),
      complete: async () => JSON.stringify({ direct: ["please do the thing with my files today", "another realistic request here"], near_miss: [] }),
    };
    const sib = new Map<string, string[]>([["__proto__", ["constructor"]], ["constructor", ["__proto__"]]]);
    const out = await generatePrompts(gen, tools, { perTool: 2, nearMiss: 1, seed: 1, siblings: sib });
    expect(out.length).toBeGreaterThan(0);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("tool-name mapping stays unique and reversible for colliding names", () => {
    const ts = [tool("a.b", "x"), tool("a_b", "y"), tool("a b", "z"), tool("x".repeat(100), "w")];
    const { toSafe, toReal } = makeNameMap(ts);
    const safes = ts.map((t) => toSafe.get(t.name)!);
    expect(new Set(safes).size).toBe(ts.length);
    for (const t of ts) expect(toReal.get(toSafe.get(t.name)!)).toBe(t.name);
    for (const s of safes) expect(s).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});

describe("provider failure handling", () => {
  it("aborts fast when a provider fails every call instead of burning the whole run", async () => {
    let calls = 0;
    const dead: Provider = { id: "dead", local: false, pick: async () => { calls++; return { tool: null, error: "HTTP 401: bad key" }; }, complete: async () => "" };
    const prompts = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, text: `prompt ${i}`, expected: "a", kind: "direct" as const, split: "train" as const }));
    await expect(evaluate(dead, [tool("a", "x"), tool("b", "y")], prompts, { repeats: 1, concurrency: 1, seed: 1 })).rejects.toBeInstanceOf(ProviderUnavailable);
    expect(calls).toBeLessThan(20);
  });

  it("does not abort when only some calls fail", async () => {
    let n = 0;
    const flaky: Provider = { id: "f", local: false, pick: async () => (++n % 3 === 0 ? { tool: null, error: "HTTP 429" } : { tool: "a" }), complete: async () => "" };
    const prompts = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, text: `prompt ${i}`, expected: "a", kind: "direct" as const, split: "train" as const }));
    const r = await evaluate(flaky, [tool("a", "x"), tool("b", "y")], prompts, { repeats: 1, concurrency: 1, seed: 1 });
    expect(r.items).toHaveLength(30);
  });

  it("a connection refusal fails fast with a readable message (no 15s of retries per call)", async () => {
    const p = openaiProvider({ id: "x", baseUrl: `http://127.0.0.1:${await closedPort()}/v1`, model: "m" });
    const t0 = Date.now();
    const res = await p.pick([tool("a", "x")], "hi");
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(res.error).toMatch(/connect|ECONNREFUSED|reach/i);
  });

  it("does not retry a 200 response that isn't JSON", async () => {
    let hits = 0;
    const s = createServer((_q, res) => { hits++; res.writeHead(200); res.end("<html>captive portal</html>"); });
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const p = openaiProvider({ id: "x", baseUrl: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, model: "m" });
    const t0 = Date.now();
    const res = await p.pick([tool("a", "x")], "hi");
    expect(hits).toBe(1);
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(res.error).toBeDefined();
  });

  it("retries a 429 and then succeeds", async () => {
    let hits = 0;
    const s = createServer((_q, res) => {
      hits++;
      if (hits === 1) { res.writeHead(429, { "retry-after": "0" }); return void res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "a" } }] } }] }));
    });
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const p = openaiProvider({ id: "x", baseUrl: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, model: "m" });
    expect((await p.pick([tool("a", "x")], "hi")).tool).toBe("a");
    expect(hits).toBe(2);
  }, 20_000);
});

describe("budget covers generation and rewrite calls", () => {
  it("charges exactly one call per model pick and one per rewrite request", async () => {
    const tools = [tool("search_issues", "Search issues."), tool("list_issues", "List issues.")];
    const prompts: TestPrompt[] = ["search_issues", "list_issues"].flatMap((n) =>
      (["train", "train", "validate", "test"] as const).map((split, i) => ({ id: `${n}#${i}`, text: `please handle item number ${i} now`, expected: n, kind: "direct" as const, split })));
    let rewrites = 0;
    let picks = 0;
    const rewriter: Provider = { id: "rw", local: true, pick: async () => ({ tool: null }), complete: async () => { rewrites++; return JSON.stringify({ description: "Brand new description that is plenty long enough." }); } };
    const counting: Provider = { ...heuristicProvider(), pick: async (t, p) => { picks++; return heuristicProvider().pick(t, p); } };
    const budget = new Budget(100_000);
    await tune({ tools, prompts, providers: [counting], rewriter, evalOpts: { repeats: 2, concurrency: 1, seed: 1, budget }, maxRewrites: 2, weakThreshold: 1.01 });
    expect(rewrites).toBeGreaterThan(0);
    expect(budget.calls).toBe(picks + rewrites);
  });
});

describe("JSON extraction from model output", () => {
  it("handles fences, prose, braces in strings, nesting", () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nhope that helps')).toEqual({ a: 1 });
    expect(extractJson('text {"d": "has } and { inside", "n": {"x": [1,2]}} trailing {junk')).toEqual({ d: "has } and { inside", n: { x: [1, 2] } });
    expect(extractJson('{"q": "escaped \\" quote }"}')).toEqual({ q: 'escaped " quote }' });
    expect(() => extractJson("no json here")).toThrow();
    expect(() => extractJson('{"unterminated": ')).toThrow();
  });
});

describe("prompt generation and loading", () => {
  const tools = [tool("search_issues", "Search issues."), tool("list_issues", "List issues.")];

  it("survives a generator that returns garbage, and filters tool-name leaks and duplicates", async () => {
    let n = 0;
    const gen: Provider = {
      id: "g", local: true, pick: async () => ({ tool: null }),
      complete: async () => (++n <= 2 ? "I am sorry, I cannot do that." : JSON.stringify({ direct: ["use search_issues to find it", "find bugs about login please", "find bugs about login please", 42, "x"], near_miss: ["bugs mentioning timeouts, not a full list"] })),
    };
    const out = await generatePrompts(gen, tools, { perTool: 5, nearMiss: 2, seed: 1 });
    const texts = out.map((p) => p.text);
    expect(texts.some((t) => t.includes("search_issues"))).toBe(false);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).not.toContain("x");
    expect(out.every((p) => p.expected === "list_issues")).toBe(true); // the first tool got garbage on both attempts
  });

  it("loadPrompts validates its input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tr-"));
    const write = async (name: string, v: unknown) => { const f = join(dir, name); await writeFile(f, JSON.stringify(v)); return f; };
    await expect(loadPrompts(await write("a.json", { prompts: [{ text: "hello there", expected: "nope" }] }), tools)).rejects.toThrow(/unknown tool/);
    await expect(loadPrompts(await write("b.json", { prompts: [{ expected: "search_issues" }] }), tools)).rejects.toThrow(/text/);
    await expect(loadPrompts(await write("c.json", { nope: 1 }), tools)).rejects.toThrow(/prompts/);
    const ok = await loadPrompts(await write("d.json", [{ text: "find login bugs", expected: "search_issues" }]), tools);
    expect(ok[0]!.split).toBeDefined();
    const kept = await loadPrompts(await write("e.json", { prompts: [{ text: "t", expected: "search_issues", split: "test" }] }), tools);
    expect(kept[0]!.split).toBe("test");
  });
});

describe("lint on odd input", () => {
  it("handles zero tools, one tool, missing schemas, non-object properties, unicode", async () => {
    expect((await lint([])).findings).toEqual([]);
    expect(() => lint([tool("only", "The only tool, which does exactly one thing for you.")])).not.toThrow();
    const weird = [
      { name: "日本語ツール", description: "データを検索します。キーワードで検索。", inputSchema: {} },
      { name: "t2", description: "x", inputSchema: { properties: ["not", "an", "object"] } as any },
      { name: "t3", description: "x", inputSchema: undefined as any },
    ] as ToolInfo[];
    await expect(lint(weird)).resolves.toBeDefined();
  });

  it("loads a snapshot with null / missing fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tr-"));
    const f = join(dir, "t.json");
    await writeFile(f, JSON.stringify({ tools: [{ name: "a", description: null }, { name: "b" }] }));
    const t = await loadTools({ toolsFile: f });
    expect(t.map((x) => x.description)).toEqual(["", ""]);
  });
});

describe("streamable HTTP transport", () => {
  it("lists tools from a remote MCP server (and passes custom headers)", async () => {
    let sawAuth: string | undefined;
    const http = createServer(async (req, res) => {
      sawAuth = req.headers.authorization;
      const mcp = new McpServer({ name: "remote", version: "1.0.0" });
      mcp.registerTool("remote_tool", { description: "A tool served over HTTP for the smoke test.", inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { void transport.close(); void mcp.close(); });
      await mcp.connect(transport);
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => void transport.handleRequest(req, res, body ? JSON.parse(body) : undefined));
    });
    servers.push(http);
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
    const t = await loadTools({ url, headers: { Authorization: "Bearer test-token" } });
    expect(t.map((x) => x.name)).toEqual(["remote_tool"]);
    expect(sawAuth).toBe("Bearer test-token");
  }, 30_000);
});

describe("CLI robustness", { timeout: 60_000 }, () => {
  const cli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000 });
  const base = ["eval", "--tools", "fixtures/confusing-tools.json", "-m", "heuristic", "--prompts", "fixtures/prompts.json"];

  it("rejects nonsense numeric options with a clear message", () => {
    for (const bad of [["--repeats", "0"], ["--repeats", "abc"], ["--repeats", "-2"], ["--concurrency", "0"], ["--max-calls", "x"]]) {
      const r = cli([...base, ...bad]);
      expect(r.status, bad.join(" ")).not.toBe(0);
      expect(r.stderr).toMatch(/must be|positive|integer|number/i);
    }
  });

  it("needs at least 2 tools to evaluate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tr-"));
    const f = join(dir, "one.json");
    await writeFile(f, JSON.stringify([{ name: "a", description: "only one tool here" }]));
    const r = cli(["eval", "--tools", f, "-m", "heuristic", "--prompts", "fixtures/prompts.json"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/at least 2 tools/i);
  });

  it("explains an unreachable provider quickly and exits non-zero", async () => {
    const t0 = Date.now();
    const port = await closedPort();
    const r = cli([...base.slice(0, 4), "custom:m", ...base.slice(5), "--yes"], { TOOLRIGHT_BASE_URL: `http://127.0.0.1:${port}/v1` });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/custom:m|connect|reach/i);
    expect(Date.now() - t0).toBeLessThan(30_000);
  });

  it("eval with the offline heuristic runs end to end and writes reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tr-out-"));
    const r = cli([...base, "-o", dir, "--repeats", "1"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not a real model");
    const { readFile } = await import("node:fs/promises");
    expect(JSON.parse(await readFile(join(dir, "eval.json"), "utf8")).results[0].model).toBe("heuristic");
  });

  it("list works against a real stdio server", () => {
    const r = cli(["list", "--", process.execPath, "--import", "tsx", "fixtures/confusing-server.ts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("5 tools");
  });
});
