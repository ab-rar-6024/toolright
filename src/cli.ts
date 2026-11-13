#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError } from "commander";
import { attachBranding } from "./brand.js";
import { VERSION } from "./version.js";
import { Budget, BudgetExceeded, estimateTokensPerCall, evaluate } from "./eval/run.js";
import { generatePrompts, loadPrompts, savePrompts, type TestPrompt } from "./gen/prompts.js";
import { exitCode, formatLint, lint } from "./lint/index.js";
import { siblingMap, type SimilarityMethod } from "./lint/overlap.js";
import type { Severity } from "./lint/structure.js";
import { loadTools, type ToolInfo, type ToolSource } from "./mcp/connect.js";
import { createProvider, type Provider } from "./providers/index.js";
import { descriptionDiff, evalReport, tuneJson, tuneReport } from "./report/index.js";
import { tune } from "./tune/index.js";

const program = new Command();
program.name("toolright").description("Does your agent pick the right tool?").version(VERSION);

// Branding: only on an interactive terminal (never in pipes, --json output or CI), color adapts to the terminal.
attachBranding(program, { version: VERSION });

const log = (m: string) => console.error(m);

// ---------- option parsing ----------
const posInt = (name: string) => (v: string) => {
  if (!/^\d+$/.test(v) || Number(v) < 1) throw new InvalidArgumentError(`${name} must be a positive integer (got "${v}").`);
  return Number(v);
};
const anyInt = (name: string) => (v: string) => {
  if (!/^-?\d+$/.test(v)) throw new InvalidArgumentError(`${name} must be an integer (got "${v}").`);
  return Number(v);
};
const unit = (name: string) => (v: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new InvalidArgumentError(`${name} must be a number between 0 and 1 (got "${v}").`);
  return n;
};
const collect = (v: string, prev: string[]) => [...prev, v];

/** Expand ${NAME} from the environment so secrets needn't appear on the command line. */
function expandEnv(s: string): string {
  return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    const v = process.env[name];
    if (v === undefined) throw new Error(`--header refers to \${${name}} but that environment variable is not set.`);
    return v;
  });
}

function parseHeaders(list: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of list) {
    const i = h.indexOf(":");
    if (i < 1) throw new Error(`--header must look like "Name: value" (got "${h}").`);
    out[h.slice(0, i).trim()] = expandEnv(h.slice(i + 1).trim());
  }
  return out;
}

function source(opts: { url?: string; tools?: string; header?: string[]; timeout?: number }, command: string[]): ToolSource {
  return { command, url: opts.url, toolsFile: opts.tools, headers: parseHeaders(opts.header ?? []), timeoutMs: opts.timeout };
}

function withServer(cmd: Command): Command {
  return cmd
    .option("--url <endpoint>", "connect to a remote MCP server over streamable HTTP")
    .option("--header <header>", 'extra HTTP header for --url, e.g. "Authorization: Bearer ${TOKEN}" (repeatable; ${VAR} is read from the environment)', collect, [] as string[])
    .option("--tools <file>", "use a tools snapshot from `toolright list --json` instead of connecting")
    .option("--timeout <ms>", "give up connecting to / listing the server after this long", posInt("--timeout"), 30_000)
    .argument("[server...]", "server command after --, e.g. -- node server.js")
    .allowExcessArguments(true);
}

function requireComparable(tools: ToolInfo[]): void {
  if (tools.length < 2) {
    throw new Error(`The server exposes ${tools.length} tool(s). Tool selection needs at least 2 tools to compare.`);
  }
}

// ---------- cost gate ----------
async function confirmCost(providers: Provider[], calls: number, tools: ToolInfo[], yes: boolean): Promise<void> {
  const paid = providers.filter((p) => !p.local);
  const tokens = estimateTokensPerCall(tools) * calls;
  log(`Plan: ~${calls} model calls across ${providers.length} model(s), ~${tokens.toLocaleString("en-US")} input tokens (+ generation/rewrite calls). Failed calls are retried and not counted here.`);
  if (paid.length === 0) return;
  log(`Cloud models: ${paid.map((p) => p.id).join(", ")}. Your tool names, descriptions and test prompts are sent to those providers. Check their pricing: this tool does not estimate dollars.`);
  if (yes) return;
  if (!process.stdin.isTTY) throw new Error("Refusing to spend API calls without confirmation. Re-run with --yes.");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ans = (await rl.question("Proceed? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (ans !== "y" && ans !== "yes") throw new Error("Aborted.");
}

/** One tiny call per model, before any real spend, so a bad key or a stopped server fails in a second. */
async function preflight(providers: Provider[], rewriter: Provider | undefined, tools: ToolInfo[], budget: Budget): Promise<void> {
  for (const p of providers) {
    budget.charge();
    const r = await p.pick(tools, "Preflight check: pick any tool.");
    if (r.error) throw new Error(`${p.id} failed a test call: ${r.error}`);
  }
  if (rewriter) {
    budget.charge();
    try {
      await rewriter.complete("Reply with the single word OK.", "OK?", { maxTokens: 8, temperature: 0 });
    } catch (e) {
      throw new Error(`${rewriter.id} failed a test call: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ---------- list ----------
withServer(program.command("list").description("Print the tools an MCP server exposes").option("--json", "print JSON")).action(
  async (server: string[], opts) => {
    const tools = await loadTools(source(opts, server));
    if (opts.json) return void console.log(JSON.stringify(tools, null, 2));
    console.log(`${tools.length} tools\n`);
    for (const t of tools) console.log(`- ${t.name}: ${t.description || "(no description)"}`);
  },
);

// ---------- lint (Tier 1) ----------
withServer(
  program
    .command("lint")
    .description("Tier 1: instant checks, no model and no API key")
    .option("--json", "print JSON")
    .option("--embeddings", "use a small local embedding model for overlap (experimental; needs @huggingface/transformers)")
    .option("--threshold <n>", "similarity above which two tools count as confusable (0-1)", unit("--threshold"))
    .option("--fail-on <level>", "exit 1 on findings at this level or worse: error | warn | info | none", "error"),
).action(async (server: string[], opts) => {
  if (!["error", "warn", "info", "none"].includes(opts.failOn)) throw new Error(`--fail-on must be error, warn, info or none (got "${opts.failOn}").`);
  const tools = await loadTools(source(opts, server));
  const method: SimilarityMethod = opts.embeddings ? "embeddings" : "lexical";
  const result = await lint(tools, { method, threshold: opts.threshold });
  console.log(opts.json ? JSON.stringify(result, null, 2) : formatLint(result, process.stdout.isTTY));
  process.exitCode = exitCode(result, opts.failOn as Severity | "none");
});

// ---------- prompt generation helper ----------
async function generate(gen: Provider, tools: ToolInfo[], opts: { perTool: number; nearMiss: number; seed: number }): Promise<TestPrompt[]> {
  const lintRes = await lint(tools);
  const prompts = await generatePrompts(gen, tools, {
    perTool: opts.perTool,
    nearMiss: opts.nearMiss,
    seed: opts.seed,
    siblings: siblingMap(lintRes.pairs),
    onProgress: (d, t) => log(`generated prompts for ${d}/${t} tools`),
  });
  if (prompts.length === 0) {
    throw new Error(`${gen.id} produced no usable prompts. Check the model can follow JSON instructions, or write a prompts file by hand.`);
  }
  return prompts;
}

// ---------- gen ----------
withServer(
  program
    .command("gen")
    .description("Generate test prompts (needs a model) and save them for human review")
    .requiredOption("--generator <model>", "model that writes the prompts, e.g. groq:<model>")
    .option("--per-tool <n>", "direct prompts per tool", posInt("--per-tool"), 6)
    .option("--near-miss <n>", "near-miss prompts per tool", posInt("--near-miss"), 3)
    .option("--seed <n>", "random seed", anyInt("--seed"), 1)
    .option("-o, --out <file>", "output file", "prompts.json")
    .option("--yes", "skip the cost confirmation"),
).action(async (server: string[], opts) => {
  const tools = await loadTools(source(opts, server));
  requireComparable(tools);
  const gen = createProvider(opts.generator);
  await confirmCost([gen], tools.length, tools, !!opts.yes);
  await preflight([], gen, tools, new Budget());
  const prompts = await generate(gen, tools, opts);
  await savePrompts(opts.out, tools, prompts);
  console.log(`Wrote ${prompts.length} prompts to ${opts.out}. Read them before trusting any score: edit or delete bad ones.`);
});

// ---------- shared eval/tune options ----------
function evalOptions(cmd: Command): Command {
  return cmd
    .option("-m, --model <spec>", "model to test (repeatable), e.g. ollama:qwen2.5:3b", collect, [] as string[])
    .option("--prompts <file>", "prompts file from `toolright gen` (or your own)")
    .option("--generator <model>", "model that writes prompts if --prompts is not given (defaults to first --model)")
    .option("--per-tool <n>", "direct prompts per tool when generating", posInt("--per-tool"), 6)
    .option("--near-miss <n>", "near-miss prompts per tool when generating", posInt("--near-miss"), 3)
    .option("--repeats <n>", "runs per prompt per model (tool order is reshuffled each run)", posInt("--repeats"), 3)
    .option("--concurrency <n>", "parallel calls (default 1 for local models, 4 otherwise)", posInt("--concurrency"))
    .option("--max-calls <n>", "hard cap on model calls", posInt("--max-calls"))
    .option("--seed <n>", "random seed", anyInt("--seed"), 1)
    .option("--yes", "skip the cost confirmation");
}

function buildProviders(specs: string[]): Provider[] {
  if (specs.length === 0) throw new Error("Pass at least one --model, e.g. --model ollama:qwen2.5:3b");
  return specs.map((s) => createProvider(s));
}

/**
 * Load prompts from a file (free), or return null if they must be generated.
 * Generation costs model calls, so callers confirm the cost BEFORE calling generate().
 */
async function maybeLoadPrompts(opts: any, tools: ToolInfo[]): Promise<TestPrompt[] | null> {
  return opts.prompts ? loadPrompts(opts.prompts, tools, opts.seed) : null;
}

const progress = (label: string) => (done: number, total: number) => {
  if (process.stderr.isTTY) process.stderr.write(`\r${label} ${done}/${total}   `);
  if (done === total && process.stderr.isTTY) process.stderr.write("\n");
};

// ---------- eval (Tier 2/3) ----------
evalOptions(withServer(program.command("eval").description("Measure how often each model picks the correct tool").option("-o, --out <dir>", "write report here", "toolright-out"))).action(
  async (server: string[], opts) => {
    const tools = await loadTools(source(opts, server));
    requireComparable(tools);
    const providers = buildProviders(opts.model);
    let prompts = await maybeLoadPrompts(opts, tools);
    const generator = prompts ? undefined : createProvider(opts.generator ?? opts.model[0]);
    const nPrompts = prompts ? prompts.length : tools.length * (opts.perTool + opts.nearMiss);
    await confirmCost(generator ? [...providers, generator] : providers, nPrompts * opts.repeats * providers.length + (generator ? tools.length : 0), tools, !!opts.yes);

    const budget = new Budget(opts.maxCalls ?? Infinity);
    await preflight(providers, generator, tools, budget);
    if (!prompts && generator) {
      log(`Generating prompts with ${generator.id}`);
      prompts = await generate(generator, tools, opts);
    }
    const finalPrompts = prompts!;

    const results = [];
    try {
      for (const p of providers) {
        results.push(
          await evaluate(p, tools, finalPrompts, {
            repeats: opts.repeats,
            concurrency: opts.concurrency ?? (p.local ? 1 : 4),
            seed: opts.seed,
            budget,
            onProgress: progress(p.id),
          }),
        );
      }
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e;
      log(e.message);
    }
    const md = evalReport(results, finalPrompts, opts.repeats);
    await mkdir(opts.out, { recursive: true });
    await writeFile(join(opts.out, "eval.md"), md);
    await writeFile(join(opts.out, "eval.json"), JSON.stringify({ results, prompts: finalPrompts }, null, 2));
    console.log(md);
    console.error(`Saved to ${opts.out}/. ${budget.calls} model calls used.`);
  },
);

// ---------- tune ----------
evalOptions(
  withServer(
    program
      .command("tune")
      .description("Baseline, rewrite weak descriptions, keep only measured improvements")
      .requiredOption("--rewriter <model>", "model that proposes rewrites (use your strongest)")
      .option("--max-rewrites <n>", "most tools to try rewriting", posInt("--max-rewrites"), 5)
      .option("--weak-threshold <n>", "tools below this train accuracy are rewrite candidates (0-1)", unit("--weak-threshold"), 0.9)
      .option("-o, --out <dir>", "write results here", "toolright-out"),
  ),
).action(async (server: string[], opts) => {
  const tools = await loadTools(source(opts, server));
  requireComparable(tools);
  const providers = buildProviders(opts.model);
  const rewriter = createProvider(opts.rewriter);
  let prompts = await maybeLoadPrompts(opts, tools);
  const generator = prompts ? undefined : createProvider(opts.generator ?? opts.model[0]);
  const maxRewrites: number = opts.maxRewrites;
  const nPrompts = prompts ? prompts.length : tools.length * (opts.perTool + opts.nearMiss);
  const calls = nPrompts * opts.repeats * providers.length * (1 + maxRewrites * 0.75 + 0.25) + maxRewrites + (generator ? tools.length : 0);
  await confirmCost([...providers, rewriter, ...(generator ? [generator] : [])], Math.round(calls), tools, !!opts.yes);

  const budget = new Budget(opts.maxCalls ?? Infinity);
  await preflight(providers, rewriter, tools, budget);
  if (!prompts && generator) {
    log(`Generating prompts with ${generator.id}`);
    prompts = await generate(generator, tools, opts);
  }
  const finalPrompts = prompts!;

  const concurrency = opts.concurrency ?? (providers.every((p) => p.local) ? 1 : 4);
  const result = await tune({
    tools,
    prompts: finalPrompts,
    providers,
    rewriter,
    evalOpts: { repeats: opts.repeats, concurrency, seed: opts.seed, budget },
    maxRewrites,
    weakThreshold: opts.weakThreshold,
    log,
  });
  await mkdir(opts.out, { recursive: true });
  await writeFile(join(opts.out, "report.md"), tuneReport(result));
  await writeFile(join(opts.out, "report.json"), JSON.stringify(tuneJson(result), null, 2));
  await writeFile(join(opts.out, "descriptions.diff"), descriptionDiff(result));
  await savePrompts(join(opts.out, "prompts.json"), tools, finalPrompts);
  console.log(tuneReport(result));
  console.error(`Saved report.md, report.json, descriptions.diff, prompts.json to ${opts.out}/. ${budget.calls} model calls used.`);
});

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
