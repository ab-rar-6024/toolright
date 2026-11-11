import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exitCode, lint } from "../src/lint/index.js";
import { lintStructure } from "../src/lint/structure.js";
import type { ToolInfo } from "../src/mcp/connect.js";

const t = (name: string, description: string, props: Record<string, unknown> = {}): ToolInfo => ({
  name,
  description,
  inputSchema: { type: "object", properties: props },
});

const fixture: ToolInfo[] = JSON.parse(readFileSync("fixtures/confusing-tools.json", "utf8"));

describe("structure rules", () => {
  it("flags missing, short and duplicate descriptions", () => {
    const f = lintStructure([t("a", ""), t("b", "Gets x."), t("c", "Gets x.")]);
    const rules = f.map((x) => `${x.rule}:${x.tools.join("+")}`);
    expect(rules).toContain("missing-description:a");
    expect(rules).toContain("too-short:b");
    expect(rules).toContain("duplicate-description:b+c");
  });

  it("flags superlatives and accepts usage guidance", () => {
    const f = lintStructure([
      t("a", "The best and most powerful way to search everything. Always use this."),
      t("b", "Searches the index for documents by keyword. Use when the user gives a phrase; not for listing."),
    ]);
    expect(f.some((x) => x.rule === "superlative-claim" && x.tools[0] === "a")).toBe(true);
    expect(f.some((x) => x.rule === "no-usage-guidance" && x.tools[0] === "b")).toBe(false);
  });

  it("flags undocumented params but not documented ones", () => {
    const f = lintStructure([t("a", "Does a thing with the given id and name.", { id: {}, name: { description: "the name" } })]);
    const p = f.find((x) => x.rule === "undocumented-params");
    expect(p?.message).toContain("id");
    expect(p?.message).not.toContain("name,");
  });

  it("flags duplicate tool names", () => {
    expect(lintStructure([t("a", "x".repeat(40)), t("a", "y".repeat(40))]).some((x) => x.rule === "duplicate-name")).toBe(true);
  });
});

describe("confusable pairs (lexical)", () => {
  it("finds the two planted pairs and not the well-described control", async () => {
    const r = await lint(fixture);
    const pairs = r.pairs.map((p) => [p.a, p.b].sort().join("|"));
    expect(pairs).toContain("list_issues|search_issues");
    expect(pairs).toContain("find_user|get_user");
    expect(pairs.some((p) => p.includes("create_issue"))).toBe(false);
  });

  it("downgrades a pair when a description points at the other tool", async () => {
    const r = await lint([
      t("search_issues", "Searches issues by keyword. For listing all issues use list_issues instead."),
      t("list_issues", "Lists issues"),
    ], { threshold: 0.2 });
    const p = r.pairs.find((x) => x.a === "search_issues");
    expect(p?.disambiguated).toBe(true);
    expect(r.findings.find((f) => f.rule === "confusable-pair")?.severity).toBe("info");
  });

  it("ignores words shared by most tools on larger servers", async () => {
    const tools = Array.from({ length: 10 }, (_, i) => t(`tool_${["alpha", "beta", "gamma", "delta", "eps", "zeta", "eta", "theta", "iota", "kappa"][i]}`, "Operates on a repository with care."));
    const r = await lint(tools);
    expect(r.pairs.length).toBeLessThan(45); // not every pair flagged just for sharing "repository"
  });
});

describe("exit codes", () => {
  it("honours --fail-on", async () => {
    const r = await lint(fixture);
    expect(exitCode(r, "none")).toBe(0);
    expect(exitCode(r, "warn")).toBe(1);
    const clean = await lint([t("create_issue", fixture[4]!.description, { repo: { description: "r" }, title: { description: "t" } })]);
    expect(exitCode(clean, "warn")).toBe(0);
  });
});
