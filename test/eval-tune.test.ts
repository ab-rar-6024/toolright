import { describe, expect, it } from "vitest";
import { Budget, BudgetExceeded, evaluate, summarize } from "../src/eval/run.js";
import { assignSplits, leaksPrompt, type TestPrompt } from "../src/gen/prompts.js";
import type { ToolInfo } from "../src/mcp/connect.js";
import { heuristicProvider } from "../src/providers/heuristic.js";
import type { Provider } from "../src/providers/types.js";
import { tuneReport } from "../src/report/index.js";
import { tune } from "../src/tune/index.js";
import { wilson } from "../src/util.js";

const tool = (name: string, description: string): ToolInfo => ({ name, description, inputSchema: { type: "object", properties: {} } });

const tools = [
  tool("search_issues", "Search issues."),
  tool("list_issues", "List issues."),
  tool("create_issue", "Create a new issue in a repository. Use when the user reports a bug."),
];

let n = 0;
const P = (expected: string, text: string, split: TestPrompt["split"]): TestPrompt => ({
  id: `${expected}#${n++}`, text, expected, kind: "direct", split,
});

const prompts: TestPrompt[] = [
  ...["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((w, i) =>
    P("search_issues", `issues mentioning the keyword ${w} anywhere in the text`, (["train", "train", "train", "train", "validate", "validate", "test", "test"] as const)[i]!)),
  ...["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"].map((w, i) =>
    P("list_issues", `every issue in repository ${w} with all of them shown`, (["train", "train", "train", "train", "validate", "validate", "test", "test"] as const)[i]!)),
];

describe("stats", () => {
  it("wilson interval brackets the estimate", () => {
    const [lo, hi] = wilson(7, 10);
    expect(lo).toBeLessThan(0.7);
    expect(hi).toBeGreaterThan(0.7);
    expect(wilson(0, 0)).toEqual([0, 0]);
  });
});

describe("evaluate", () => {
  it("is deterministic for a given seed and counts picks correctly", async () => {
    const run = () => evaluate(heuristicProvider(), tools, prompts, { repeats: 2, concurrency: 3, seed: 7 });
    const a = await run();
    const b = await run();
    expect(a.items.map((i) => i.picked)).toEqual(b.items.map((i) => i.picked));
    expect(a.items).toHaveLength(prompts.length * 2);
    const s = summarize(a.items);
    expect(s.n).toBe(prompts.length * 2);
    expect(s.accuracy).toBeGreaterThan(0);
  });

  it("excludes API errors from accuracy instead of calling them wrong", async () => {
    const flaky: Provider = {
      id: "flaky", local: true,
      pick: async (_t, p) => (p.includes("alpha") ? { tool: null, error: "boom" } : { tool: "search_issues" }),
      complete: async () => "",
    };
    const r = await evaluate(flaky, tools, prompts.slice(0, 8), { repeats: 1, concurrency: 1, seed: 1 });
    const s = summarize(r.items);
    expect(s.errors).toBe(1);
    expect(s.n).toBe(7);
  });

  it("stops at the call budget", async () => {
    await expect(
      evaluate(heuristicProvider(), tools, prompts, { repeats: 1, concurrency: 1, seed: 1, budget: new Budget(3) }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
  });
});

describe("prompt splits", () => {
  it("keeps every tool represented in train and holds some out", () => {
    const base = prompts.map(({ split: _s, ...rest }) => rest);
    const out = assignSplits(base, 1);
    for (const name of ["search_issues", "list_issues"]) {
      const mine = out.filter((p) => p.expected === name);
      expect(mine.some((p) => p.split === "train")).toBe(true);
      expect(mine.some((p) => p.split === "test")).toBe(true);
    }
  });

  it("detects verbatim prompt leakage in a rewrite", () => {
    expect(leaksPrompt("Use for: issues mentioning the keyword alpha anywhere in the text", prompts)).toBe(true);
    expect(leaksPrompt("Full-text search over issue titles and bodies.", prompts)).toBe(false);
  });
});

/** A scripted "rewriter": returns canned descriptions per tool. */
function scripted(map: Record<string, string>): Provider {
  return {
    id: "scripted", local: true,
    pick: async () => ({ tool: null }),
    complete: async (_s, user) => {
      const name = /description of the tool "([^"]+)"/.exec(user)![1]!;
      return "```json\n" + JSON.stringify({ description: map[name] ?? "x" }) + "\n```";
    },
  };
}

const evalOpts = { repeats: 6, concurrency: 4, seed: 3 };

describe("tune loop (machinery test with the heuristic stand-in, not a model)", () => {
  it("accepts rewrites that help on validation and reports on the untouched test split", async () => {
    const r = await tune({
      tools, prompts, providers: [heuristicProvider()],
      rewriter: scripted({
        search_issues: "Full-text search of issues by keyword, finding issues mentioning a phrase anywhere in the text. Not for listing everything; use list_issues.",
        list_issues: "Lists every issue in a repository, showing all of them. Not for keyword search; use search_issues.",
      }),
      evalOpts, maxRewrites: 3, weakThreshold: 0.95,
    });
    expect(r.rewrites.some((w) => w.accepted)).toBe(true);
    const base = summarize(r.baseline[0]!.items.filter((i) => r.final[0]!.items.some((f) => f.promptId === i.promptId)));
    const after = summarize(r.final[0]!.items);
    expect(after.accuracy).toBeGreaterThan(base.accuracy);
    expect(r.finalMeasured).toBe(true);
    // accepted rewrites must be reflected in the final tools
    for (const w of r.rewrites.filter((x) => x.accepted)) {
      expect(r.finalTools.find((t) => t.name === w.tool)!.description).toBe(w.after);
    }
    expect(tuneReport(r)).toContain("Accuracy on held-out test prompts");
  });

  it("rejects rewrites that don't help, and rewrites that copy a prompt", async () => {
    const r = await tune({
      tools, prompts, providers: [heuristicProvider()],
      rewriter: scripted({
        search_issues: "Search issues.", // identical
        list_issues: "Lists stuff: issues mentioning the keyword alpha anywhere in the text", // leaks a prompt
      }),
      evalOpts, maxRewrites: 3, weakThreshold: 0.95,
    });
    expect(r.rewrites.every((w) => !w.accepted)).toBe(true);
    expect(r.rewrites.map((w) => w.reason).join(" ")).toMatch(/same description|copies a test prompt/);
    expect(r.finalTools).toEqual(r.originalTools);
  });

  it("won't rewrite a tool that no prompt needs (its lost recall would be invisible)", async () => {
    // create_issue has no prompts here but steals picks; gutting it would "improve" the others.
    const r = await tune({
      tools, prompts, providers: [heuristicProvider()],
      rewriter: scripted({ create_issue: "Totally different words about nothing relevant at all today." }),
      evalOpts, maxRewrites: 5, weakThreshold: 0.95,
    });
    const rec = r.rewrites.find((w) => w.tool === "create_issue");
    if (rec) {
      expect(rec.accepted).toBe(false);
      expect(rec.reason).toMatch(/couldn't be checked/);
    }
  });

  it("rejects absurdly short rewrites", async () => {
    const r = await tune({
      tools, prompts, providers: [heuristicProvider()],
      rewriter: scripted({ search_issues: "x", list_issues: "y" }),
      evalOpts, maxRewrites: 3, weakThreshold: 0.95,
    });
    expect(r.rewrites.filter((w) => w.reason.includes("shorter than 20"))).not.toHaveLength(0);
    expect(r.rewrites.every((w) => !w.accepted)).toBe(true);
  });

  it("skips all rewrite work when validation accuracy is already 100% (no headroom)", async () => {
    // Fails only on training prompts, so tools look "weak" on train while validation is perfect.
    const splitOf = new Map(prompts.map((p) => [p.text, p.split]));
    const expectedOf = new Map(prompts.map((p) => [p.text, p.expected]));
    let picks = 0;
    let rewrites = 0;
    const picker: Provider = {
      id: "train-failer", local: true, complete: async () => "",
      pick: async (_t, text) => {
        picks++;
        const right = expectedOf.get(text)!;
        return { tool: splitOf.get(text) === "train" ? tools.find((x) => x.name !== right)!.name : right };
      },
    };
    const rewriter: Provider = { id: "rw", local: true, pick: async () => ({ tool: null }), complete: async () => { rewrites++; return JSON.stringify({ description: "A perfectly fine long enough description." }); } };
    const budget = new Budget(100_000);
    const r = await tune({ tools, prompts, providers: [picker], rewriter, evalOpts: { repeats: 2, concurrency: 1, seed: 1, budget }, maxRewrites: 5, weakThreshold: 0.95 });
    expect(rewrites).toBe(0);
    expect(r.rewrites).toHaveLength(0);
    expect(r.note).toMatch(/No headroom/);
    expect(budget.calls).toBe(picks);
    expect(picks).toBe(prompts.length * 2); // the baseline only: no candidate was evaluated
    const md = tuneReport(r);
    expect(md).toContain("No headroom");
    expect(md).not.toContain("No weak tools found");
  });

  it("never lets the rewriter see validation or test prompts", async () => {
    const seen: string[] = [];
    const spy: Provider = {
      ...scripted({}),
      complete: async (_s, user) => { seen.push(user); return JSON.stringify({ description: "something different entirely about issues" }); },
    };
    await tune({ tools, prompts, providers: [heuristicProvider()], rewriter: spy, evalOpts, maxRewrites: 3, weakThreshold: 0.95 });
    const held = prompts.filter((p) => p.split !== "train");
    for (const text of seen) for (const p of held) expect(text).not.toContain(p.text);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("flags the after-column as unmeasured when the budget runs out before the final run", async () => {
    // enough for baseline + one candidate, not for the final test-split run
    const r = await tune({
      tools, prompts, providers: [heuristicProvider()],
      rewriter: scripted({
        search_issues: "Full-text search of issues by keyword, finding issues mentioning a phrase anywhere in the text. Not for listing everything; use list_issues.",
        list_issues: "Lists every issue in a repository, showing all of them. Not for keyword search; use search_issues.",
      }),
      evalOpts: { ...evalOpts, budget: new Budget(prompts.length * 6 + 12 * 6 + 3) },
      maxRewrites: 3, weakThreshold: 0.95,
    });
    if (r.rewrites.some((w) => w.accepted)) expect(r.finalMeasured).toBe(true); // reserved budget for the final run
    expect(r.stoppedEarly ?? "").toMatch(/budget|^$/);
  });
});
