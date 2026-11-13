import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { generatePrompts, promptCoverage, tidy, type TestPrompt } from "../src/gen/prompts.js";
import type { ToolInfo } from "../src/mcp/connect.js";
import { openaiProvider } from "../src/providers/openai.js";
import type { Provider } from "../src/providers/types.js";

const tool = (name: string, description: string): ToolInfo => ({ name, description, inputSchema: { type: "object", properties: {} } });
const ELLIPSIS = String.fromCharCode(0x2026);

describe("tidy: clean up what small models wrap around a request", () => {
  it("removes stray leading/trailing ellipses and wrapping quotes", () => {
    expect(tidy("...can you look up the user with id 45678...")).toBe("can you look up the user with id 45678");
    expect(tidy(`${ELLIPSIS}find the user with id 67890${ELLIPSIS}`)).toBe("find the user with id 67890");
    expect(tidy('"show me all open issues in myorg/api"')).toBe("show me all open issues in myorg/api");
    expect(tidy("'list every issue in the repo'")).toBe("list every issue in the repo");
    expect(tidy(`${String.fromCharCode(0x201c)}find the person named Ana${String.fromCharCode(0x201d)}`)).toBe("find the person named Ana");
  });

  it("keeps quotes that are part of the request", () => {
    expect(tidy("find 'user123'")).toBe("find 'user123'");
    expect(tidy("get the user named 'john_doe' please")).toBe("get the user named 'john_doe' please");
    expect(tidy("Find issues mentioning \"null pointer\"")).toBe("Find issues mentioning \"null pointer\"");
  });

  it("leaves a normal sentence alone", () => {
    expect(tidy("  What issues were created in the last week?  ")).toBe("What issues were created in the last week?");
  });
});

describe("generation never fails silently", () => {
  const tools = [tool("search_issues", "Search issues."), tool("list_issues", "List issues."), tool("create_issue", "Create an issue.")];

  function gen(responses: Record<string, string>): Provider {
    return {
      id: "g", local: true, pick: async () => ({ tool: null }),
      complete: async (_s, user) => {
        const name = /Target tool: (\S+)/.exec(user)![1]!;
        return responses[name] ?? "not json at all";
      },
    };
  }

  it("warns for a tool whose generation failed, and for a tool that kept too few prompts", async () => {
    const warnings: string[] = [];
    const out = await generatePrompts(
      gen({
        search_issues: JSON.stringify({ direct: ["find bugs about login timeouts", "find bugs about login timeouts", "use search_issues here"], near_miss: [] }),
        // list_issues: garbage twice -> no prompts
        create_issue: JSON.stringify({ direct: ["open a ticket for the broken export button", "file a request for dark mode support"], near_miss: ["report that checkout is down"] }),
      }),
      tools,
      { perTool: 3, nearMiss: 1, seed: 1, onWarn: (m) => warnings.push(m) },
    );
    expect(warnings.some((w) => w.startsWith("list_issues") && /valid JSON/.test(w))).toBe(true);
    const search = warnings.find((w) => w.startsWith("search_issues"));
    expect(search).toMatch(/kept 1 of 4/);
    expect(search).toMatch(/duplicate/);
    expect(search).toMatch(/named a tool/);
    expect(out.filter((p) => p.expected === "list_issues")).toHaveLength(0);
  });

  it("cleans the prompts it keeps", async () => {
    const out = await generatePrompts(
      gen({ search_issues: JSON.stringify({ direct: ["...find bugs about login timeouts..."], near_miss: [] }) }),
      tools,
      { perTool: 1, nearMiss: 0, seed: 1 },
    );
    expect(out.find((p) => p.expected === "search_issues")!.text).toBe("find bugs about login timeouts");
  });
});

describe("promptCoverage", () => {
  it("lists every tool, including ones with no prompts", () => {
    const tools = [tool("a", "x"), tool("b", "y")];
    const prompts: TestPrompt[] = [
      { id: "1", text: "t1", expected: "a", kind: "direct", split: "train" },
      { id: "2", text: "t2", expected: "a", kind: "direct", split: "test" },
    ];
    expect(promptCoverage(prompts, tools)).toEqual([
      { tool: "a", total: 2, train: 1, validate: 0, test: 1 },
      { tool: "b", total: 0, train: 0, validate: 0, test: 0 },
    ]);
  });
});

describe("JSON mode", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function fake(handler: (body: any, n: number) => { status?: number; json: unknown }) {
    const bodies: any[] = [];
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const body = JSON.parse(data || "{}");
        bodies.push(body);
        const out = handler(body, bodies.length);
        res.writeHead(out.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(out.json));
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`, bodies };
  }

  it("asks for a JSON object when json:true, and not otherwise", async () => {
    const f = await fake(() => ({ json: { choices: [{ message: { content: "{}" } }] } }));
    const p = openaiProvider({ id: "x", baseUrl: f.url, model: "m" });
    await p.complete("s", "u", { json: true });
    await p.complete("s", "u");
    expect(f.bodies[0].response_format).toEqual({ type: "json_object" });
    expect("response_format" in f.bodies[1]).toBe(false);
  });

  it("falls back to a plain request when the server rejects JSON mode", async () => {
    const f = await fake((body) =>
      body.response_format
        ? { status: 400, json: { error: { message: "response_format is not supported by this model" } } }
        : { json: { choices: [{ message: { content: '{"ok":true}' } }] } },
    );
    const text = await openaiProvider({ id: "x", baseUrl: f.url, model: "m" }).complete("s", "u", { json: true });
    expect(text).toBe('{"ok":true}');
    expect(f.bodies).toHaveLength(2);
    expect("response_format" in f.bodies[1]).toBe(false);
  });
});

describe("CLI refuses to evaluate on a broken generated prompt set", () => {
  it("aborts before any evaluation when generation leaves a tool uncovered", async () => {
    const { spawn } = await import("node:child_process");
    let evalPicks = 0;
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const body = JSON.parse(data || "{}");
        res.writeHead(200, { "content-type": "application/json" });
        if (body.tools) {
          evalPicks++;
          return void res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: body.tools[0].function.name } }] } }] }));
        }
        // generation: valid JSON for every tool except list_issues
        const target = /Target tool: (\S+)/.exec(body.messages.at(-1).content)?.[1];
        const content = target === "list_issues" ? "sorry, no" : JSON.stringify({ direct: ["please do thing number one for me", "please do thing number two for me", "please do thing number three"], near_miss: [] });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "eval", "--tools", "fixtures/confusing-tools.json", "-m", "custom:m", "--yes"],
        { env: { ...process.env, TOOLRIGHT_BASE_URL: `http://127.0.0.1:${port}/v1` } },
      );
      let stderr = "";
      child.stderr.on("data", (c) => (stderr += c));
      const code: number = await new Promise((r) => child.on("close", (c) => r(c ?? 1)));
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/fewer than 3 prompts/);
      expect(stderr).toMatch(/list_issues \(0\)/);
      expect(stderr).toMatch(/warning: list_issues: the model did not return valid JSON/);
      expect(evalPicks).toBe(1); // only the one-call preflight; no evaluation happened
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60_000);
});

describe("the generation prompt and placeholder handling (found live: a 3B model echoed '...')", () => {
  it("the instructions contain no literal placeholder a small model could copy", async () => {
    let seen = "";
    const spy: Provider = {
      id: "g", local: true, pick: async () => ({ tool: null }),
      complete: async (_s, user) => { seen = user; return JSON.stringify({ direct: [], near_miss: [] }); },
    };
    await generatePrompts(spy, [tool("search_issues", "Search issues."), tool("list_issues", "List issues.")], { perTool: 6, nearMiss: 4, seed: 1 });
    expect(seen).not.toContain('"..."');
    expect(seen).toContain('"direct" (an array of 6');
    expect(seen).toContain('"near_miss" (an array of 4');
  });

  it("recognises placeholders but not real requests", async () => {
    const { isPlaceholder } = await import("../src/gen/prompts.js");
    for (const p of ["...", "..", "<request 1>", "[your request here]", "{prompt}", "example request", "Request 2", "-"]) expect(isPlaceholder(p), p).toBe(true);
    for (const p of ["find issues about login timeouts", "List the issues in 'my-project'", "get user 42"]) expect(isPlaceholder(p), p).toBe(false);
  });

  it("reports echoed placeholders accurately instead of blaming the model for writing too little", async () => {
    const warnings: string[] = [];
    const echo: Provider = {
      id: "g", local: true, pick: async () => ({ tool: null }),
      complete: async () => JSON.stringify({ direct: ["...", "...", "..."], near_miss: ["..."] }),
    };
    const out = await generatePrompts(echo, [tool("search_issues", "Search issues."), tool("list_issues", "List issues.")], { perTool: 3, nearMiss: 1, seed: 1, onWarn: (m) => warnings.push(m) });
    expect(out).toHaveLength(0);
    expect(warnings.some((w) => /4 empty or placeholder/.test(w))).toBe(true);
    expect(warnings.join(" ")).not.toMatch(/wrote fewer than asked/);
  });
});
