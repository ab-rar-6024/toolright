# toolright (Python launcher)

**Does your agent pick the right tool?** Test your MCP server's tool descriptions against real models, then keep only the rewrites that measurably help.

This package is a thin Python launcher for [Toolright](https://github.com/ab-rar-6024/toolright), which is a **Node.js** tool. It does not reimplement anything: `pip install toolright` gives you a `toolright` command that runs the npm package of the **same version** through `npx`.

**You need Node.js 20+** on your PATH (it provides `npx`).

```bash
pip install toolright

toolright lint -- python my_mcp_server.py       # Tier 1: no model, no API key
toolright eval -m ollama:qwen2.5:3b --prompts prompts.json -- python my_mcp_server.py
```

The first run downloads the pinned npm package once; later runs use npm's cache.

Full documentation, the three tiers, security model and limits: <https://github.com/ab-rar-6024/toolright>

Prefer Node directly? `npx toolright ...` or `npm install -g toolright`.

> Pre-release (0.0.1). Model-facing code has not yet been run against live provider APIs. See the main README for the honest status.
