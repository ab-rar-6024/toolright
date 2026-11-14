import type { Finding } from "./structure.js";
import type { LintResult } from "./index.js";

export function formatLintMarkdown(result: LintResult): string {
  const lines: string[] = [];
  lines.push("## 🔍 Toolright Lint Report");
  lines.push("");
  lines.push(`Checked **${result.tools} tools** (similarity: \`${result.method}\`, threshold \`${result.threshold}\`).`);
  lines.push("");

  const errors = result.findings.filter((f) => f.severity === "error");
  const warns = result.findings.filter((f) => f.severity === "warn");
  const infos = result.findings.filter((f) => f.severity === "info");

  lines.push(`**Summary:** ${errors.length} error(s), ${warns.length} warning(s), ${infos.length} note(s).`);
  lines.push("");

  const pairFs = result.findings.filter((f) => f.rule === "confusable-pair");
  if (pairFs.length > 0) {
    lines.push("### ⚠️ Confusable Tool Pairs");
    lines.push("");
    lines.push("| Status | Message |");
    lines.push("|---|---|");
    for (const f of pairFs) {
      const badge = f.severity === "error" ? "🛑 Error" : f.severity === "warn" ? "⚠️ Warning" : "ℹ️ Note";
      lines.push(`| ${badge} | ${f.message} |`);
    }
    lines.push("");
  }

  const byTool = new Map<string, Finding[]>();
  for (const f of result.findings) {
    if (f.rule === "confusable-pair") continue;
    const key = f.tools.join(", ");
    byTool.set(key, [...(byTool.get(key) ?? []), f]);
  }

  if (byTool.size > 0) {
    lines.push("### 🛠️ Issues by Tool");
    lines.push("");
    lines.push("| Tool | Severity | Rule | Details |");
    lines.push("|---|---|---|---|");
    for (const [tool, fs] of byTool) {
      for (const f of fs) {
        const badge = f.severity === "error" ? "🛑 Error" : f.severity === "warn" ? "⚠️ Warning" : "ℹ️ Note";
        lines.push(`| \`${tool}\` | ${badge} | \`${f.rule}\` | ${f.message} |`);
      }
    }
    lines.push("");
  }

  if (result.findings.length === 0) {
    lines.push("✅ **All tool descriptions look distinct and well-structured!**");
    lines.push("");
  }

  if (result.pairs.some((p) => !p.disambiguated)) {
    lines.push("> 💡 **Next:** Run `toolright eval` or `toolright tune` to measure and fix model confusion on these tools.");
    lines.push("");
  }

  return lines.join("\n");
}
