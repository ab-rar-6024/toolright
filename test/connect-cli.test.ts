import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { loadTools } from "../src/mcp/connect.js";

describe("MCP connection", () => {
  it("lists tools from a real stdio MCP server", async () => {
    const tools = await loadTools({ command: [process.execPath, "--import", "tsx", "fixtures/confusing-server.ts"] });
    expect(tools.map((t) => t.name).sort()).toEqual(["create_issue", "find_user", "get_user", "list_issues", "search_issues"]);
    expect(tools.find((t) => t.name === "create_issue")!.description).toContain("Use when");
  }, 60_000);

  it("loads a snapshot file", async () => {
    const tools = await loadTools({ toolsFile: "fixtures/confusing-tools.json" });
    expect(tools).toHaveLength(5);
  });

  it("throws a helpful error with no source", async () => {
    await expect(loadTools({})).rejects.toThrow(/server command/);
  });
});

describe("cli", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });

  it("lint exits 1 with --fail-on warn and 0 with --fail-on none", () => {
    expect(run(["lint", "--tools", "fixtures/confusing-tools.json", "--fail-on", "warn"]).status).toBe(1);
    expect(run(["lint", "--tools", "fixtures/confusing-tools.json", "--fail-on", "none"]).status).toBe(0);
  }, 30_000);

  it("lint --json is valid JSON containing the planted pair", () => {
    const out = execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", "lint", "--tools", "fixtures/confusing-tools.json", "--json", "--fail-on", "none"], { encoding: "utf8" });
    const j = JSON.parse(out);
    expect(j.pairs.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("eval refuses to run cloud models without confirmation when not a TTY", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "eval", "--tools", "fixtures/confusing-tools.json", "-m", "groq:x", "--prompts", "fixtures/prompts.json"], {
      encoding: "utf8", env: { ...process.env, GROQ_API_KEY: "k" }, input: "",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--yes|confirm/i);
  }, 30_000);
});
