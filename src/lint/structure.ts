import type { ToolInfo } from "../mcp/connect.js";
import { schemaProps } from "../util.js";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  tools: string[];
  message: string;
}

const GUIDANCE_RE =
  /\b(use (this )?(when|if|for|to)|use it (when|if|for|to)|when (the user|to use|you)|should be used|instead of|rather than|prefer|do not use|don't use|not for|not to be used|only (for|when|if)|unlike|for .* use \w+ instead)\b/i;

const SUPERLATIVE_RE =
  /\b(best|ultimate|most powerful|always (use|call)|perfect(ly)?|never fails|only tool|#1|state[- ]of[- ]the[- ]art|the right tool)\b/i;

export function lintStructure(tools: ToolInfo[]): Finding[] {
  const out: Finding[] = [];
  const multi = tools.length > 1;

  for (const t of tools) {
    const d = (typeof t.description === "string" ? t.description : "").trim();

    if (d.length === 0) {
      out.push({
        rule: "missing-description",
        severity: "error",
        tools: [t.name],
        message: "No description. The agent can only guess from the name.",
      });
    } else {
      if (d.length < 25) {
        out.push({
          rule: "too-short",
          severity: "warn",
          tools: [t.name],
          message: `Description is only ${d.length} characters ("${d}"). Say what it does, what it returns, and when to use it.`,
        });
      }
      if (d.length > 800) {
        out.push({
          rule: "too-long",
          severity: "info",
          tools: [t.name],
          message: `Description is ${d.length} characters. Long descriptions cost tokens on every request and bury the key distinction.`,
        });
      }
      if (multi && !GUIDANCE_RE.test(d)) {
        out.push({
          rule: "no-usage-guidance",
          severity: d.length < 80 ? "warn" : "info",
          tools: [t.name],
          message: 'No "use when / not for" guidance, so the agent can\'t tell when this tool beats a similar one.',
        });
      }
      if (SUPERLATIVE_RE.test(d)) {
        out.push({
          rule: "superlative-claim",
          severity: "warn",
          tools: [t.name],
          message: "Contains a superlative or pushy claim (e.g. \"best\", \"always use\"). Models over-trust these and pick the tool when they shouldn't.",
        });
      }
    }

    const props = schemaProps(t.inputSchema);
    const names = Object.keys(props);
    const undocumented = names.filter((n) => typeof props[n]?.description !== "string" || !(props[n]!.description as string).trim());
    if (names.length > 0 && undocumented.length > 0) {
      out.push({
        rule: "undocumented-params",
        severity: undocumented.length === names.length ? "warn" : "info",
        tools: [t.name],
        message: `Parameter${undocumented.length > 1 ? "s" : ""} without description: ${undocumented.join(", ")}.`,
      });
    }
  }

  // identical descriptions
  const byDesc = new Map<string, string[]>();
  for (const t of tools) {
    const key = (typeof t.description === "string" ? t.description : "").trim().toLowerCase();
    if (!key) continue;
    byDesc.set(key, [...(byDesc.get(key) ?? []), t.name]);
  }
  for (const names of byDesc.values()) {
    if (names.length > 1) {
      out.push({
        rule: "duplicate-description",
        severity: "error",
        tools: names,
        message: `Identical descriptions: ${names.join(", ")}. The agent has nothing to tell them apart.`,
      });
    }
  }

  // duplicate tool names
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) {
      out.push({ rule: "duplicate-name", severity: "error", tools: [t.name], message: `Tool name "${t.name}" appears more than once.` });
    }
    seen.add(t.name);
  }

  return out;
}
