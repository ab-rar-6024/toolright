<div align="center">

# Toolright

**Does your agent pick the right tool?**

Test your MCP server's tool descriptions against real models, then keep only the rewrites that measurably help.

[![CI](https://img.shields.io/github/actions/workflow/status/ab-rar-6024/toolright/ci.yml?style=flat-square&label=CI)](https://github.com/ab-rar-6024/toolright/actions)
[![npm](https://img.shields.io/npm/v/toolright?style=flat-square)](https://www.npmjs.com/package/toolright)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![Stars](https://img.shields.io/github/stars/ab-rar-6024/toolright?style=flat-square)](https://github.com/ab-rar-6024/toolright/stargazers)

[Quick Start](#quick-start) | [Why Toolright](#why-toolright) | [How It Works](#how-it-works) | [Commands](#commands) | [Security](#security) | [Contributing](#contributing)

</div>

<!-- The npm badge shows "not found" until the package is published. -->

---

> **Status: v0.0.1, pre-release.** 68 automated tests pass (unit, real stdio and HTTP MCP transports, security, a fuzz run), but everything that talks to a model was tested against **fake OpenAI/Anthropic-compatible servers and a stand-in picker**. It has **not yet been run against live Anthropic, OpenAI, Gemini, Groq or Ollama endpoints**, and there are **no published before/after results on real MCP servers yet**. Please report what breaks.

## Quick Start

Prerequisites: Node.js 20+ and an MCP server to check. Tier 1 needs nothing else.

```bash
# 1. See what your server exposes
npx toolright list -- node my-server.js

# 2. Find look-alike and vague tools in about a second. No model, no API key.
npx toolright lint -- node my-server.js

# 3. Measure real model behavior (local and free with Ollama, or any cloud model)
npx toolright gen  --generator ollama:qwen2.5:3b -o prompts.json -- node my-server.js
npx toolright eval -m ollama:qwen2.5:3b --prompts prompts.json -- node my-server.js
```

From a clone: `npm install && npm run dev -- lint -- node my-server.js`.

## Why Toolright

An agent chooses which tool to call by reading only each tool's name and description. If two descriptions overlap, or one is vague, it picks the wrong tool, and **nothing errors**: the task just fails or takes extra steps.

- **Measures, not guesses.** A rubric score tells you a description is "62/100". Toolright tells you "correct picks went from 7/10 to 9/10 on held-out prompts, on these models."
- **Free to start.** Tier 1 needs no key. Tier 2 runs local models through Ollama and sends nothing anywhere.
- **Rewrites must earn their place.** A candidate is accepted only if it improves a validation split without making any other tool worse. The reported numbers come from a third split that no decision used.
- **Built for CI.** `toolright lint --fail-on warn` exits non-zero when a description regresses.
- **Per-model results.** Every number carries its model name, run count and a 95% confidence interval.
- **Safe by default.** Keys are scrubbed and never saved. MCP servers are treated as untrusted input. See [Security](#security).

## See It in Action

A deliberately badly described server (`fixtures/confusing-server.ts`), checked with no model and no key:

```text
$ toolright lint --tools fixtures/confusing-tools.json

5 tools checked (similarity: lexical, threshold 0.45)

Confusable pairs (most likely cause of wrong picks):
  warn   search_issues and list_issues look similar (50%) and nothing tells the agent when to use which. Likely source of wrong picks.
  warn   get_user and find_user look similar (50%) and nothing tells the agent when to use which. Likely source of wrong picks.

search_issues
  warn   too-short: Description is only 14 characters ("Search issues."). Say what it does, what it returns, and when to use it.
  warn   no-usage-guidance: No "use when / not for" guidance, so the agent can't tell when this tool beats a similar one.
  warn   undocumented-params: Parameter without description: query.
...
0 errors, 14 warnings, 0 notes
```

The well-described `create_issue` in the same server produces no findings. Then `toolright tune` proposes rewrites such as "Full-text search of issues by keyword... Not for listing everything; use `list_issues`", re-runs the tests, and writes `report.md`, `report.json`, `descriptions.diff` and `prompts.json`.

## How It Works

Three tiers share one pipeline. They differ only in what judges the tool choice.

| Tier | Command | Needs | What you get |
|---|---|---|---|
| 1. Lint | `toolright lint` | nothing | Instant checks and a list of look-alike tool pairs. CI-friendly. |
| 2. Local | `toolright eval -m ollama:<model>` | [Ollama](https://ollama.com), free | Real (small) models pick tools for generated prompts. Nothing leaves your machine. |
| 3. Cloud | `toolright eval -m groq:<model> -m anthropic:<model>` | API keys | The same test on hosted models. |

`toolright tune` runs the rewrite loop on top of tier 2 or 3:

1. **Generate** prompts per tool, including near-miss prompts aimed at its look-alikes, and split them into train / validate / test. Review `prompts.json`.
2. **Baseline** accuracy per model. Each prompt runs several times with the tool order reshuffled (identically before and after, so the comparison is paired).
3. **Rewrite** weak tools. The rewriter sees failures from **train only**.
4. **Gate** each candidate: it must improve **validate**, not hurt train, and not regress any tool.
5. **Report** before/after on the **test** split, per model, as a diff you review and apply yourself.

## Commands

| Command | Purpose |
|---|---|
| `toolright list` | Print the tools a server exposes (`--json` for a snapshot). |
| `toolright lint` | Tier 1 checks. `--fail-on error\|warn\|info\|none`, `--json`, `--threshold`, `--embeddings` (experimental). |
| `toolright gen` | Generate test prompts with a model and save them for review. |
| `toolright eval` | Measure per-model accuracy. |
| `toolright tune` | Baseline, rewrite weak descriptions, keep only measured improvements. |

Connect with a command after `--` (stdio), `--url <endpoint>` (streamable HTTP, with `--header 'Authorization: Bearer ${TOKEN}'`), or `--tools snapshot.json`.

## Models and Keys

Models are `provider:model`. Keys come from environment variables only.

| Provider | Spec | Key |
|---|---|---|
| Anthropic | `anthropic:<model>` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai:<model>` | `OPENAI_API_KEY` |
| Gemini | `gemini:<model>` | `GEMINI_API_KEY` |
| Groq | `groq:<model>` | `GROQ_API_KEY` |
| OpenRouter | `openrouter:<model>` | `OPENROUTER_API_KEY` |
| Ollama (local) | `ollama:<model>` | none (`OLLAMA_HOST` optional) |
| Any OpenAI-compatible URL | `custom:<model>` | `TOOLRIGHT_BASE_URL`, optional `TOOLRIGHT_API_KEY` |

Gemini, Groq, OpenRouter and Ollama are reached through their OpenAI-compatible endpoints. Model ids are yours to choose; none are hardcoded.

## Security

An MCP server is untrusted input, and so is whatever a model returns. Each item below has a test in `test/security.test.ts`.

- **API keys** are scrubbed from every error message, never written to reports or logs, never sent over plain `http://` to a non-local host, and never forwarded by a redirect (redirects are refused).
- **Your keys aren't handed to MCP servers.** The server subprocess gets a minimal default environment.
- **Hostile servers** hit a timeout, a page cap, a 500-tool cap and a description size cap, so endless pagination or a giant payload can't hang the CLI.
- **Terminal safety:** control characters and bidirectional overrides are stripped from tool names and descriptions.
- **Prompt injection:** tool text reaches the rewriter inside delimited, untrusted-data blocks, and a rewrite is only ever proposed as a diff. Toolright never edits your server.
- **Cost gate:** you confirm planned calls before anything is sent, a one-call preflight catches bad keys early, and `--max-calls` is a hard cap.

Running a server command executes it with your privileges, as your MCP client would. See [SECURITY.md](SECURITY.md).

## Limits You Should Know

- **Generated prompts are a proxy**, not your real users. Read `prompts.json`, delete the bad ones, and add prompts from real logs if you can.
- **Small prompt sets are noisy and the gate is strict.** Use more prompts (`--per-tool`) and `--repeats`.
- **Results differ by model.** A gain on a 3B local model is not a gain on a frontier model.
- **Rewrites are model-written.** Read each accepted description; it must be true of the tool.
- **Lexical overlap is a heuristic.** It finds tools that share vocabulary, not tools a model will confuse; `eval` is the real test. `--embeddings` is experimental and was noisy on very short descriptions.
- **Small servers may not need this.** Selection is usually fine with a handful of clearly different tools. It pays off with many tools or look-alike tools.
- The `heuristic` provider is a keyword matcher for trying the pipeline offline. **It is not a model**; never quote its numbers.

## Roadmap

- [ ] Run on 5-10 popular MCP servers and publish real before/after numbers
- [ ] Verify against live Anthropic, OpenAI, Gemini, Groq and Ollama endpoints
- [ ] GitHub Action with a PR comment showing the description diff
- [ ] Ship Toolright itself as an MCP server (`audit_tools`)
- [ ] Prompts mined from real agent logs

## Documentation

| Resource | |
|---|---|
| [PLAN.md](PLAN.md) | Architecture and design decisions |
| [SECURITY.md](SECURITY.md) | Threat model and known limits |
| `fixtures/` | A deliberately bad MCP server, a hostile one, and sample prompts |

## Contributing

Issues and pull requests are welcome. Start with a failing test that shows the problem:

```bash
npm install
npm test          # 68 tests: unit, integration, security; no network or keys needed
npm run typecheck
npm run build
```

Good first contributions: more lint rules, a new provider adapter, and results from your own server (please share the `report.md`).

## License

MIT. See [LICENSE](LICENSE).
