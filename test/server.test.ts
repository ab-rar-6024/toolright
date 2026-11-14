import { describe, expect, it } from "vitest";
import { lint } from "../src/lint/index.js";
import { normalizeTool } from "../src/mcp/connect.js";

describe("Toolright MCP Server handler logic", () => {
  it("lint_tools logic catches confusable pairs directly from raw tool schemas", async () => {
    const rawTools = [
      { name: "find_customer", description: "Finds a customer." },
      { name: "lookup_customer", description: "Looks up a customer." },
    ];

    const normalized = rawTools.map((t) => normalizeTool(t));
    const result = await lint(normalized);
    expect(result.tools).toBe(2);
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.pairs[0]?.a).toBe("find_customer");
    expect(result.pairs[0]?.b).toBe("lookup_customer");
  });
});
