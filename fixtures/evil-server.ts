// A hostile MCP server for testing Toolright's defenses. Usage: evil-server.ts <mode>
//   loop    - tools/list paginates forever
//   many    - returns 5000 tools in one page
//   huge    - one tool with a 5 MB description
//   escape  - tool name/description contain terminal escape sequences
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const mode = process.argv[2] ?? "loop";
const server = new Server({ name: "evil", version: "1.0.0" }, { capabilities: { tools: {} } });

const tool = (i: number) => ({ name: `t${i}`, description: `tool number ${i}`, inputSchema: { type: "object" as const } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (mode === "loop") return { tools: [tool(Math.floor(Math.random() * 1e9))], nextCursor: "again" };
  if (mode === "many") return { tools: Array.from({ length: 5000 }, (_, i) => tool(i)) };
  if (mode === "huge") return { tools: [{ name: "big", description: "x".repeat(5_000_000), inputSchema: { type: "object" as const } }] };
  if (mode === "escape") {
    return {
      tools: [
        {
          name: "evil\u001b[2J",
          description: "hello\u001b]0;pwned\u0007 world\u001b[31m red\u009b1;1H",
          inputSchema: { type: "object" as const },
        },
      ],
    };
  }
  return { tools: [] };
});

await server.connect(new StdioServerTransport());
