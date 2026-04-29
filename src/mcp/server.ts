import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ragIndexTool, ragSearchTool, ragListProjectsTool } from "./tools.js";
import { ragIndexHandler, ragSearchHandler, ragListProjectsHandler } from "./tools.js";

// Create MCP server instance
const server = new Server(
  {
    name: "ragi",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register list tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      ragIndexTool,
      ragSearchTool,
      ragListProjectsTool,
    ],
  };
});

// Register call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "rag_index":
      return await ragIndexHandler(args);
    case "rag_search":
      return await ragSearchHandler(args);
    case "rag_list_projects":
      return await ragListProjectsHandler(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
async function main() {
  console.error("ragi MCP server starting...");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("ragi MCP server running on STDIO");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
