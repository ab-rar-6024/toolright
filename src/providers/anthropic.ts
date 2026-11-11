import type { ToolInfo } from "../mcp/connect.js";
import { HttpError, assertSafeBaseUrl, postJson, redact } from "./http.js";
import { schemaProps } from "../util.js";
import { PICK_SYSTEM, makeNameMap, type Pick, type Provider } from "./types.js";

export interface AnthropicOptions {
  id: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/** Native Anthropic Messages API client. */
export function anthropicProvider(o: AnthropicOptions): Provider {
  assertSafeBaseUrl(o.baseUrl ?? "https://api.anthropic.com", !!o.apiKey);
  const base = (o.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const scrub = (m: string) => redact(m, [o.apiKey]);
  const headers = { "x-api-key": o.apiKey, "anthropic-version": "2023-06-01" };

  async function messages(body: Record<string, unknown>, temperature: number | undefined): Promise<any> {
    const withTemp = temperature === undefined ? body : { ...body, temperature };
    try {
      return await postJson(`${base}/v1/messages`, headers, withTemp);
    } catch (e) {
      if (temperature !== undefined && e instanceof HttpError && e.status === 400 && /temperature/i.test(e.body)) {
        return postJson(`${base}/v1/messages`, headers, body);
      }
      throw e;
    }
  }

  return {
    id: o.id,
    local: false,

    async pick(tools: ToolInfo[], prompt: string): Promise<Pick> {
      const { toSafe, toReal } = makeNameMap(tools);
      try {
        const res = await messages(
          {
            model: o.model,
            max_tokens: 512,
            system: PICK_SYSTEM,
            messages: [{ role: "user", content: prompt }],
            tools: tools.map((t) => ({
              name: toSafe.get(t.name),
              description: t.description,
              input_schema: Object.keys(t.inputSchema).length ? t.inputSchema : { type: "object", properties: {} },
            })),
            tool_choice: { type: "auto" },
          },
          0,
        );
        const block = (res?.content ?? []).find((b: any) => b?.type === "tool_use");
        const name: string | undefined = block?.name;
        return { tool: name ? (toReal.get(name) ?? name) : null };
      } catch (e) {
        return { tool: null, error: scrub(e instanceof Error ? e.message : String(e)) };
      }
    },

    async complete(system, user, opts = {}) {
      try {
        const res = await messages(
          {
            model: o.model,
            max_tokens: opts.maxTokens ?? 2048,
            system,
            messages: [{ role: "user", content: user }],
          },
          opts.temperature ?? 0.7,
        );
        const text = (res?.content ?? [])
          .filter((b: any) => b?.type === "text")
          .map((b: any) => b.text)
          .join("");
        if (!text) throw new Error("model returned no text");
        return text;
      } catch (e) {
        throw new Error(scrub(e instanceof Error ? e.message : String(e)));
      }
    },
  };
}
