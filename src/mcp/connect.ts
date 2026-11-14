import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sanitize } from "../util.js";

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** An MCP server is untrusted input. These caps stop a hostile or buggy one from hanging us or eating memory. */
export const LIMITS = {
  maxTools: 500,
  maxPages: 50,
  maxDescriptionChars: 20_000,
  maxSchemaChars: 100_000,
  defaultTimeoutMs: 30_000,
};

export interface LoadOptions {
  timeoutMs?: number;
  maxTools?: number;
}

/** Clean one tool: strip terminal-control characters, cap sizes. Applied to every source. */
export function normalizeTool(raw: { name?: unknown; description?: unknown; inputSchema?: unknown; input_schema?: unknown }): ToolInfo {
  let description = sanitize(typeof raw.description === "string" ? raw.description : "");
  if (description.length > LIMITS.maxDescriptionChars) description = description.slice(0, LIMITS.maxDescriptionChars) + " ...[truncated by toolright]";
  let schema = (raw.inputSchema ?? raw.input_schema ?? {}) as Record<string, unknown>;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) schema = {};
  if (JSON.stringify(schema).length > LIMITS.maxSchemaChars) schema = { type: "object", properties: {} };
  return { name: sanitize(String(raw.name ?? "")), description, inputSchema: schema };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms ${what}`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function readAllTools(client: Client, opts: LoadOptions): Promise<ToolInfo[]> {
  const timeoutMs = opts.timeoutMs ?? LIMITS.defaultTimeoutMs;
  const maxTools = opts.maxTools ?? LIMITS.maxTools;
  const tools: ToolInfo[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    if (++pages > LIMITS.maxPages) {
      throw new Error(`Server returned more than ${LIMITS.maxPages} pages of tools; refusing to continue (endless pagination?).`);
    }
    const page = await withTimeout(client.listTools(cursor ? { cursor } : undefined), timeoutMs, "waiting for the tool list");
    for (const t of page.tools) tools.push(normalizeTool(t));
    if (tools.length > maxTools) {
      throw new Error(`Server exposes too many tools (more than ${maxTools}). Pass a smaller server, or raise the limit.`);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

async function connectAndList(client: Client, transport: Parameters<Client["connect"]>[0], opts: LoadOptions): Promise<ToolInfo[]> {
  const timeoutMs = opts.timeoutMs ?? LIMITS.defaultTimeoutMs;
  try {
    await withTimeout(client.connect(transport), timeoutMs, "connecting to the MCP server");
    return await readAllTools(client, opts);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Spawn an MCP server over stdio and return its tools.
 * Only tools/list is requested; no tool is ever called. The child gets the SDK's minimal
 * default environment, so your API keys are not passed to it.
 */
export async function listTools(command: string, args: string[], opts: LoadOptions = {}): Promise<ToolInfo[]> {
  const transport = new StdioClientTransport({ command, args, stderr: "ignore" });
  return connectAndList(new Client({ name: "toolright", version: "0.0.1" }), transport, opts);
}

/** Connect to a remote MCP server over streamable HTTP and return its tools. */
export async function listToolsHttp(url: string, headers: Record<string, string> = {}, opts: LoadOptions = {}): Promise<ToolInfo[]> {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  return connectAndList(new Client({ name: "toolright", version: "0.0.1" }), transport, opts);
}

export interface ToolSource {
  /** server command + args (stdio) */
  command?: string[];
  /** streamable HTTP endpoint */
  url?: string;
  /** extra HTTP headers for --url, e.g. { Authorization: "Bearer ..." } */
  headers?: Record<string, string>;
  /** JSON snapshot produced by `toolright list --json` */
  toolsFile?: string;
  timeoutMs?: number;
  maxTools?: number;
}

export async function loadTools(src: ToolSource): Promise<ToolInfo[]> {
  const opts: LoadOptions = { timeoutMs: src.timeoutMs, maxTools: src.maxTools };
  if (src.toolsFile) {
    const text = (await readFile(src.toolsFile, "utf8")).replace(/^\uFEFF/, "");
    const raw = JSON.parse(text);
    const arr = Array.isArray(raw) ? raw : raw?.tools;
    if (!Array.isArray(arr)) throw new Error(`${src.toolsFile}: expected an array of tools`);
    if (arr.length > (opts.maxTools ?? LIMITS.maxTools)) throw new Error(`${src.toolsFile}: too many tools (more than ${opts.maxTools ?? LIMITS.maxTools})`);
    return arr.map((t: any) => normalizeTool(t ?? {}));
  }
  if (src.url) return listToolsHttp(src.url, src.headers, opts);
  if (src.command && src.command.length > 0) return listTools(src.command[0]!, src.command.slice(1), opts);
  throw new Error("Provide a server command after `--`, or --url <endpoint>, or --tools <file.json>.");
}
