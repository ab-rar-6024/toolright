import type { ToolInfo } from "../mcp/connect.js";
import { HttpError, assertSafeBaseUrl, postJson, redact } from "./http.js";
import { schemaProps } from "../util.js";
import { PICK_SYSTEM, makeNameMap, type Pick, type Provider } from "./types.js";

export interface OpenAIOptions {
  id: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  local?: boolean;
}

/**
 * Chat Completions client. Works with OpenAI and with any OpenAI-compatible
 * endpoint (Gemini, Groq, OpenRouter, Ollama, vLLM, LM Studio, ...).
 */
export function openaiProvider(o: OpenAIOptions): Provider {
  assertSafeBaseUrl(o.baseUrl, !!o.apiKey);
  const base = o.baseUrl.replace(/\/+$/, "");
  const scrub = (m: string) => redact(m, [o.apiKey]);
  const headers: Record<string, string> = o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {};

  async function chat(body: Record<string, unknown>, temperature: number | undefined): Promise<any> {
    const withTemp = temperature === undefined ? body : { ...body, temperature };
    try {
      return await postJson(`${base}/chat/completions`, headers, withTemp);
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) {
        // some servers don't support JSON mode: retry without it
        if ("response_format" in body && /response_format|json_object|json mode/i.test(e.body)) {
          const { response_format: _dropped, ...rest } = body;
          return chat(rest, temperature);
        }
        // some newer models only accept the default temperature
        if (temperature !== undefined && /temperature/i.test(e.body)) {
          return postJson(`${base}/chat/completions`, headers, body);
        }
      }
      throw e;
    }
  }

  return {
    id: o.id,
    local: o.local ?? false,

    async pick(tools: ToolInfo[], prompt: string): Promise<Pick> {
      const { toSafe, toReal } = makeNameMap(tools);
      try {
        const res = await chat(
          {
            model: o.model,
            messages: [
              { role: "system", content: PICK_SYSTEM },
              { role: "user", content: prompt },
            ],
            tools: tools.map((t) => ({
              type: "function",
              function: {
                name: toSafe.get(t.name),
                description: t.description,
                parameters: Object.keys(schemaProps(t.inputSchema)).length || t.inputSchema?.type ? t.inputSchema : { type: "object", properties: {} },
              },
            })),
            tool_choice: "auto",
          },
          0,
        );
        const call = res?.choices?.[0]?.message?.tool_calls?.[0];
        const name: string | undefined = call?.function?.name;
        return { tool: name ? (toReal.get(name) ?? name) : null };
      } catch (e) {
        return { tool: null, error: scrub(e instanceof Error ? e.message : String(e)) };
      }
    },

    async complete(system, user, opts = {}) {
      try {
        const res = await chat(
          {
            model: o.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
            ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          },
          opts.temperature ?? 0.7,
        );
        const text = res?.choices?.[0]?.message?.content;
        if (typeof text !== "string") throw new Error("model returned no text");
        return text;
      } catch (e) {
        throw new Error(scrub(e instanceof Error ? e.message : String(e)));
      }
    },
  };
}
