# Fixtures

Test data for Toolright. **All of it is synthetic.** None of it is a claim about how real MCP servers behave.

| File | What it is |
|---|---|
| `confusing-server.ts`, `confusing-tools.json`, `prompts.json` | A small, badly described server (5 tools) with easy prompts. A 3B local model already scores about 95% on it, so it leaves little headroom for `tune`. Good for smoke tests. |
| `company-server.ts`, `company-tools.json`, `company-prompts.json` | A harder server (8 tools in 4 confusable pairs) with deliberately terse descriptions. Its **true behavior is documented in comments at the top of `company-server.ts`** and is not visible to a model. Prompts are labeled against that documented behavior. |
| `evil-server.ts` | A hostile server (endless pagination, thousands of tools, a 5 MB description, terminal escape codes) used by the security tests. |
| `env-probe-server.ts` | Proves your API keys are not passed to the server process. |

## About the company fixture

It was built so the *difference between tools is not recoverable from the names or the one-line descriptions*, which is the situation Toolright targets. That makes it a fair stress test of the tune loop, but it is still a constructed benchmark: the hidden behavior was written by us, and the prompts were written by us to match it. Do not read results on it as evidence about real servers. Real before/after results on real servers are still on the roadmap.
