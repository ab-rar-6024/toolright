import type { ToolInfo } from "../mcp/connect.js";
import {
  DEFAULT_THRESHOLD,
  confusablePairs,
  embeddingSimilarity,
  lexicalSimilarity,
  pairFindings,
  type Pair,
  type SimilarityMethod,
} from "./overlap.js";
import { lintStructure, type Finding, type Severity } from "./structure.js";

export type { Finding, Severity };

export interface LintOptions {
  method?: SimilarityMethod;
  threshold?: number;
}

export interface LintResult {
  tools: number;
  method: SimilarityMethod;
  threshold: number;
  findings: Finding[];
  pairs: Pair[];
}

const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export async function lint(tools: ToolInfo[], opts: LintOptions = {}): Promise<LintResult> {
  const method = opts.method ?? "lexical";
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD[method];
  const sim = method === "embeddings" ? await embeddingSimilarity(tools) : lexicalSimilarity(tools);
  const pairs = confusablePairs(tools, sim, threshold);
  const findings = [...lintStructure(tools), ...pairFindings(pairs)].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity],
  );
  return { tools: tools.length, method, threshold, findings, pairs };
}

export function formatLint(result: LintResult, color = false): string {
  const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const tag = (s: Severity) =>
    s === "error" ? c("31", "error") : s === "warn" ? c("33", "warn ") : c("90", "info ");
  const lines: string[] = [];
  lines.push(`${result.tools} tools checked (similarity: ${result.method}, threshold ${result.threshold})`);
  lines.push("");
  if (result.findings.length === 0) lines.push("No issues found.");

  const pairFs = result.findings.filter((f) => f.rule === "confusable-pair");
  if (pairFs.length) {
    lines.push("Confusable pairs (most likely cause of wrong picks):");
    for (const f of pairFs) lines.push(`  ${tag(f.severity)}  ${f.message}`);
    lines.push("");
  }

  const byTool = new Map<string, Finding[]>();
  for (const f of result.findings) {
    if (f.rule === "confusable-pair") continue;
    const key = f.tools.join(", ");
    byTool.set(key, [...(byTool.get(key) ?? []), f]);
  }
  for (const [tools, fs] of byTool) {
    lines.push(tools);
    for (const f of fs) lines.push(`  ${tag(f.severity)}  ${f.rule}: ${f.message}`);
  }
  const count = (s: Severity) => result.findings.filter((f) => f.severity === s).length;
  lines.push("");
  lines.push(`${count("error")} errors, ${count("warn")} warnings, ${count("info")} notes`);
  if (result.pairs.some((p) => !p.disambiguated)) {
    lines.push("Next: run `toolright eval` to measure whether real models actually confuse these.");
  }
  return lines.join("\n");
}

/** Exit code for CI: 1 if any finding at or above `failOn`. */
export function exitCode(result: LintResult, failOn: Severity | "none"): number {
  if (failOn === "none") return 0;
  return result.findings.some((f) => ORDER[f.severity] <= ORDER[failOn]) ? 1 : 0;
}
