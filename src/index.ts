#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Tier 1: Core tools
import { coreTools, handleCoreTool } from "./tools/core-tools-mcp.js";

// Tier 2: Situational tools
import { tier2ToolDefs, handleTier2Tool, getActiveTier2Tools, getVisibleGameTools, TIER1_CORE_TOOLS, ALL_TOOL_NAMES_FOR_SEARCH } from "./tool-filters.js";

// Tier 3: Legacy low-level tools (hidden from tools/list, accessible via search_tools and CallTool)
import { connectionTools, handleConnectionTool } from "./tools/connection.js";
import { movementTools, handleMovementTool } from "./tools/movement.js";
import { environmentTools, handleEnvironmentTool } from "./tools/environment.js";
import { buildingTools, handleBuildingTool } from "./tools/building.js";
import { craftingTools, handleCraftingTool } from "./tools/crafting.js";
import { storageTools, handleStorageTool } from "./tools/storage.js";
import { combatTools, handleCombatTool } from "./tools/combat.js";
import { highLevelActionTools, handleHighLevelActionTool } from "./tools/high-level-actions-mcp.js";
import { debugCraftingTools, handleDebugCraftingTool } from "./tools/debug_crafting.js";
import { bootstrapTools, handleBootstrapTool } from "./tools/bootstrap.js";

import { getAgentType } from "./agent-state.js";
import { searchTools, TOOL_METADATA } from "./tool-metadata.js";
import { botManager } from "./bot-manager/index.js";
import { registry } from "./tool-handler-registry.js";

// All tool definitions (Tier 1 + Tier 2 + Tier 3) for CallTool routing
const allToolDefs = {
  // Tier 1
  ...coreTools,
  // Tier 2
  ...tier2ToolDefs,
  // Tier 3 (legacy)
  ...connectionTools,
  ...movementTools,
  ...environmentTools,
  ...buildingTools,
  ...craftingTools,
  ...storageTools,
  ...combatTools,
  ...highLevelActionTools,
  ...debugCraftingTools,
  ...bootstrapTools,
  // Hot-reload tool
  mc_reload: {
    description: "Hot-reload tool implementations after code changes. Re-imports core-tools and high-level-actions modules without restarting the MCP server process. Call after `npm run build` to reflect code changes. Stdio connection is preserved.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // Tool Search (always visible)
  search_tools: {
    description: "Search for available tools by keyword or category. Use this to discover low-level tools not shown in the main list. Categories: connection, info, communication, actions, crafting, mining, building, storage, combat, survival",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (keyword, category, or tag). Examples: 'crafting', 'survival', 'mining', 'dig', 'portal'. Leave empty to get top priority tools.",
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
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: { listChanged: true },
    },
  }
);

// Handle tool listing — 3-tier filtering
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const agentType = getAgentType();

  let visibleTools: [string, { description: string; inputSchema: object }][];

  if (agentType === "dev") {
    // Dev mode: show ALL tools
    visibleTools = Object.entries(allToolDefs);
  } else {
    // Game mode: Tier 1 (always) + active Tier 2 (conditional)
    const visibleNames = getVisibleGameTools();
    visibleTools = Object.entries(allToolDefs)
      .filter(([name]) => visibleNames.has(name));
  }

  console.error(`[MCP-Stdio] tools/list for agentType=${agentType}: ${visibleTools.length} tools`);

  return {
    tools: visibleTools.map(([name, tool]) => ({
      name,
      description: (tool as { description: string }).description,
      inputSchema: (tool as { inputSchema: object }).inputSchema,
    })),
  };
});

// Global tool timeout (5 minutes) — prevents any tool from hanging indefinitely
const TOOL_TIMEOUT_MS = 300_000;

// Handle tool execution — routes to appropriate handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = (args || {}) as Record<string, unknown>;

  try {
    let result: string;

    // Wrap all tool execution with a global timeout
    const toolExecution = async (): Promise<string> => {
    let toolResult: string;

    // Route: Tier 1 core tools (mc_*)
    if (name in coreTools) {
      toolResult = await handleCoreTool(name, toolArgs);
      // After mc_connect, refresh tools/list so Tier 2 tools (based on bot state) become visible
      if (name === "mc_connect" && toolArgs.action !== "disconnect") {
        try {
          await server.sendToolListChanged();
        } catch (_) { /* ignore */ }
      }
    }
    // Route: Tier 2 situational tools
    else if (name in tier2ToolDefs) {
      toolResult = await handleTier2Tool(name, toolArgs);
    }
    // Route: Tier 3 legacy tools (minecraft_*)
    else if (name in connectionTools) {
      toolResult = await handleConnectionTool(name, toolArgs);
    } else if (name in movementTools) {
      toolResult = await handleMovementTool(name, toolArgs);
    } else if (name in environmentTools) {
      toolResult = await handleEnvironmentTool(name, toolArgs);
    } else if (name in buildingTools) {
      toolResult = await handleBuildingTool(name, toolArgs);
    } else if (name in craftingTools) {
      toolResult = await handleCraftingTool(name, toolArgs);
    } else if (name in storageTools) {
      toolResult = await handleStorageTool(name, toolArgs);
    } else if (name in combatTools) {
      toolResult = await handleCombatTool(name, toolArgs);
    } else if (name in highLevelActionTools) {
      toolResult = await handleHighLevelActionTool(name, toolArgs);
    } else if (name in debugCraftingTools) {
      toolResult = await handleDebugCraftingTool(name, toolArgs);
    } else if (name in bootstrapTools) {
      toolResult = await handleBootstrapTool(name, toolArgs);
    } else if (name === "mc_reload") {
      toolResult = await reloadModules();
    } else if (name === "search_tools") {
      const query = (toolArgs.query as string) || "";
      const detail = (toolArgs.detail as "brief" | "full") || "brief";

      // search_tools always searches ALL tools (Progressive Disclosure)
      const availableTools = ALL_TOOL_NAMES_FOR_SEARCH;
      const matchedTools = searchTools(query, availableTools);

      if (detail === "brief") {
        const results = matchedTools.map(toolName => {
          const metadata = TOOL_METADATA[toolName];
          return {
            name: toolName,
            category: metadata?.category || "unknown",
            priority: metadata?.priority || 0,
          };
        });
        toolResult = JSON.stringify({ query, count: results.length, tools: results }, null, 2);
      } else {
        const results = matchedTools.map(toolName => {
          const metadata = TOOL_METADATA[toolName];
          const toolDef = allToolDefs[toolName as keyof typeof allToolDefs];
          return {
            name: toolName,
            category: metadata?.category || "unknown",
            tags: metadata?.tags || [],
            description: toolDef?.description || "",
            inputSchema: toolDef?.inputSchema || {},
          };
        });
        toolResult = JSON.stringify({ query, count: results.length, tools: results }, null, 2);
      }
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
    return toolResult;
    }; // end toolExecution

    // mc_execute has its own timeout; for all others, apply global timeout
    const useTimeout = name !== "mc_execute";
    if (useTimeout) {
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS);
      });
      result = await Promise.race([toolExecution(), timeoutPromise]);
    } else {
      result = await toolExecution();
    }

    // Auto-inject unread chat messages into every tool result
    // so bots don't need to poll separately
    let chatSuffix = "";
    if (name !== "mc_chat" && name !== "minecraft_get_chat_messages" && name !== "mc_connect" && name !== "minecraft_connect" && name !== "search_tools") {
      try {
        const username = botManager.requireSingleBot();
        const messages = botManager.getChatMessages(username, true);
        if (messages.length > 0) {
          const chatLines = messages.map((m: { username: string; message: string }) =>
            `<${m.username}> ${m.message}`
          );
          chatSuffix = `\n\n📨 新着チャット (${messages.length}件):\n${chatLines.join("\n")}`;
        }
      } catch {
        // Not connected yet - skip
      }
    }

    return {
      content: [
        {
          type: "text",
          text: result + chatSuffix,
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

// Hot-reload: re-import modules with cache busting
async function reloadModules(): Promise<string> {
  const v = Date.now();
  const base = new URL('./', import.meta.url).href;
  const reloaded: string[] = [];
  const errors: string[] = [];

  // Reload order matters: leaf dependencies first
  const modules = [
    { name: 'high-level-actions', path: 'tools/high-level-actions.js' },
    { name: 'core-tools', path: 'tools/core-tools.js' },
  ];

  for (const mod of modules) {
    try {
      await import(base + mod.path + '?v=' + v);
      reloaded.push(mod.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${mod.name}: ${msg}`);
      console.error(`[mc_reload] Failed to reload ${mod.name}:`, err);
    }
  }

  // Notify client to refresh tool list
  try {
    await server.sendToolListChanged();
  } catch (err) {
    console.error('[mc_reload] Failed to send list_changed:', err);
  }

  const status = [
    `Reloaded: ${reloaded.join(', ') || 'none'}`,
    `Registry keys: ${Object.keys(registry).join(', ')}`,
  ];
  if (errors.length > 0) {
    status.push(`Errors: ${errors.join('; ')}`);
  }
  status.push('tools/list_changed notification sent.');
  console.error(`[mc_reload] ${status.join(' | ')}`);
  return status.join('\n');
}

// Start the server
async function main() {
  // Start persistent viewer server if VIEWER=1
  if (process.env.VIEWER === "1") {
    const viewerPort = parseInt(process.env.VIEWER_PORT || "3007");
    try {
      const { startViewerServer } = await import("./viewer-server.js");
      startViewerServer(viewerPort);
    } catch (e) {
      console.error(`[Main] Failed to start viewer server: ${e}`);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mineflayer MCP Server v2.0 running on stdio");
}

// Cleanup: disconnect all bots when process exits
function cleanup() {
  console.error('[MCP-Stdio] Cleaning up - disconnecting all bots...');
  try {
    botManager.disconnectAll();
    console.error('[MCP-Stdio] All bots disconnected');
  } catch (e) {
    console.error('[MCP-Stdio] Cleanup error:', e);
  }
}

// SIGUSR1: Hot-reload modules + send tools/list_changed (triggered by npm run dev)
process.on('SIGUSR1', () => {
  console.error('[MCP-Stdio] SIGUSR1 received - hot-reloading modules');
  reloadModules().then((result) => {
    console.error('[MCP-Stdio] Reload result:', result);
  }).catch((err) => {
    console.error('[MCP-Stdio] Reload failed:', err);
  });
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

// Add global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('[MCP-Stdio] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MCP-Stdio] Unhandled rejection at:', promise, 'reason:', reason);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
