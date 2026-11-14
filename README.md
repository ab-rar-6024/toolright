<div align="center">

# Toolright

**Does your agent pick the right tool?**

Test your MCP server's tool descriptions against real models, then keep only the rewrites that measurably help.

[![CI](https://img.shields.io/github/actions/workflow/status/ab-rar-6024/toolright/ci.yml?style=flat-square&label=CI)](https://github.com/ab-rar-6024/toolright/actions)
[![npm](https://img.shields.io/npm/v/toolright?style=flat-square)](https://www.npmjs.com/package/toolright)
[![PyPI](https://img.shields.io/pypi/v/toolright?style=flat-square)](https://pypi.org/project/toolright/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square)](package.json)
[![Stars](https://img.shields.io/github/stars/ab-rar-6024/toolright?style=flat-square)](https://github.com/ab-rar-6024/toolright/stargazers)

[Install](#install) | [Quick Start](#quick-start) | [Why Toolright](#why-toolright) | [How It Works](#how-it-works) | [Commands](#commands) | [Security](#security) | [Contributing](#contributing)

</div>

---

> **Status: v0.0.3, pre-release.** 105 automated tests pass (unit, real stdio and HTTP MCP transports, security, a fuzz run). **Tier 2 has been run live end to end with Ollama (`qwen2.5:3b`), and Tier 3 cloud provider testing has been verified live on Groq (`openai/gpt-oss-120b`).** First live tune results on a synthetic stress-test server (`fixtures/company-server.ts`) demonstrated a measured gain from **84% to 91%** accuracy on held-out test prompts (see [Live results so far](#live-results-so-far)). Please report what breaks.

## Install

```bash
npm install -g toolright      # installs the `toolright` command
pip install toolright         # same command, via a thin Python launcher (needs Node.js 20+)
```

Or run it without installing: `npx toolright <command>`.

The pip package is only a launcher: Toolright is a Node.js tool, and `pip install toolright` runs the npm package of the same version through `npx`. See [`python/`](python).

| Prerequisite | Needed for |
|---|---|
| Node.js 20+ | Everything |
| An MCP server to check | Everything (or a saved snapshot, see `toolright list --json`) |
| [Ollama](https://ollama.com) | Tier 2 only (local models) |
| An API key for a cloud model | Tier 3 only |

## Quick Start

Tier 1 needs no key and no model.

```bash
# 1. See what your server exposes
toolright list -- node my-server.js

# 2. Find look-alike and vague tools in about a second
toolright lint -- node my-server.js

# 3. Measure real model behavior (local and free with Ollama, or any cloud model)
toolright gen  --generator ollama:qwen2.5:3b -o prompts.json -- node my-server.js
toolright eval -m ollama:qwen2.5:3b --prompts prompts.json -- node my-server.js
```

From a clone: `npm install && npm run dev -- lint -- node my-server.js`.

## Ecosystem

| Package | What it does | Install |
|---|---|---|
| [`toolright`](https://www.npmjs.com/package/toolright) (npm) | The CLI: lint, gen, eval, tune | `npm install -g toolright` |
| [`toolright`](https://pypi.org/project/toolright/) (PyPI) | Python launcher for the same CLI (needs Node.js 20+) | `pip install toolright` |

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

## Live results so far

What a real model did, so far. One local model (`qwen2.5:3b`), CPU only, tested against synthetic fixtures.

| Run | Fixture | Result |
|---|---|---|
| `eval`, `qwen2.5:3b`, 38 hand-written prompts x 1 | `fixtures/confusing-server.ts` (5 tools) | **95% correct (36/38, 95% CI 83-99%)**, 0 API errors. Both misses were inside the confusable pairs `lint` flagged (`list_issues` vs `search_issues`, `get_user` vs `find_user`). For comparison, the offline keyword stand-in scored 39%. |
| `tune`, picker & rewriter `qwen2.5:3b`, 3 runs per prompt | `fixtures/confusing-server.ts` (5 tools) | **0 rewrites accepted.** Held-out accuracy was already 100% (30/30) before and after: there was no headroom, so no rewrite could be shown to help. 456 model calls, 42 minutes. |
| `tune`, picker & rewriter `qwen2.5:3b`, 2 runs per prompt | `fixtures/company-server.ts` (8 tools in 4 confusable pairs) | **2 rewrites accepted, accuracy improved from 84% (27/32) to 91% (29/32, 95% CI 76-97%) on held-out test prompts.** Validation accuracy gained on `find_customer` (88% -> 91%) and `lookup_customer` (91% -> 97%). 2 candidates rejected (`remove_member`, `deactivate_member`). 550 model calls, 64 minutes. |
| `eval`, `groq:openai/gpt-oss-120b`, 64 prompts x 1 | `fixtures/company-server.ts` (8 tools in 4 confusable pairs) | **96% correct (49/51, 95% CI 87-99%)** via Groq cloud API. Correctly resolved 6 out of 8 tools with 100% accuracy. Misses were confusions between `resolve_item` vs `close_item` and `deactivate_member` vs `find_customer`. |

What we learned, and changed:

- **No headroom is a real outcome.** With easy prompts a model already gets nearly everything right, and `tune` correctly accepted nothing. It now detects this up front and skips the rewrite work (it spent about 30 of those 42 minutes on rewrites that could not have been accepted).
- **Harder ambiguous tool sets show measurable gains.** On `company-server.ts`, disambiguating ID lookup vs query search moved test accuracy up +7% without regressing other tools.
- **A 3B rewriter wrote wrong descriptions.** For example it told `search_issues` "Do not use for ... filtering by keyword; use list_issues", which inverts what that tool is for, and it told `find_user` "Do not use for actions like getting or listing issues". The gate rejected them (no gain), not because they were false. **The gate measures accuracy, not truth**, so read every accepted diff, and use a strong model as `--rewriter`.
- **A 3B model is a poor prompt writer.** It copied the example placeholder from our instructions and returned `"..."` for every prompt, which we fixed, and it still mislabels some near-miss prompts. Use a stronger `--generator` than the model under test.

While synthetic fixtures prove the tune loop works end-to-end, published results on real-world third-party MCP servers are still on the roadmap.

## Limits You Should Know

- **Generated prompts are a proxy**, not your real users. Read `prompts.json`, delete the bad ones, and add prompts from real logs if you can.
- **Use a stronger model to write prompts than the one you test.** In our first live run a 3B local model, asked to write test prompts, returned nothing usable for two tools and mislabeled some near-miss prompts (it wrote "list all issues" requests for the *search* tool). Toolright now warns per tool, prints prompts-per-tool, and refuses to evaluate a generated set that leaves a tool with fewer than 3 prompts. It cannot detect a mislabeled prompt, so read `prompts.json`.
- **Small prompt sets are noisy and the gate is strict.** Use more prompts (`--per-tool`) and `--repeats`.
- **Results differ by model.** A gain on a 3B local model is not a gain on a frontier model.
- **Rewrites are model-written.** Read each accepted description; it must be true of the tool.
- **Lexical overlap is a heuristic.** It finds tools that share vocabulary, not tools a model will confuse; `eval` is the real test. `--embeddings` is experimental and was noisy on very short descriptions.
- **Small servers may not need this.** Selection is usually fine with a handful of clearly different tools. It pays off with many tools or look-alike tools.
- The `heuristic` provider is a keyword matcher for trying the pipeline offline. **It is not a model**; never quote its numbers.

## Roadmap

- [ ] Run on 5-10 popular MCP servers and publish real before/after numbers
- [x] Verify Tier 2 live with Ollama
- [ ] Verify the cloud providers live (Anthropic, OpenAI, Gemini, Groq)
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
npm test          # 100 tests: unit, integration, security; no network or keys needed
npm run typecheck
npm run build
```

Good first contributions: more lint rules, a new provider adapter, and results from your own server (please share the `report.md`).

## License

MIT. See [LICENSE](LICENSE).
