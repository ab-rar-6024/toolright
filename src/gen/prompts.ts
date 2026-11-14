import { readFile, writeFile } from "node:fs/promises";
import type { ToolInfo } from "../mcp/connect.js";
import type { Provider } from "../providers/types.js";
import { extractJson, hashString, mulberry32, schemaProps, shuffle, tokenize } from "../util.js";

export type Split = "train" | "validate" | "test";

export interface TestPrompt {
  id: string;
  text: string;
  /** the tool that is the correct answer */
  expected: string;
  /** "direct": plain request for this tool. "near-miss": phrased close to a similar tool but still needs this one. */
  kind: "direct" | "near-miss";
  split: Split;
}

export interface PromptFile {
  version: 1;
  toolNames: string[];
  prompts: TestPrompt[];
}

export interface GenOptions {
  perTool: number;
  nearMiss: number;
  seed: number;
  /** tool name -> names of its most confusable siblings (from lint) */
  siblings?: Map<string, string[]>;
  onProgress?: (done: number, total: number) => void;
  /** called for anything that silently reduces the prompt set (failed generation, filtered prompts) */
  onWarn?: (message: string) => void;
}

const GEN_SYSTEM = `You write realistic test requests for evaluating whether an AI agent picks the right tool.
Output ONLY a JSON object, no prose.`;

function genUser(tool: ToolInfo, siblings: ToolInfo[], direct: number, nearMiss: number): string {
  const params = Object.keys(schemaProps(tool.inputSchema)).join(", ") || "(none)";
  const sib = siblings.map((s) => `- ${s.name}: ${s.description || "(no description)"}`).join("\n") || "(none)";
  return `Target tool: ${tool.name}
Description: ${tool.description || "(no description)"}
Parameters: ${params}

Similar tools that could be confused with it:
${sib}

Write ${direct} "direct" requests and ${nearMiss} "near_miss" requests, each something a real user would type to an agent.
- direct: clearly needs the target tool. Vary wording, length and specificity.
- near_miss: needs the target tool, but is phrased so it superficially resembles one of the similar tools (shared words, similar intent). If there are no similar tools, make it ambiguous-sounding but still answerable only by the target.
Rules: never mention any tool name; do not copy the description's wording; include concrete details (names, values) a user would give; each request must be answerable by the target tool and NOT better served by the similar tools.
Return a JSON object with exactly two keys: "direct" (an array of ${direct} request strings) and "near_miss" (an array of ${nearMiss} request strings). Every string must be a real, specific request, never a placeholder.`;
}

// Quote and ellipsis characters, built from char codes so the source stays plain ASCII.
const ELLIPSIS = String.fromCharCode(0x2026);
const WRAPPERS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  [String.fromCharCode(0x201c), String.fromCharCode(0x201d)],
  [String.fromCharCode(0x2018), String.fromCharCode(0x2019)],
];
const LEAD_DOTS = new RegExp(`^(\\.{2,}|${ELLIPSIS})\\s*`);
const TRAIL_DOTS = new RegExp(`\\s*(\\.{3,}|${ELLIPSIS})$`);

/**
 * Strip the "..." and the quotes small models wrap around a whole request. A quote is removed
 * only when it surrounds the entire prompt, so find 'user123' keeps its closing quote.
 */
export function tidy(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(LEAD_DOTS, "").replace(TRAIL_DOTS, "").trim();
    for (const [open, close] of WRAPPERS) {
      if (t.length > 1 && t.startsWith(open) && t.endsWith(close)) t = t.slice(open.length, t.length - close.length).trim();
    }
    if (t === before) break;
  }
  return t;
}

/** True for non-requests like "...", "<request 1>" or "example request" that a model copied from the instructions. */
export function isPlaceholder(s: string): boolean {
  if (!/[a-z0-9]/i.test(s)) return true; // only punctuation, e.g. "..."
  if (/^<[^>]*>$|^\[[^\]]*\]$|^\{[^}]*\}$/.test(s)) return true; // <request 1>, [your request]
  return /^(example|sample|placeholder|request|prompt)( request| prompt)?( ?\d+)?$/i.test(s);
}

interface Cleaned {
  items: string[];
  /** how many entries were dropped as too short or as placeholders */
  dropped: number;
}

function clean(list: unknown): Cleaned {
  if (!Array.isArray(list)) return { items: [], dropped: 0 };
  const all = list.filter((x): x is string => typeof x === "string").map(tidy);
  const items = all.filter((s) => s.length >= 8 && !isPlaceholder(s));
  return { items, dropped: all.length - items.length };
}

export interface Coverage {
  tool: string;
  total: number;
  train: number;
  validate: number;
  test: number;
}

/** Prompt counts per tool (including tools with none), so gaps can't hide. */
export function promptCoverage(prompts: TestPrompt[], tools: ToolInfo[]): Coverage[] {
  return tools.map((t) => {
    const mine = prompts.filter((p) => p.expected === t.name);
    const n = (s: Split) => mine.filter((p) => p.split === s).length;
    return { tool: t.name, total: mine.length, train: n("train"), validate: n("validate"), test: n("test") };
  });
}

/** Assign train/validate/test per tool (stratified), 50/25/25. */
export function assignSplits(prompts: Omit<TestPrompt, "split">[], seed: number): TestPrompt[] {
  const rng = mulberry32(seed);
  const byTool = new Map<string, Omit<TestPrompt, "split">[]>();
  for (const p of prompts) byTool.set(p.expected, [...(byTool.get(p.expected) ?? []), p]);
  const out: TestPrompt[] = [];
  for (const list of byTool.values()) {
    const s = shuffle(list, rng);
    const n = s.length;
    const nTest = n >= 3 ? Math.max(1, Math.round(n * 0.25)) : 0;
    const nVal = n >= 4 ? Math.max(1, Math.round(n * 0.25)) : 0;
    s.forEach((p, i) => {
      const split: Split = i < nTest ? "test" : i < nTest + nVal ? "validate" : "train";
      out.push({ ...p, split });
    });
  }
  return out;
}

/** A tool name is "distinctive" if a user would not type it by accident (search_issues, listIssues, ...). */
function isDistinctive(name: string): boolean {
  return /[_\-.]/.test(name) || /[a-z][A-Z]/.test(name) || name.length >= 10;
}

function leaksToolName(lowerText: string, names: string[]): boolean {
  return names.some((n) => {
    const i = lowerText.indexOf(n);
    if (i === -1) return false;
    const before = lowerText[i - 1];
    const after = lowerText[i + n.length];
    return !(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after));
  });
}

export async function generatePrompts(provider: Provider, tools: ToolInfo[], opts: GenOptions): Promise<TestPrompt[]> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const raw: Omit<TestPrompt, "split">[] = [];
  const seen = new Set<string>();
  let done = 0;
  const leakNames = tools.map((t) => t.name.toLowerCase()).filter(isDistinctive);

  for (const tool of tools) {
    const sibNames = opts.siblings?.get(tool.name) ?? [];
    const siblings = sibNames.map((n) => byName.get(n)).filter((t): t is ToolInfo => !!t);
    let parsed: any = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const text = await provider.complete(GEN_SYSTEM, genUser(tool, siblings, opts.perTool, opts.nearMiss), {
          temperature: 0.8,
          maxTokens: 2048,
          json: true,
        });
        parsed = extractJson(text);
      } catch {
        parsed = null;
      }
    }
    opts.onProgress?.(++done, tools.length);
    if (!parsed) {
      opts.onWarn?.(`${tool.name}: the model did not return valid JSON after 2 tries, so this tool has no prompts.`);
      continue;
    }
    const drop = { duplicate: 0, leak: 0, unusable: 0 };
    let kept = 0;

    const add = (texts: string[], kind: TestPrompt["kind"]) => {
      for (const text of texts) {
        const key = text.toLowerCase();
        if (seen.has(key)) { drop.duplicate++; continue; } // dedupe
        if (leaksToolName(key, leakNames)) { drop.leak++; continue; } // drop prompts that name a tool
        seen.add(key);
        kept++;
        raw.push({ id: `${tool.name}#${hashString(key).toString(36)}`, text, expected: tool.name, kind });
      }
    };
    const direct = clean(parsed.direct);
    const near = clean(parsed.near_miss ?? parsed.nearMiss);
    drop.unusable = direct.dropped + near.dropped;
    add(direct.items.slice(0, opts.perTool), "direct");
    add(near.items.slice(0, opts.nearMiss), "near-miss");
    const wanted = opts.perTool + opts.nearMiss;
    if (kept < wanted) {
      const why = [
        drop.unusable && `${drop.unusable} empty or placeholder`,
        drop.duplicate && `${drop.duplicate} duplicate`,
        drop.leak && `${drop.leak} named a tool`,
      ].filter(Boolean).join(", ");
      opts.onWarn?.(`${tool.name}: kept ${kept} of ${wanted} prompts${why ? ` (dropped: ${why})` : " (the model wrote fewer than asked)"}.`);
    }
  }
  return assignSplits(raw, opts.seed);
}

export async function savePrompts(path: string, tools: ToolInfo[], prompts: TestPrompt[]): Promise<void> {
  const file: PromptFile = { version: 1, toolNames: tools.map((t) => t.name), prompts };
  await writeFile(path, JSON.stringify(file, null, 2) + "\n", "utf8");
}

export async function loadPrompts(path: string, tools: ToolInfo[], seed = 1): Promise<TestPrompt[]> {
  const text = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  const parsed = JSON.parse(text);
  const list: any[] = Array.isArray(parsed) ? parsed : parsed.prompts;
  if (!Array.isArray(list)) throw new Error(`${path}: expected {"prompts": [...]}`);
  const names = new Set(tools.map((t) => t.name));
  const base = list.map((p, i) => {
    if (typeof p.text !== "string" || typeof p.expected !== "string") throw new Error(`${path}: prompt ${i} needs "text" and "expected"`);
    if (!names.has(p.expected)) throw new Error(`${path}: prompt ${i} expects unknown tool "${p.expected}"`);
    return {
      id: String(p.id ?? `${p.expected}#${hashString(p.text).toString(36)}`),
      text: p.text as string,
      expected: p.expected as string,
      kind: (p.kind === "near-miss" ? "near-miss" : "direct") as TestPrompt["kind"],
      split: p.split as Split | undefined,
    };
  });
  if (base.every((p) => p.split === "train" || p.split === "validate" || p.split === "test")) return base as TestPrompt[];
  return assignSplits(base, seed);
}

/** Does `text` appear to contain one of the prompts verbatim? Used to stop rewrites from memorizing test prompts. */
export function leaksPrompt(text: string, prompts: TestPrompt[]): boolean {
  const norm = (s: string) => tokenize(s).join(" ");
  const t = norm(text);
  return prompts.some((p) => {
    const n = norm(p.text);
    return n.length >= 20 && t.includes(n);
  });
}
