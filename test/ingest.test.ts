import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestLogs } from "../src/gen/ingest.js";

describe("ingestLogs", () => {
  it("extracts user prompts and expected tool calls from OpenAI format transcripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-test-"));
    try {
      const file = join(dir, "transcripts.jsonl");
      const record1 = {
        messages: [
          { role: "user", content: "Can you read file config.json for me?" },
          { role: "assistant", tool_calls: [{ function: { name: "read_file", arguments: "{}" } }] },
        ],
      };
      const record2 = {
        messages: [
          { role: "user", content: "Delete user 42 from the system" },
          { role: "assistant", tool_calls: [{ function: { name: "remove_member", arguments: "{}" } }] },
        ],
      };
      await writeFile(file, JSON.stringify(record1) + "\n" + JSON.stringify(record2) + "\n", "utf8");

      const prompts = await ingestLogs(file, ["read_file", "remove_member"]);
      expect(prompts).toHaveLength(2);
      expect(prompts[0]?.expected).toBe("read_file");
      expect(prompts[0]?.text).toBe("Can you read file config.json for me?");
      expect(prompts[1]?.expected).toBe("remove_member");
      expect(prompts[1]?.text).toBe("Delete user 42 from the system");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("extracts prompts from Anthropic content blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ingest-anthropic-"));
    try {
      const file = join(dir, "anthropic.jsonl");
      const record = {
        messages: [
          { role: "user", content: [{ type: "text", text: "Please list the files in current dir" }] },
          { role: "assistant", content: [{ type: "tool_use", name: "list_directory", input: {} }] },
        ],
      };
      await writeFile(file, JSON.stringify(record) + "\n", "utf8");

      const prompts = await ingestLogs(file);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]?.expected).toBe("list_directory");
      expect(prompts[0]?.text).toBe("Please list the files in current dir");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
