import { anthropicProvider } from "./anthropic.js";
import { heuristicProvider } from "./heuristic.js";
import { openaiProvider } from "./openai.js";
import type { Provider } from "./types.js";

export type { Pick, Provider } from "./types.js";

interface Preset {
  baseUrl: string;
  keyEnv?: string;
  local?: boolean;
}

const PRESETS: Record<string, Preset> = {
  openai: { baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY" },
  ollama: { baseUrl: "http://localhost:11434/v1", local: true },
};

export const PROVIDER_NAMES = ["anthropic", ...Object.keys(PRESETS), "custom", "heuristic"];

/**
 * Create a provider from "provider:model", e.g. "groq:llama-3.3-70b-versatile",
 * "anthropic:<model id>", "ollama:qwen2.5:3b", "custom:<model>" (uses TOOLRIGHT_BASE_URL / TOOLRIGHT_API_KEY).
 * API keys come from environment variables only.
 */
export function createProvider(spec: string, env: NodeJS.ProcessEnv = process.env): Provider {
  const idx = spec.indexOf(":");
  const name = (idx === -1 ? spec : spec.slice(0, idx)).toLowerCase();
  const model = idx === -1 ? "" : spec.slice(idx + 1);

  if (name === "heuristic") return heuristicProvider();

  if (!model) throw new Error(`Model spec "${spec}" needs a model id, e.g. ${name}:<model>`);

  if (name === "anthropic") {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    return anthropicProvider({ id: spec, model, apiKey, baseUrl: env.ANTHROPIC_BASE_URL });
  }

  if (name === "custom") {
    const baseUrl = env.TOOLRIGHT_BASE_URL;
    if (!baseUrl) throw new Error("custom provider needs TOOLRIGHT_BASE_URL (and optionally TOOLRIGHT_API_KEY)");
    return openaiProvider({ id: spec, baseUrl, model, apiKey: env.TOOLRIGHT_API_KEY });
  }

  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Unknown provider "${name}". Available: ${PROVIDER_NAMES.join(", ")}`);
  }
  let apiKey: string | undefined;
  if (preset.keyEnv) {
    apiKey = env[preset.keyEnv];
    if (!apiKey) throw new Error(`${preset.keyEnv} is not set`);
  }
  const baseUrl = name === "ollama" && env.OLLAMA_HOST
    ? `${env.OLLAMA_HOST.replace(/\/+$/, "").replace(/^(?!https?:)/, "http://")}/v1`
    : preset.baseUrl;
  return openaiProvider({ id: spec, baseUrl, model, apiKey, local: preset.local });
}
