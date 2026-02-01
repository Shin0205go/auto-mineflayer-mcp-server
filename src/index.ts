#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { connectionTools, handleConnectionTool } from "./tools/connection.js";
import { movementTools, handleMovementTool } from "./tools/movement.js";
import { environmentTools, handleEnvironmentTool } from "./tools/environment.js";
import { buildingTools, handleBuildingTool } from "./tools/building.js";
import { coordinationTools, handleCoordinationTool } from "./tools/coordination.js";
import { craftingTools, handleCraftingTool } from "./tools/crafting.js";
import { combatTools, handleCombatTool } from "./tools/combat.js";

// Combine all tools
const allTools = {
  ...connectionTools,
  ...movementTools,
  ...environmentTools,
  ...buildingTools,
  ...coordinationTools,
  ...craftingTools,
  ...combatTools,
};

// Create MCP server
const server = new Server(
  {
    name: "mineflayer-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.entries(allTools).map(([name, tool]) => ({
      name,
      description: (tool as { description: string }).description,
      inputSchema: (tool as { inputSchema: object }).inputSchema,
    })),
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = (args || {}) as Record<string, unknown>;

  try {
    let result: string;

    // Route to appropriate handler
    if (name in connectionTools) {
      result = await handleConnectionTool(name, toolArgs);
    } else if (name in movementTools) {
      result = await handleMovementTool(name, toolArgs);
    } else if (name in environmentTools) {
      result = await handleEnvironmentTool(name, toolArgs);
    } else if (name in buildingTools) {
      result = await handleBuildingTool(name, toolArgs);
    } else if (name in coordinationTools) {
      result = await handleCoordinationTool(name, toolArgs);
    } else if (name in craftingTools) {
      result = await handleCraftingTool(name, toolArgs);
    } else if (name in combatTools) {
      result = await handleCombatTool(name, toolArgs);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mineflayer MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
