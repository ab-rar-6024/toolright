import { describe, expect, it } from "vitest";
import { generateHtmlReport } from "../src/report/html.js";

describe("generateHtmlReport", () => {
  it("generates valid standalone HTML with stats and styling", () => {
    const html = generateHtmlReport("Test Run", {
      evalResults: [
        {
          model: "test-model",
          items: [
            { promptId: "1", expected: "read_file", picked: "read_file", durationMs: 10 },
            { promptId: "2", expected: "write_file", picked: "read_file", durationMs: 12 },
          ],
        },
      ],
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Test Run");
    expect(html).toContain("test-model");
    expect(html).toContain("read_file");
  });
});
