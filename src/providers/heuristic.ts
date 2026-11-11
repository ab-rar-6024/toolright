import type { ToolInfo } from "../mcp/connect.js";
import { tokenize } from "../util.js";
import type { Pick, Provider } from "./types.js";

/**
 * NOT a real model. Picks the tool whose name+description shares the most words with the
 * prompt (ties go to whichever tool was listed first, so shuffling the tool order adds the
 * same kind of position noise a model has). It exists so the whole pipeline can be tried and
 * tested with no key and no model download. Never quote its numbers as model accuracy.
 */
export function heuristicProvider(): Provider {
  return {
    id: "heuristic",
    local: true,
    async pick(tools: ToolInfo[], prompt: string): Promise<Pick> {
      const p = new Set(tokenize(prompt));
      let best: string | null = null;
      let bestScore = -1;
      for (const t of tools) {
        const words = new Set([...tokenize(t.name), ...tokenize(t.description)]);
        let score = 0;
        for (const w of words) if (p.has(w)) score++;
        if (score > bestScore) {
          bestScore = score;
          best = t.name;
        }
      }
      return { tool: best };
    },
    async complete() {
      throw new Error(
        "The heuristic provider can't generate text. Use a real model for --generator / --rewriter, or pass --prompts.",
      );
    },
  };
}
