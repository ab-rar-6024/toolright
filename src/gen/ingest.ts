import { readFile } from "node:fs/promises";
import type { TestPrompt } from "./prompts.js";
import { hashString } from "../util.js";

export interface IngestOptions {
  split?: boolean;
}

/**
 * Ingest real agent conversation transcripts from JSONL / JSON files.
 * Supports OpenAI messages format, Anthropic messages format, and generic JSONL transcripts.
 * Extracts the user prompt immediately preceding a tool call.
 */
export async function ingestLogs(
  filePath: string,
  allowedToolNames?: string[] | Set<string>,
  opts: IngestOptions = {},
): Promise<TestPrompt[]> {
  const content = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  const allowed = allowedToolNames ? new Set(allowedToolNames) : null;
  const prompts: TestPrompt[] = [];
  const seenTexts = new Set<string>();

  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    // Standard transcript or message thread format
    const messages: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.messages)
        ? parsed.messages
        : [parsed];

    let lastUserText: string | null = null;

    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;

      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          lastUserText = msg.content.trim();
        } else if (Array.isArray(msg.content)) {
          const textPart = msg.content.find((p: any) => p && p.type === "text" && typeof p.text === "string");
          lastUserText = textPart ? textPart.text.trim() : null;
        }
      } else if (msg.role === "assistant" && lastUserText) {
        // Check for OpenAI tool_calls
        if (Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            const toolName = tc?.function?.name;
            if (toolName && (!allowed || allowed.has(toolName))) {
              if (!seenTexts.has(lastUserText)) {
                seenTexts.add(lastUserText);
                prompts.push({
                  id: `${toolName}#${hashString(lastUserText).toString(36)}`,
                  text: lastUserText,
                  expected: toolName,
                  kind: "direct",
                  split: "train",
                });
              }
            }
          }
        }

        // Check for Anthropic tool_use content blocks
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block?.type === "tool_use" && block.name) {
              const toolName = block.name;
              if (!allowed || allowed.has(toolName)) {
                if (!seenTexts.has(lastUserText)) {
                  seenTexts.add(lastUserText);
                  prompts.push({
                    id: `${toolName}#${hashString(lastUserText).toString(36)}`,
                    text: lastUserText,
                    expected: toolName,
                    kind: "direct",
                    split: "train",
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return prompts;
}
