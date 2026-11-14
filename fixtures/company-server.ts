// A SYNTHETIC test server with the kind of ambiguity real servers have: four pairs of tools whose
// names do not say how they differ, and descriptions too terse to say it either.
//
// The TRUE behavior of each tool is documented below. It is NOT visible to a model (only the name
// and the one-line description are), which is exactly the situation Toolright is meant to fix.
//
//   close_item         Administratively closes an item WITHOUT doing the work: won't fix, duplicate,
//                      obsolete, out of scope, cancelled.
//   resolve_item       Marks an item as done BECAUSE the work was completed: fixed, shipped, finished.
//
//   remove_member      PERMANENTLY deletes the member account and all their data. Irreversible.
//   deactivate_member  Suspends the member's access but KEEPS their data. Reversible.
//
//   find_customer      FUZZY search by name, email, phone or company: returns a list of matches.
//   lookup_customer    EXACT fetch of one customer record by customer ID.
//
//   send_alert         URGENT page to the on-call team. Use for outages and emergencies.
//   send_notice        NON-urgent announcement or reminder to everyone.
//
// A prompt's correct tool in fixtures/company-prompts.json is decided by these behaviors.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "company-server", version: "1.0.0" });
const ok = async () => ({ content: [{ type: "text" as const, text: "ok" }] });

const tools: Array<[string, string, Record<string, z.ZodTypeAny>]> = [
  ["close_item", "Closes an item.", { id: z.string() }],
  ["resolve_item", "Resolves an item.", { id: z.string() }],
  ["remove_member", "Removes a member.", { id: z.string() }],
  ["deactivate_member", "Deactivates a member.", { id: z.string() }],
  ["find_customer", "Finds a customer.", { query: z.string() }],
  ["lookup_customer", "Looks up a customer.", { id: z.string() }],
  ["send_alert", "Sends an alert.", { message: z.string() }],
  ["send_notice", "Sends a notice.", { message: z.string() }],
];

for (const [name, description, inputSchema] of tools) {
  server.registerTool(name, { description, inputSchema }, ok);
}

await server.connect(new StdioServerTransport());
