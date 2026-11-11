import type { ToolInfo } from "../mcp/connect.js";
import type { TestPrompt } from "../gen/prompts.js";
import type { Provider } from "../providers/types.js";
import { dict, hashString, mapLimit, mulberry32, shuffle, wilson } from "../util.js";

export class BudgetExceeded extends Error {
  constructor(max: number) {
    super(`Call budget of ${max} model calls reached. Raise it with --max-calls.`);
  }
}

/** Shared cap on model calls across a whole run. */
export class Budget {
  calls = 0;
  constructor(public max = Infinity) {}
  charge(n = 1): void {
    if (this.calls + n > this.max) throw new BudgetExceeded(this.max);
    this.calls += n;
  }
}

/** Thrown when a provider fails call after call (bad key, server down) so we stop instead of burning the run. */
export class ProviderUnavailable extends Error {
  constructor(provider: string, lastError: string) {
    super(`${provider} is failing every request, so the run was stopped. Last error: ${lastError}`);
  }
}

/** Consecutive failed calls before we give up on a provider. */
export const MAX_CONSECUTIVE_ERRORS = 8;

export interface Item {
  promptId: string;
  expected: string;
  picked: string | null;
  correct: boolean;
  repeat: number;
  error?: string;
}

export interface EvalResult {
  model: string;
  items: Item[];
}

export interface EvalOptions {
  repeats: number;
  concurrency: number;
  seed: number;
  budget?: Budget;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Run every prompt `repeats` times and record which tool the model picks.
 * Tool order is shuffled per (prompt, repeat) but deterministically from the seed, so a
 * before/after comparison shows the model the same orderings: differences come from the
 * descriptions, not from luck of the shuffle.
 */
export async function evaluate(
  provider: Provider,
  tools: ToolInfo[],
  prompts: TestPrompt[],
  opts: EvalOptions,
): Promise<EvalResult> {
  const jobs = prompts.flatMap((p) => Array.from({ length: opts.repeats }, (_, r) => ({ p, r })));
  let done = 0;
  let consecutiveErrors = 0;
  let fatal: ProviderUnavailable | undefined;
  const results = await mapLimit(jobs, opts.concurrency, async ({ p, r }): Promise<Item | undefined> => {
    if (fatal) return undefined; // another worker already gave up on this provider
    opts.budget?.charge();
    const order = shuffle(tools, mulberry32((opts.seed ^ hashString(p.id) ^ Math.imul(r + 1, 0x9e3779b1)) >>> 0));
    const res = await provider.pick(order, p.text);
    opts.onProgress?.(++done, jobs.length);
    if (res.error) {
      if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) fatal ??= new ProviderUnavailable(provider.id, res.error);
    } else {
      consecutiveErrors = 0;
    }
    return {
      promptId: p.id,
      expected: p.expected,
      picked: res.tool,
      correct: !res.error && res.tool === p.expected,
      repeat: r,
      ...(res.error ? { error: res.error } : {}),
    };
  });
  if (fatal) throw fatal;
  return { model: provider.id, items: results.filter((i): i is Item => i !== undefined) };
}

export interface Summary {
  n: number;
  correct: number;
  errors: number;
  accuracy: number;
  ci: [number, number];
}

/** Accuracy over items (API errors are excluded from the denominator and counted separately). */
export function summarize(items: Item[]): Summary {
  const errors = items.filter((i) => i.error).length;
  const valid = items.filter((i) => !i.error);
  const correct = valid.filter((i) => i.correct).length;
  return {
    n: valid.length,
    correct,
    errors,
    accuracy: valid.length ? correct / valid.length : 0,
    ci: wilson(correct, valid.length),
  };
}

export function filterItems(res: EvalResult, promptIds: Set<string>): Item[] {
  return res.items.filter((i) => promptIds.has(i.promptId));
}

export function perTool(items: Item[]): Record<string, Summary> {
  const by = new Map<string, Item[]>();
  for (const i of items) by.set(i.expected, [...(by.get(i.expected) ?? []), i]);
  return dict([...by].map(([k, v]) => [k, summarize(v)] as const));
}

export interface Confusion {
  expected: string;
  picked: string | null;
  count: number;
}

export function confusions(items: Item[]): Confusion[] {
  const m = new Map<string, Confusion>();
  for (const i of items) {
    if (i.correct || i.error) continue;
    const key = `${i.expected}\u0000${i.picked}`;
    const c = m.get(key) ?? { expected: i.expected, picked: i.picked, count: 0 };
    c.count++;
    m.set(key, c);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/** Rough prompt-token estimate for one pick call, used only for the pre-run cost preview. */
export function estimateTokensPerCall(tools: ToolInfo[]): number {
  const chars = tools.reduce((n, t) => n + t.name.length + t.description.length + JSON.stringify(t.inputSchema).length, 0);
  return Math.ceil(chars / 4) + 150;
}
