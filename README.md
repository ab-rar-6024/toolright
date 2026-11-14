<div align="center">
  <br />
  <h1>🎯 Toolright</h1>
  <p><strong>Does your AI agent pick the right tool?</strong></p>
  <p>Audit MCP tool descriptions for confusable look-alikes, measure accuracy with real models, and keep only the rewrites that help.</p>

  <br />

  <a href="https://www.npmjs.com/package/toolright"><img src="https://img.shields.io/npm/v/toolright?style=flat-square&label=npm&color=2563eb" alt="npm version" /></a>
  <a href="https://pypi.org/project/toolright/"><img src="https://img.shields.io/pypi/v/toolright?style=flat-square&label=pypi&color=3b82f6" alt="PyPI version" /></a>
  <a href="https://github.com/ab-rar-6024/toolright/actions"><img src="https://img.shields.io/github/actions/workflow/status/ab-rar-6024/toolright/ci.yml?style=flat-square&label=ci" alt="CI status" /></a>
  <a href="https://github.com/ab-rar-6024/toolright"><img src="https://img.shields.io/badge/tests-111%20passed-success?style=flat-square" alt="Tests" /></a>
  <a href="https://github.com/ab-rar-6024/toolright/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License" /></a>
  <a href="https://github.com/ab-rar-6024/toolright"><img src="https://img.shields.io/github/stars/ab-rar-6024/toolright?style=flat-square&color=eab308" alt="GitHub stars" /></a>

  <br />
  <br />

  <img src="assets/demo.svg" alt="Toolright Demo" width="100%" />

  <br />
  <br />

  <a href="#quick-start"><strong>Quick Start</strong></a> &nbsp;&middot;&nbsp;
  <a href="#why-toolright"><strong>Why Toolright?</strong></a> &nbsp;&middot;&nbsp;
  <a href="#live-results-so-far"><strong>Live Results</strong></a> &nbsp;&middot;&nbsp;
  <a href="#github-action-ci"><strong>GitHub Action</strong></a> &nbsp;&middot;&nbsp;
  <a href="#cli-commands"><strong>CLI Commands</strong></a> &nbsp;&middot;&nbsp;
  <a href="#contributing"><strong>Contributing</strong></a>

  <br />
  <br />
</div>

---

> **Status: v0.0.3, pre-release.** 111 automated tests pass (unit, real stdio and HTTP MCP transports, security, a fuzz run). **Tier 2 has been run live end-to-end with Ollama (`qwen2.5:3b`), and Tier 3 cloud provider testing has been verified live on Groq (`openai/gpt-oss-120b`).** Disambiguation tuning on synthetic and real servers demonstrates measured accuracy improvements on held-out test splits (see [Live results so far](#live-results-so-far)).

---

## Quick Start

### Prerequisites

- **Node.js** >= 20.0 ([download](https://nodejs.org/))
- **An MCP server** to audit (or an existing JSON snapshot from `toolright list --json`)
- *(Optional)* [Ollama](https://ollama.com) for Tier 2 local evaluations or an API key (Groq, Anthropic, OpenAI, Gemini) for Tier 3 cloud runs.

### 1. Install or Run Instant

Install globally via **npm** or **pip** (or run zero-install via `npx`):

```bash
# npm
npm install -g toolright

# or pip (Python launcher for the same CLI)
pip install toolright

# or zero-install
npx toolright <command>
```

### 2. Tier 1: Instant Audit (No API key, No model)

Catch confusable tool look-alikes, missing parameter docs, and pushy superlative claims instantly:

```bash
# Audit an MCP server command directly
toolright lint -- node server.js

# Or audit an exported tools snapshot
toolright lint --tools fixtures/company-tools.json
```

```text
8 tools checked (similarity: lexical, threshold 0.45)

Confusable pairs (most likely cause of wrong picks):
  warn   find_customer and lookup_customer look similar (62%) and nothing tells the agent when to use which.
  warn   close_item and resolve_item look similar (54%) and nothing tells the agent when to use which.
  warn   remove_member and deactivate_member look similar (51%) and nothing tells the agent when to use which.
  warn   send_alert and send_notice look similar (48%) and nothing tells the agent when to use which.
```

### 3. Tier 2 & 3: Measure Real Accuracy & Tune

Evaluate how models actually behave and automatically rewrite weak descriptions with held-out validation gating:

```bash
# Evaluate selection accuracy with real prompts
toolright eval --tools server-tools.json -m groq:openai/gpt-oss-120b

# Automatically tune weak descriptions with held-out safety gating
toolright tune --tools server-tools.json --rewriter groq:openai/gpt-oss-120b -m groq:openai/gpt-oss-120b
```

---

## Why Toolright?

When an LLM agent fails, the bug is often not in the model or the code—**it is in your tool descriptions**. 

Building MCP servers today leaves tool descriptions to human intuition:
- Two tools sound alike (`find_customer` vs `lookup_customer`), causing wrong selections.
- Superlatives ("always use this tool for search") cause greedy misroutes.
- No usage guidance tells the agent which tool beats another.

**Toolright treats tool descriptions as optimizable code:**

<table>
<tr>
<td width="33%" valign="top">

### ⚡ Tier 1: Lint
**Instant static analysis**
- No model, zero cost
- Detects lexical & semantic overlap
- Flags undocumented parameters & superlatives
- Runs in CI on every PR
</td>
<td width="33%" valign="top">

### 📊 Tier 2: Eval
**Empirical accuracy scoring**
- Tests with real or synthetic prompts
- Wilson 95% confidence intervals
- Reshuffles tool schemas per repeat
- Generates interactive HTML reports
</td>
<td width="33%" valign="top">

### 🎯 Tier 3: Tune
**Hold-out gated rewriting**
- Proposes disambiguation diffs
- Train / Validate / Test split gating
- **Non-regression guarantee**: rejects rewrites that harm other tools
- Generates Git-ready diffs
</td>
</tr>
</table>

---

## Live Results So Far

What real models did. Tested on local models (`qwen2.5:3b`), cloud frontier models (`openai/gpt-oss-120b` on Groq), and the official filesystem server.

| Run | Server / Fixture | Result |
|---|---|---|
| `eval`, `qwen2.5:3b`, 38 hand-written prompts x 1 | `fixtures/confusing-server.ts` (5 tools) | **95% correct (36/38, 95% CI 83-99%)**, 0 API errors. Both misses were inside the confusable pairs `lint` flagged (`list_issues` vs `search_issues`, `get_user` vs `find_user`). |
| `tune`, picker & rewriter `qwen2.5:3b`, 2 runs per prompt | `fixtures/company-server.ts` (8 tools in 4 confusable pairs) | **2 rewrites accepted, accuracy improved from 84% (27/32) to 91% (29/32, 95% CI 76-97%) on held-out test prompts.** Validation accuracy gained on `find_customer` (88% -> 91%) and `lookup_customer` (91% -> 97%). 2 candidates rejected (`remove_member`, `deactivate_member`). |
| `eval`, `groq:openai/gpt-oss-120b`, 64 prompts x 1 | `fixtures/company-server.ts` (8 tools in 4 confusable pairs) | **96% correct (49/51, 95% CI 87-99%)** via Groq cloud API. Correctly resolved 6 out of 8 tools with 100% accuracy. |
| `eval` & `tune`, `groq:openai/gpt-oss-120b`, 84 prompts | `@modelcontextprotocol/server-filesystem` (official 14 tools) | Baseline accuracy **60% (12/20)** on held-out test prompts with severe confusion on `read_file` vs `read_text_file`. A rewrite candidate for `read_text_file` improved validation accuracy (76% -> 78%) but was **rejected by the non-regression safety gate** because it caused regressions on `write_file`. |

### Key Learnings & Guarantees
- **Non-regression safety gate**: Candidate rewrites that increase accuracy overall are strictly rejected if they cause adjacent tools to regress.
- **Accurate failure mode detection**: With easy prompts where models achieve 100% baseline accuracy, Toolright detects lack of headroom and skips unnecessary rewrites.
- **The gate measures accuracy, not truth**: Read every proposed diff. Use a strong model for `--rewriter` to ensure descriptions stay factual.

---

## Features

### 1. Interactive HTML Visual Reports
`toolright eval` and `toolright tune` generate standalone, dark-mode visual reports (`report.html` and `eval.html`):
- Visual accuracy badges & Wilson confidence intervals
- Interactive per-tool progress bars
- Top confusable wrong-pick matrices
- Side-by-side diff viewers for accepted vs rejected rewrites

### 2. Mine Prompts from Real Logs (`ingest-logs`)
Don't rely only on synthetic prompts. Extract actual user prompts from OpenAI and Anthropic JSONL chat transcripts:
```bash
toolright ingest-logs production-transcripts.jsonl --tools tools.json -o real-prompts.json
```

### 3. Toolright as an MCP Server (`toolright serve`)
Expose Toolright directly to your AI coding agents (Claude Desktop, Cursor, Cline, Roo Code):
```bash
toolright serve
```
Provides the `lint_tools` tool so agents can audit and improve tool descriptions while building MCP servers.

---

## GitHub Action CI

Fail the build or automatically post PR comments when an MCP tool description is confusable, missing, or vague:

Create `.github/workflows/toolright.yml`:

```yaml
name: Toolright Audit
on: [pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ab-rar-6024/toolright@v0.0.3
        with:
          tools: "fixtures/company-tools.json"
          fail-on: "error"
          comment-on-pr: "true"
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

---

## CLI Commands

| Command | Description | Cost |
|---|---|---|
| `toolright list [server...]` | Print the tools an MCP server exposes | Free |
| `toolright lint [server...]` | Tier 1: Check for confusable pairs, superlatives, and schema gaps | Free |
| `toolright gen [server...]` | Generate direct & near-miss test prompts for human review | Model calls |
| `toolright eval [server...]` | Measure model selection accuracy across held-out splits | Model calls |
| `toolright tune [server...]` | Baseline, rewrite weak descriptions, and gate improvements | Model calls |
| `toolright ingest-logs <file>` | Extract evaluation prompts from real conversation transcripts | Free |
| `toolright serve` | Run Toolright as an MCP server over stdio | Free |

---

## Supported Providers

Specify any provider with `--model <provider>:<model-id>`:

| Provider | Model Spec Example | Environment Variable |
|---|---|---|
| **Ollama** (Local) | `-m ollama:qwen2.5:3b` | None required (`OLLAMA_HOST` optional) |
| **Groq** | `-m groq:openai/gpt-oss-120b` | `GROQ_API_KEY` |
| **Anthropic** | `-m anthropic:claude-3-5-sonnet-latest` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `-m openai:gpt-4o` | `OPENAI_API_KEY` |
| **Gemini** | `-m gemini:gemini-1.5-pro` | `GEMINI_API_KEY` |
| **Custom OpenAI-compatible** | `-m custom:<model>` | `TOOLRIGHT_BASE_URL` & `TOOLRIGHT_API_KEY` |
| **Heuristic** (Offline stand-in) | `-m heuristic` | Free / Offline keyword matcher |

---

## Security & Privacy

An MCP server is untrusted code, and so is model output. Toolright protects your development environment:
- **API Keys are scrubbed**: Never written to reports, never sent over unencrypted HTTP, and never passed to MCP server child processes.
- **Hostile server defenses**: Hard timeouts, tool count caps (max 500), and giant payload truncations prevent hanging the CLI.
- **Terminal safety**: Strips escape sequences and bidirectional Unicode overrides from names and descriptions.
- **Non-destructive**: Toolright proposes description diffs in `descriptions.diff`; it never modifies your server code directly.

See [SECURITY.md](SECURITY.md) for details.

---

## Roadmap

- [ ] Run on 5-10 popular MCP servers and publish before/after benchmarks (started: `@modelcontextprotocol/server-filesystem` tested)
- [x] Verify Tier 2 live with Ollama
- [x] Verify Tier 3 cloud providers live (verified with Groq)
- [x] GitHub Action (`action.yml`) with automated PR comments
- [x] Ship Toolright itself as an MCP server (`toolright serve` with `lint_tools`)
- [x] Prompts mined from real agent logs (`toolright ingest-logs`)
- [x] Standalone visual HTML reports (`report.html` and `eval.html`)
- [ ] PyPI automated release workflows on git tag push

---

## Contributing

We welcome contributions of all kinds! Start by running the test suite:

```bash
git clone https://github.com/ab-rar-6024/toolright.git
cd toolright
npm install
npm test          # 111 tests pass: unit, integration, security; no keys needed
npm run typecheck
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

Toolright is open-source software licensed under the [MIT License](LICENSE).

<div align="center">
  <sub>Built by <a href="https://github.com/ab-rar-6024">ab-rar-6024</a> and contributors.</sub>
</div>
