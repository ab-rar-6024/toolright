# Toolright - implementation plan

Tagline: Does your agent pick the right tool?

Toolright tests whether AI agents choose the correct MCP tool, then rewrites weak
tool descriptions and keeps only the rewrites that measurably help.

## Three tiers (same pipeline, different "judge")

| Tier | Needs | What it does |
|------|-------|--------------|
| 1. lint  | nothing (no key, no network after first model download) | Heuristic checks + local-embedding overlap between tools. Fast, CI-friendly. |
| 2. local | Ollama (free, on your machine) | Real small models pick tools for generated prompts. |
| 3. cloud | API keys: Anthropic, OpenAI, Gemini, Groq, any OpenAI-compatible URL | Same eval on hosted models. |

Tier 1 finds *suspects*. Tier 2/3 *prove* it. The rewrite loop runs on 2 or 3.

## Architecture (TypeScript, Node 22)

```
src/
  cli.ts                 commander entry: lint | eval | tune | report
  mcp/connect.ts         stdio/HTTP client -> Tool[] (name, description, inputSchema)
  lint/structure.ts      deterministic rules (vague, missing use-when/not-for, params undocumented)
  lint/overlap.ts        local embeddings, pairwise similarity -> confusable pairs
  gen/prompts.ts         test-prompt generator: positives per tool + near-miss decoys, train/held-out split
  providers/types.ts     Provider { pick(tools, prompt): Promise<{tool|null, raw}> }
  providers/openai.ts    OpenAI-compatible (OpenAI, Gemini, Groq, Ollama, OpenRouter via baseURL)
  providers/anthropic.ts native Messages API
  eval/run.ts            repeat N times, per-model accuracy + confidence intervals
  tune/rewrite.ts        propose rewrites for weak tools ("use when X, not for Y")
  tune/accept.ts         keep rewrite only if train AND held-out improve and no other tool regresses
  report/                markdown + JSON + unified diff of descriptions
test/                    vitest; fixtures/confusing-server.ts is a deliberately bad MCP server
```

Key rules
- The model's tool call is recorded, never executed.
- Keys come from env vars only; never logged or written to reports.
- Before any paid run: print estimated calls + cost, require confirmation, enforce a hard cap.
- Held-out prompts are never shown to the rewriter (anti-overfitting).
- Every number in a report carries the model name and run count.

## Phases

1. Foundation: scaffold, MCP connect (stdio, HTTP, snapshot), `toolright list`. DONE
2. Tier 1: structure rules, lexical overlap (+ experimental embeddings), `toolright lint` with CI exit codes. DONE
3. Providers + eval: OpenAI-compatible + Anthropic adapters, prompt generator, `toolright gen`, `toolright eval`. DONE (tested against fake servers; NOT yet run against live APIs)
4. Tune loop: rewrite, validate-gated accept/reject, test-split report, diff. DONE (tested with a stand-in picker)
5. Launch: still TODO and needs API keys / Ollama:
   - run on 5-10 popular MCP servers and publish real before/after numbers
   - GIF demo, rename/verify domain + trademark, publish to npm
   - PRs upstream with measured improvements, then HN / r/mcp

## Risks to watch
- Generated prompts can be unrealistic -> human review step + saved prompt files.
- Small local models differ from frontier ones -> always label results by model.
- Naming/trademark: verify toolright domain and marks before public launch.
- Prior art exists (e.g. sujugithub/toolmetry); our edge is held-out validation, the free tiers, CI mode.
