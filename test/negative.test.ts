import { describe, expect, it } from "vitest";
import { evaluate } from "../src/eval/run.js";
import type { Provider } from "../src/providers/types.js";
import { loadTools } from "../src/mcp/connect.js";
import { loadPrompts } from "../src/gen/prompts.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("negative control evaluation (no-tool requests)", () => {
  it("evaluates expected: none correctly when model picks null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "neg-test-"));
    try {
      const toolFile = join(dir, "tools.json");
      const promptFile = join(dir, "prompts.json");

      await writeFile(toolFile, JSON.stringify([{ name: "search", description: "Search the web." }]), "utf8");
      await writeFile(
        promptFile,
        JSON.stringify({
          prompts: [
            { id: "1", text: "What is 2 + 2?", expected: "none", kind: "direct", split: "test" },
            { id: "2", text: "Search for apple stock", expected: "search", kind: "direct", split: "test" },
          ],
        }),
        "utf8",
      );

      const tools = await loadTools({ toolsFile: toolFile });
      const prompts = await loadPrompts(promptFile, tools);

      const mockProvider: Provider = {
        id: "mock",
        local: true,
        pick: async (_tools, query) => {
          if (query.includes("2 + 2")) return { tool: null }; // no tool needed
          return { tool: "search" };
        },
      };

      const result = await evaluate(mockProvider, tools, prompts, { repeats: 1, concurrency: 1, seed: 1 });
      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.correct).toBe(true);
      expect(result.items[0]?.picked).toBeNull();
      expect(result.items[1]?.correct).toBe(true);
      expect(result.items[1]?.picked).toBe("search");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
