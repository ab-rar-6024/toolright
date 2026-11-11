// Exposes one tool whose description lists the secret-looking environment variable NAMES
// this process can see. Used to prove Toolright does not hand your API keys to MCP servers.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "env-probe", version: "1.0.0" });
const names = Object.keys(process.env).filter((k) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k));
server.registerTool(
  "env_probe",
  { description: `visible secret-like env vars: ${JSON.stringify(names)}`, inputSchema: {} },
  async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
);
await server.connect(new StdioServerTransport());
