import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { lint } from "./lint/index.js";
import { normalizeTool, type ToolInfo } from "./mcp/connect.js";
import { VERSION } from "./version.js";

/**
 * Start Toolright as an MCP server over stdio.
 * Allows agents (Claude Desktop, Cursor, etc.) to audit tool descriptions.
 */
export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "toolright", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "lint_tools",
          description:
            "Audit MCP tool descriptions for confusable look-alikes, missing usage guidance, superlative claims, and undocumented parameters. Returns findings and confusable pairs.",
          inputSchema: {
            type: "object",
            properties: {
              tools: {
                type: "array",
                description: "Array of tools to lint (each with 'name' and 'description').",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    inputSchema: { type: "object" },
                  },
                  required: ["name", "description"],
                },
              },
              threshold: {
                type: "number",
                description: "Similarity threshold (0 to 1) above which tools count as confusable. Defaults to 0.45.",
              },
            },
            required: ["tools"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "lint_tools") {
      const rawTools = (request.params.arguments as any)?.tools;
      const threshold = (request.params.arguments as any)?.threshold;

      if (!Array.isArray(rawTools)) {
        return {
          content: [{ type: "text", text: "Error: 'tools' parameter must be an array." }],
          isError: true,
        };
      }

      const tools: ToolInfo[] = rawTools.map((t) => normalizeTool(t ?? {}));
      const result = await lint(tools, { threshold });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
