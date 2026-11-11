// A deliberately badly described MCP server, used to test Toolright.
// Tool pairs overlap on purpose: (search_issues, list_issues), (get_user, find_user).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "confusing-server", version: "0.0.1" });

const ok = async () => ({ content: [{ type: "text" as const, text: "ok" }] });

server.registerTool(
  "search_issues",
  { description: "Search issues.", inputSchema: { query: z.string() } },
  ok,
);
server.registerTool(
  "list_issues",
  { description: "List issues.", inputSchema: { repo: z.string() } },
  ok,
);
server.registerTool(
  "get_user",
  { description: "Gets a user.", inputSchema: { id: z.string() } },
  ok,
);
server.registerTool(
  "find_user",
  { description: "Finds a user.", inputSchema: { name: z.string() } },
  ok,
);
server.registerTool(
  "create_issue",
  {
    description:
      "Create a new issue in a repository. Use when the user wants to report a bug or request a feature. Not for commenting on an existing issue.",
    inputSchema: {
      repo: z.string().describe("Repository in owner/name form"),
      title: z.string().describe("Short issue title"),
    },
  },
  ok,
);

await server.connect(new StdioServerTransport());
