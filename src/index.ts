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
import { learningTools, handleLearningTool } from "./tools/learning.js";
import { highLevelActionTools, handleHighLevelActionTool } from "./tools/high-level-actions-mcp.js";
import { storageTools, handleStorageTool } from "./tools/storage.js";
import { GAME_AGENT_TOOLS } from "./tool-filters.js";
import { getAgentType } from "./agent-state.js";
import { searchTools, TOOL_METADATA } from "./tool-metadata.js";

// Combine all tools
const allTools = {
  ...connectionTools,
  ...movementTools,
  ...environmentTools,
  ...buildingTools,
  ...coordinationTools,
  ...craftingTools,
  ...combatTools,
  ...learningTools,
  ...highLevelActionTools,
  ...storageTools,
  // Tool Search
  search_tools: {
    description: "Search for available tools by keyword or category. Use this to discover relevant tools without loading all tool definitions. Categories: connection, info, communication, actions, crafting, learning, coordination, tasks",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (keyword, category, or tag). Examples: 'crafting', 'survival', 'mining', 'info'. Leave empty to get top priority tools.",
        },
        detail: {
          type: "string",
          enum: ["brief", "full"],
          default: "brief",
          description: "Level of detail in results. 'brief' shows only names and categories, 'full' includes descriptions and parameters.",
        },
      },
    },
  },
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
  // Get current agent type
  const agentType = getAgentType();

  // Filter tools based on agent type
  const filteredTools = agentType === "dev"
    ? Object.entries(allTools)  // Dev mode: all tools
    : Object.entries(allTools).filter(([name]) => GAME_AGENT_TOOLS.has(name));  // Game mode: basic tools only

  console.error(`[MCP-Stdio] tools/list for agentType=${agentType}: ${filteredTools.length} tools`);

  return {
    tools: filteredTools.map(([name, tool]) => ({
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
    } else if (name in learningTools) {
      result = await handleLearningTool(name, toolArgs);
    } else if (name in highLevelActionTools) {
      result = await handleHighLevelActionTool(name, toolArgs);
    } else if (name in storageTools) {
      result = await handleStorageTool(name, toolArgs);
    } else if (name === "search_tools") {
      const query = (toolArgs.query as string) || "";
      const detail = (toolArgs.detail as "brief" | "full") || "brief";

      // IMPORTANT: search_tools always searches ALL tools (Progressive Disclosure)
      // Only tools/list is filtered by agent type
      const availableTools = new Set(Object.keys(allTools));

      // Search for matching tools
      const matchedTools = searchTools(query, availableTools);

      if (detail === "brief") {
        // Return brief info: name and category only
        const results = matchedTools.map(toolName => {
          const metadata = TOOL_METADATA[toolName];
          return {
            name: toolName,
            category: metadata?.category || "unknown",
            priority: metadata?.priority || 0,
          };
        });
        result = JSON.stringify({ query, count: results.length, tools: results }, null, 2);
      } else {
        // Return full info: name, category, description, and input schema
        const results = matchedTools.map(toolName => {
          const metadata = TOOL_METADATA[toolName];
          const toolDef = allTools[toolName as keyof typeof allTools];
          return {
            name: toolName,
            category: metadata?.category || "unknown",
            tags: metadata?.tags || [],
            description: toolDef?.description || "",
            inputSchema: toolDef?.inputSchema || {},
          };
        });
        result = JSON.stringify({ query, count: results.length, tools: results }, null, 2);
      }
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

// Add global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('[MCP-Stdio] Uncaught exception:', error);
  // Don't exit - try to continue running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MCP-Stdio] Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit - try to continue running
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
