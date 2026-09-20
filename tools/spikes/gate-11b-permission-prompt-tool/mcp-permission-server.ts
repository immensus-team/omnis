#!/usr/bin/env node
// Gate 11b: a tiny stdio MCP server serving the tool that --permission-prompt-tool calls.
// Contract (undocumented upstream, confirmed by community writeups + gate-11b probing):
//   input:  { tool_name: string, input: object }
//   output: content: [{ type: "text", text: JSON.stringify({ behavior: "allow" | "deny", updatedInput?, message? }) }]
// Rule: deny Bash, allow everything else (Read included) — logs every request to LOG_PATH first.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFileSync } from "node:fs";

const LOG_PATH = process.env.GATE11B_LOG_PATH;
if (!LOG_PATH) throw new Error("GATE11B_LOG_PATH env var required");

const server = new McpServer({ name: "omnis-gate11b-permission", version: "0.0.1" });

server.registerTool(
  "approval_prompt",
  {
    description: "omnis gate-11b permission-prompt-tool: deny Bash, allow everything else",
    inputSchema: { tool_name: z.string(), input: z.object({}).passthrough() },
  },
  async ({ tool_name, input }) => {
    const decision = tool_name === "Bash" ? "deny" : "allow";
    // ponytail: rule is a hardcoded deny-Bash/allow-rest for this spike, not a real policy engine.
    appendFileSync(
      LOG_PATH,
      JSON.stringify({ ts: new Date().toISOString(), tool_name, input, decision }) + "\n",
    );
    const payload =
      decision === "allow"
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: `omnis gate-11b: ${tool_name} is denied by rule` };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  },
);

await server.connect(new StdioServerTransport());
