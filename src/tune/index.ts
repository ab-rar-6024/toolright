import { leaksPrompt, type TestPrompt } from "../gen/prompts.js";
import type { ToolInfo } from "../mcp/connect.js";
import {
  BudgetExceeded,
  evaluate,
  filterItems,
  perTool,
  summarize,
  type EvalOptions,
  type EvalResult,
} from "../eval/run.js";
import type { Provider } from "../providers/types.js";
import { dict } from "../util.js";
import { proposeRewrite, type FailureExample } from "./rewrite.js";

export interface TuneOptions {
  tools: ToolInfo[];
  prompts: TestPrompt[];
  providers: Provider[];
  rewriter: Provider;
  evalOpts: EvalOptions;
  maxRewrites: number;
  /** a tool counts as weak when its mean train accuracy is below this, or it wrongly "steals" picks */
  weakThreshold: number;
  log?: (msg: string) => void;
}

export interface RewriteRecord {
  tool: string;
  before: string;
  after: string;
  accepted: boolean;
  reason: string;
  trainBefore: number;
  trainAfter: number | null;
  validateBefore: number;
  validateAfter: number | null;
}

export interface TuneResult {
  models: string[];
  counts: Record<"train" | "validate" | "test", number>;
  repeats: number;
  baseline: EvalResult[];
  /** results on the untouched test split with the final descriptions */
  final: EvalResult[];
  rewrites: RewriteRecord[];
  originalTools: ToolInfo[];
  finalTools: ToolInfo[];
  /** false if the budget ran out before the test split could be re-run with the new descriptions */
  finalMeasured: boolean;
  stoppedEarly?: string;
}

const ids = (ps: TestPrompt[]) => new Set(ps.map((p) => p.id));

/** Mean over models of overall accuracy on a prompt subset. */
export function meanAccuracy(results: EvalResult[], subset: Set<string>): number {
  if (!results.length) return 0;
  return results.reduce((s, r) => s + summarize(filterItems(r, subset)).accuracy, 0) / results.length;
}

/** Per-tool accuracy pooled over all models (items pooled, not averaged, so n is honest). */
export function toolAccuracy(results: EvalResult[], subset: Set<string>): Record<string, number> {
  const pooled = results.flatMap((r) => filterItems(r, subset));
  return dict(Object.entries(perTool(pooled)).map(([k, v]) => [k, v.accuracy] as const));
}

function failuresFor(tool: string, results: EvalResult[], prompts: Map<string, TestPrompt>, subset: Set<string>): FailureExample[] {
  const seen = new Set<string>();
  const out: FailureExample[] = [];
  for (const r of results) {
    for (const i of filterItems(r, subset)) {
      if (i.correct || i.error) continue;
      if (i.expected !== tool && i.picked !== tool) continue;
      if (seen.has(i.promptId)) continue;
      seen.add(i.promptId);
      out.push({ prompt: prompts.get(i.promptId)!.text, expected: i.expected, picked: i.picked });
    }
  }
  return out.slice(0, 8);
}

function weakTools(results: EvalResult[], subset: Set<string>, threshold: number, tools: ToolInfo[]): string[] {
  const acc = toolAccuracy(results, subset);
  const score = new Map<string, number>();
  for (const r of results) {
    for (const i of filterItems(r, subset)) {
      if (i.correct || i.error) continue;
      score.set(i.expected, (score.get(i.expected) ?? 0) + 1);
      if (i.picked) score.set(i.picked, (score.get(i.picked) ?? 0) + 1);
    }
  }
  const known = new Set(tools.map((t) => t.name));
  return [...score]
    .filter(([name]) => known.has(name) && ((acc[name] ?? 1) < threshold || (score.get(name) ?? 0) > 0))
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

/**
 * Baseline -> propose rewrites on weak tools -> gate each on a validation split -> report on a test split.
 *
 *  - train:    the rewriter sees failures from these prompts.
 *  - validate: gates each candidate (must improve here, must not regress any tool here).
 *  - test:     never used for any decision; only the final before/after numbers come from it.
 */
export async function tune(o: TuneOptions): Promise<TuneResult> {
  const log = o.log ?? (() => {});
  const log0 = o.log ?? (() => {});
  const train = o.prompts.filter((p) => p.split === "train");
  const validate = o.prompts.filter((p) => p.split === "validate");
  const test = o.prompts.filter((p) => p.split === "test");
  if (train.length === 0) throw new Error("No training prompts. Generate more prompts per tool (--per-tool).");
  if (validate.length === 0) log0("warning: no validation prompts; candidates will be gated on training accuracy only, which overfits easily. Use more prompts per tool.");
  if (test.length === 0) log0("warning: no test prompts; the before/after numbers will be empty.");

  const trainIds = ids(train);
  const valIds = ids(validate);
  const testIds = ids(test);
  const tvIds = new Set([...trainIds, ...valIds]);
  const promptById = new Map(o.prompts.map((p) => [p.id, p]));
  const allPromptTexts = o.prompts;

  const evalAll = async (tools: ToolInfo[], prompts: TestPrompt[], label: string): Promise<EvalResult[]> => {
    const out: EvalResult[] = [];
    for (const p of o.providers) {
      log(`${label}: ${p.id} (${prompts.length} prompts x ${o.evalOpts.repeats})`);
      out.push(await evaluate(p, tools, prompts, o.evalOpts));
    }
    return out;
  };

  const baseline = await evalAll(o.tools, o.prompts, "baseline");
  let current = o.tools;
  let currentTV = baseline;
  const rewrites: RewriteRecord[] = [];
  let stoppedEarly: string | undefined;

  const budget = o.evalOpts.budget;
  const finalCost = test.length * o.evalOpts.repeats * o.providers.length;
  const candCost = (train.length + validate.length) * o.evalOpts.repeats * o.providers.length;

  const weak = weakTools(baseline, trainIds, o.weakThreshold, o.tools).slice(0, o.maxRewrites);
  log(weak.length ? `weak tools: ${weak.join(", ")}` : "no weak tools found on the training split");

  for (const name of weak) {
    if (budget && budget.calls + candCost + finalCost > budget.max) {
      stoppedEarly = "call budget reached before all candidates were tried";
      break;
    }
    const tool = current.find((t) => t.name === name)!;
    const trainBefore = meanAccuracy(currentTV, trainIds);
    const valBefore = meanAccuracy(currentTV, valIds);
    const rec: RewriteRecord = {
      tool: name,
      before: tool.description,
      after: tool.description,
      accepted: false,
      reason: "",
      trainBefore,
      trainAfter: null,
      validateBefore: valBefore,
      validateAfter: null,
    };
    rewrites.push(rec);

    try {
      // A rewrite can make a tool less attractive and so "fix" the tools it was stealing from.
      // Without prompts that need THIS tool we can't see that loss, so refuse to touch it.
      const needsThis = (set: Set<string>) => o.prompts.some((p) => set.has(p.id) && p.expected === name);
      if (!needsThis(trainIds) || (validate.length > 0 && !needsThis(valIds))) {
        rec.reason = "no train/validation prompts need this tool, so a rewrite couldn't be checked for lost recall";
        continue;
      }
      budget?.charge(); // the rewrite request is a model call too
      const failures = failuresFor(name, currentTV, promptById, trainIds);
      const description = await proposeRewrite(o.rewriter, tool, current.filter((t) => t.name !== name), failures);
      rec.after = description;
      if (!description) { rec.reason = "rewriter returned an empty description"; continue; }
      if (description === tool.description) { rec.reason = "rewriter returned the same description"; continue; }
      if (description.length > 1000) { rec.reason = "rewrite longer than 1000 characters"; continue; }
      if (description.length < 20) { rec.reason = "rewrite shorter than 20 characters"; continue; }
      if (leaksPrompt(description, allPromptTexts)) { rec.reason = "rewrite copies a test prompt verbatim (overfitting)"; continue; }

      const candidate = current.map((t) => (t.name === name ? { ...t, description } : t));
      log(`candidate for ${name}: evaluating`);
      const candRes = await evalAll(candidate, [...train, ...validate], `candidate ${name}`);
      const trainAfter = meanAccuracy(candRes, trainIds);
      const valAfter = meanAccuracy(candRes, valIds);
      rec.trainAfter = trainAfter;
      rec.validateAfter = valAfter;

      const hasVal = validate.length > 0;
      const gateAfter = hasVal ? valAfter : trainAfter;
      const gateBefore = hasVal ? valBefore : trainBefore;
      if (gateAfter <= gateBefore + 1e-9) { rec.reason = `no measurable gain on ${hasVal ? "validation" : "training"} prompts`; continue; }
      if (trainAfter < trainBefore - 1e-9) { rec.reason = "improved validation but hurt training accuracy"; continue; }
      const subset = hasVal ? valIds : trainIds;
      const toolsBefore = toolAccuracy(currentTV, subset);
      const toolsAfter = toolAccuracy(candRes, subset);
      const regressed = Object.keys(toolsBefore).find((t) => (toolsAfter[t] ?? 0) < toolsBefore[t]! - 1e-9);
      if (regressed) { rec.reason = `would regress tool "${regressed}"`; continue; }

      rec.accepted = true;
      rec.reason = "improved on validation prompts without regressing any tool";
      current = candidate;
      currentTV = candRes;
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        stoppedEarly = e.message;
        rec.reason = "stopped: call budget reached";
        break;
      }
      rec.reason = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const anyAccepted = rewrites.some((r) => r.accepted);
  let final: EvalResult[];
  let finalMeasured = true;
  if (!anyAccepted) {
    final = baseline.map((r) => ({ model: r.model, items: filterItems(r, testIds) }));
  } else {
    try {
      final = await evalAll(current, test, "final (test split)");
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e;
      stoppedEarly = e.message;
      finalMeasured = false; // the "after" numbers below are NOT measured with the new descriptions
      final = baseline.map((r) => ({ model: r.model, items: filterItems(r, testIds) }));
    }
  }

  return {
    models: o.providers.map((p) => p.id),
    counts: { train: train.length, validate: validate.length, test: test.length },
    repeats: o.evalOpts.repeats,
    baseline,
    final,
    rewrites,
    originalTools: o.tools,
    finalTools: current,
    finalMeasured,
    stoppedEarly,
  };
}
