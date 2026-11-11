# Security

## Threat model

Toolright connects to MCP servers and to model APIs, and it handles API keys.

| Input | Trusted? | What we do |
|---|---|---|
| MCP server output (tool names, descriptions, schemas) | No | Timeouts, size/count/page caps, control-character stripping, never executed |
| Model output (generated prompts, rewrites) | No | Parsed as JSON only, length-checked, sanitized, only ever written to a diff for human review |
| Provider error bodies | No | Keys and bearer tokens scrubbed before display or storage |
| The server command you pass after `--` | Yes (it is your command) | Runs with your privileges, as your MCP client would |
| Your API keys | Secret | Env vars only; not passed to MCP servers; refused over plain http to non-local hosts; redirects refused |

## Known limits

- Scrubbing removes the exact key and `Bearer ...` tokens. A provider that returns a *transformed* version of your key (for example base64) in an error would not be caught.
- A rewritten description is model-written text. Toolright rejects empty, tiny, overlong, or prompt-copying rewrites, but it cannot judge whether a description is *true*. Review every accepted diff.
- Sending tool descriptions to a cloud model discloses them to that provider.
- This has not had an independent security audit.

## Reporting

Please open a private security advisory on the GitHub repository rather than a public issue.
