import { confusions, filterItems, perTool, summarize, type EvalResult } from "../eval/run.js";
import type { TestPrompt } from "../gen/prompts.js";
import { pct } from "../util.js";
import type { TuneResult } from "../tune/index.js";

const fmt = (s: ReturnType<typeof summarize>) =>
  s.n === 0 ? "n/a" : `${pct(s.accuracy)} (${s.correct}/${s.n}, CI ${pct(s.ci[0])}-${pct(s.ci[1])})`;

export function evalReport(results: EvalResult[], prompts: TestPrompt[], repeats: number): string {
  const L: string[] = [];
  L.push("# Toolright eval", "");
  L.push(`${prompts.length} prompts x ${repeats} runs per model. CI is a 95% Wilson interval.`, "");
  L.push("| Model | Accuracy | API errors |", "|---|---|---|");
  for (const r of results) {
    const s = summarize(r.items);
    L.push(`| ${r.model}${r.model === "heuristic" ? " (not a real model)" : ""} | ${fmt(s)} | ${s.errors} |`);
  }
  for (const r of results) {
    L.push("", `## ${r.model}`, "", "| Tool | Accuracy |", "|---|---|");
    const rows = Object.entries(perTool(r.items)).sort((a, b) => a[1].accuracy - b[1].accuracy);
    for (const [tool, s] of rows) L.push(`| ${tool} | ${fmt(s)} |`);
    const conf = confusions(r.items).slice(0, 8);
    if (conf.length) {
      L.push("", "Most common wrong picks:", "");
      for (const c of conf) L.push(`- expected \`${c.expected}\`, picked \`${c.picked ?? "(none)"}\`: ${c.count}x`);
    }
  }
  return L.join("\n") + "\n";
}

export function tuneReport(r: TuneResult): string {
  const testIds = new Set(r.final[0]?.items.map((i) => i.promptId) ?? []);
  const L: string[] = [];
  const accepted = r.rewrites.filter((x) => x.accepted);
  L.push("# Toolright report", "");
  L.push(
    `Prompts: ${r.counts.train} train / ${r.counts.validate} validate / ${r.counts.test} test, ${r.repeats} run(s) each. ` +
      "The rewriter only saw train failures. Candidates were gated on validate. The numbers below come from the test split, which no decision used.",
    "",
  );
  if (r.stoppedEarly) L.push(`> **Stopped early:** ${r.stoppedEarly}`, "");
  if (r.note) L.push(`> **Note:** ${r.note}`, "");
  if (!r.finalMeasured) L.push("> **The \"after\" column is not measured with the new descriptions**, so ignore it. The budget ran out first.", "");

  L.push("## Accuracy on held-out test prompts", "", "| Model | Before | After |", "|---|---|---|");
  for (const base of r.baseline) {
    const after = r.final.find((f) => f.model === base.model)!;
    const b = summarize(filterItems(base, testIds));
    const a = summarize(after.items);
    L.push(`| ${base.model}${base.model === "heuristic" ? " (not a real model)" : ""} | ${fmt(b)} | ${r.finalMeasured ? fmt(a) : "not measured"} |`);
  }

  L.push("", `## Rewrites (${accepted.length} accepted, ${r.rewrites.length - accepted.length} rejected)`, "");
  if (r.rewrites.length === 0) L.push(r.note ? "No rewrites were tried (see the note above)." : "No weak tools found, so nothing was rewritten.");
  for (const w of r.rewrites) {
    L.push(`### ${w.accepted ? "Accepted" : "Rejected"}: \`${w.tool}\``, "");
    L.push(`- Before: ${w.before || "(empty)"}`, `- After: ${w.after || "(empty)"}`);
    const v = w.validateAfter === null ? "not measured" : `${pct(w.validateBefore)} -> ${pct(w.validateAfter)}`;
    L.push(`- Validation accuracy (mean over models): ${v}`, `- Decision: ${w.reason}`, "");
  }
  L.push(
    "## Review before merging",
    "",
    "Generated prompts are only a proxy for real user requests, and each rewrite was written by a model. Read every accepted description: it must be true of the tool. Numbers are per model; a gain on one model is not a gain on all.",
  );
  return L.join("\n") + "\n";
}

/** Plain before/after diff of descriptions for accepted rewrites. */
export function descriptionDiff(r: TuneResult): string {
  const out: string[] = [];
  for (const w of r.rewrites.filter((x) => x.accepted)) {
    out.push(`@@ ${w.tool} @@`, `- ${w.before}`, `+ ${w.after}`, "");
  }
  return out.join("\n");
}

export { generateHtmlReport } from "./html.js";

export function tuneJson(r: TuneResult) {
  const testIds = new Set(r.final[0]?.items.map((i) => i.promptId) ?? []);
  return {
    models: r.models,
    counts: r.counts,
    repeats: r.repeats,
    finalMeasured: r.finalMeasured,
    stoppedEarly: r.stoppedEarly ?? null,
    note: r.note ?? null,
    test: r.baseline.map((base) => ({
      model: base.model,
      before: summarize(filterItems(base, testIds)),
      after: r.finalMeasured ? summarize(r.final.find((f) => f.model === base.model)!.items) : null,
    })),
    rewrites: r.rewrites,
    descriptions: Object.fromEntries(r.finalTools.map((t) => [t.name, t.description])),
  };
}
