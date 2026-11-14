import { describe, expect, it } from "vitest";
import { formatLintMarkdown, lint } from "../src/lint/index.js";
import { loadTools } from "../src/mcp/connect.js";

describe("formatLintMarkdown", () => {
  it("formats lint findings as clean GitHub flavored Markdown", async () => {
    const tools = await loadTools({ toolsFile: "fixtures/company-tools.json" });
    const result = await lint(tools);
    const md = formatLintMarkdown(result);

    expect(md).toContain("## 🔍 Toolright Lint Report");
    expect(md).toContain("Checked **8 tools**");
    expect(md).toContain("### ⚠️ Confusable Tool Pairs");
    expect(md).toContain("close_item");
    expect(md).toContain("resolve_item");
  });

  it("handles clean tool sets with a success banner", () => {
    const md = formatLintMarkdown({
      tools: 2,
      method: "lexical",
      threshold: 0.5,
      findings: [],
      pairs: [],
    });
    expect(md).toContain("✅ **All tool descriptions look distinct and well-structured!**");
  });
});
