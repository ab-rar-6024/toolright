import type { ToolInfo } from "../mcp/connect.js";

export interface Pick {
  /** the tool the model chose, or null if it chose none / answered in text */
  tool: string | null;
  /** set when the API call itself failed (not counted as a wrong pick) */
  error?: string;
}

export interface Provider {
  /** display id, e.g. "groq:llama-3.3-70b-versatile" */
  id: string;
  /** true for providers that run on this machine (no cost, no data leaves) */
  local: boolean;
  /** Ask the model which tool it would call. The call is never executed. */
  pick(tools: ToolInfo[], prompt: string): Promise<Pick>;
  /** Plain completion, used for prompt generation and description rewriting. */
  complete(system: string, user: string, opts?: { temperature?: number; maxTokens?: number; json?: boolean }): Promise<string>;
}

export const PICK_SYSTEM =
  "You are an AI agent with access to tools. For the user's request, call exactly one tool: the single best fit. Do not ask questions and do not answer in text.";

/** Tool names must match ^[a-zA-Z0-9_-]{1,64}$ on most APIs. Map MCP names to safe ones and back. */
export function makeNameMap(tools: ToolInfo[]): { toSafe: Map<string, string>; toReal: Map<string, string> } {
  const toSafe = new Map<string, string>();
  const toReal = new Map<string, string>();
  for (const t of tools) {
    let safe = t.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "tool";
    let i = 2;
    while (toReal.has(safe) && toReal.get(safe) !== t.name) safe = `${safe.slice(0, 60)}_${i++}`;
    toSafe.set(t.name, safe);
    toReal.set(safe, t.name);
  }
  return { toSafe, toReal };
}
