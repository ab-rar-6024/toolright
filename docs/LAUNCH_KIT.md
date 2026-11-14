# Launch Kit & Promotion Templates for Toolright

This folder contains pre-written, high-impact launch posts ready to publish across developer communities.

---

## 1. Hacker News ("Show HN")

**Submit URL:** https://news.ycombinator.com/submit  
**Title:** `Show HN: Toolright – Audit and optimize MCP tool descriptions with real LLMs`  
**URL:** `https://github.com/ab-rar-6024/toolright`  

### First Comment (paste immediately after submitting):

> Hey HN!
> 
> When an AI agent picks the wrong tool, the failure often isn't because the model is dumb—it's because your tool descriptions are ambiguous. Two tools sound alike (e.g. `find_customer` vs `lookup_customer`), pushy superlatives ("always use this") cause misrouting, or tools lack "use when / not for" boundary guidance.
> 
> We built **Toolright** (https://github.com/ab-rar-6024/toolright) to treat MCP tool descriptions as optimizable code.
> 
> How it works:
> 
> 1. **Tier 1: Static Lint (Instant, Zero Cost)**: Run `npx toolright lint -- node server.js` to catch confusable pairs (lexical & semantic overlap), undocumented parameters, and pushy superlatives without needing any API key.
> 2. **Tier 2: Empirical Evaluation**: Tests your tools with real prompts (or mined from conversation logs with `toolright ingest-logs`) against real models (Ollama, Groq, OpenAI, Anthropic), reporting Wilson 95% confidence intervals and an interactive dark-mode HTML report.
> 3. **Tier 3: Safety-Gated Tuning**: Automatically proposes disambiguation rewrites. A rewrite is ONLY kept if it improves accuracy on held-out test splits without regressing any other tool.
> 
> We recently tested it against local models (`qwen2.5:3b`) and cloud models (`openai/gpt-oss-120b` on Groq), improving test accuracy on ambiguous fixtures from 84% to 91% with zero regressions.
> 
> It's open-source (MIT), zero-install via `npx toolright`, and can even run as an MCP server itself (`toolright serve`).
> 
> Would love your feedback on the lint rules and evaluation gating!

---

## 2. Reddit: r/LocalLLaMA

**Title:** `I built an open-source tool to benchmark and auto-tune MCP tool descriptions using local Ollama models (with zero cloud dependencies)`  
**Target:** https://reddit.com/r/LocalLLaMA  

> Hey r/LocalLLaMA!
> 
> One of the biggest friction points when building local agent stacks (Ollama + Open WebUI / Cursor / Claude Desktop) is tool selection errors: local models frequently get confused when two MCP tools have similar descriptions (e.g., `list_directory` vs `list_directory_with_sizes` or `search_item` vs `get_item`).
> 
> I built **Toolright** (https://github.com/ab-rar-6024/toolright), an MIT open-source CLI that helps you audit and fix this locally.
> 
> Highlights:
> - **Works 100% locally with Ollama**: run `toolright eval --tools tools.json -m ollama:qwen2.5:3b` to measure tool accuracy.
> - **Held-out validation gating**: `toolright tune` rewrites weak tool descriptions and tests candidates on held-out splits. If a candidate causes regressions on another tool, it's rejected.
> - **Tier 1 Static Lint**: Instant check for confusable tool pairs and missing parameters without making any model calls.
> - **Visual HTML report**: Generates standalone dark-mode reports (`report.html`) with per-tool accuracy graphs and diff viewers.
> 
> Zero-install: `npx toolright lint --tools my-tools.json`  
> GitHub: https://github.com/ab-rar-6024/toolright
> 
> Check it out and let me know what local models you're using for MCP agents!

---

## 3. Twitter / X Thread

**Post 1:**
> Most AI agent failures aren't model bugs—they're description bugs in your MCP server.
> 
> When two tools look similar (`find_customer` vs `lookup_customer`), models fail to route properly.
> 
> Introducing Toolright: Test & optimize your MCP tool descriptions with real models.
> 
> 🧵👇

**Post 2:**
> 1/ Static Lint (Instant & Free)
> 
> Run `npx toolright lint -- node server.js` to catch confusable tool pairs, superlatives, and undocumented parameters in seconds.
> 
> Zero API keys or tokens needed.

**Post 3:**
> 2/ Empirical Tuning with Safety Gates
> 
> `toolright tune` generates test prompts, measures baseline accuracy, and proposes disambiguating rewrites.
> 
> It guarantees non-regression: if a rewrite helps one tool but harms another, it's rejected.

**Post 4:**
> 3/ Modern Reports & CI
> 
> 📊 Standalone visual HTML reports (`report.html`)  
> 🤖 Run as an MCP server itself (`toolright serve`)  
> 🔄 Automated GitHub Action PR comments (`action.yml`)  
> 
> Star & try it: https://github.com/ab-rar-6024/toolright

---

## 4. Anthropic Discord (#mcp / #dev-showcase)

> Hey everyone! 👋
> 
> Sharing an open-source tool we built for the MCP community: **Toolright** (https://github.com/ab-rar-6024/toolright).
> 
> It audits MCP tool descriptions for look-alike ambiguities and automatically rewrites them with non-regression verification using Claude, Groq, or local Ollama models.
> 
> You can also use it in your CI pipeline via GitHub Actions to comment on PRs whenever someone modifies tool descriptions:
> 
> ```yaml
> - uses: ab-rar-6024/toolright@v0.0.3
>   with:
>     tools: "tools.json"
>     comment-on-pr: "true"
> ```
> 
> Feedback and contributions welcome!
