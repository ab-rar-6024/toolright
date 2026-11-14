import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { promptCoverage, loadPrompts } from "../src/gen/prompts.js";
import { lint } from "../src/lint/index.js";
import { loadTools } from "../src/mcp/connect.js";

describe("company fixture (synthetic, ambiguous tool pairs)", () => {
  it("exposes the eight terse tools in four confusable pairs", async () => {
    const tools = await loadTools({ toolsFile: "fixtures/company-tools.json" });
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["close_item", "deactivate_member", "find_customer", "lookup_customer", "remove_member", "resolve_item", "send_alert", "send_notice"],
    );
    for (const t of tools) expect(t.description.length).toBeLessThan(25); // deliberately terse
  });

  it("lint finds all four planted pairs", async () => {
    const tools = await loadTools({ toolsFile: "fixtures/company-tools.json" });
    const pairs = (await lint(tools)).pairs.map((p) => [p.a, p.b].sort().join("|"));
    for (const expected of [
      "close_item|resolve_item",
      "deactivate_member|remove_member",
      "find_customer|lookup_customer",
      "send_alert|send_notice",
    ]) expect(pairs).toContain(expected);
  });

  it("the prompt file is balanced, valid and splits cleanly", async () => {
    const tools = await loadTools({ toolsFile: "fixtures/company-tools.json" });
    const prompts = await loadPrompts("fixtures/company-prompts.json", tools, 1);
    expect(prompts).toHaveLength(64);
    for (const c of promptCoverage(prompts, tools)) {
      expect(c.total).toBe(8);
      expect(c.train).toBeGreaterThan(0);
      expect(c.validate).toBeGreaterThan(0);
      expect(c.test).toBeGreaterThan(0);
    }
    expect(new Set(prompts.map((p) => p.text)).size).toBe(64); // no duplicates
  });

  it("handles files with leading UTF-8 BOM smoothly", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "bom-test-"));
    try {
      const toolFile = join(dir, "tools.json");
      const promptFile = join(dir, "prompts.json");
      // Prepend UTF-8 BOM (\uFEFF)
      await writeFile(toolFile, "\uFEFF" + JSON.stringify([{ name: "t1", description: "test tool 1" }]), "utf8");
      await writeFile(promptFile, "\uFEFF" + JSON.stringify({ prompts: [{ id: "1", text: "hi", expected: "t1" }] }), "utf8");

      const loaded = await loadTools({ toolsFile: toolFile });
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.name).toBe("t1");

      const prompts = await loadPrompts(promptFile, loaded);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]!.expected).toBe("t1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("no prompt names a tool (that would hand the model the answer)", () => {
    const names = (JSON.parse(readFileSync("fixtures/company-tools.json", "utf8")) as Array<{ name: string }>).map((t) => t.name);
    const prompts = (JSON.parse(readFileSync("fixtures/company-prompts.json", "utf8")) as { prompts: Array<{ text: string }> }).prompts;
    for (const p of prompts) for (const n of names) expect(p.text.toLowerCase()).not.toContain(n);
  });
});
