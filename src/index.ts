#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Core tools (mc_execute, mc_connect, mc_chat, mc_status, mc_gather, etc.)
import { coreTools, handleCoreTool } from "./tools/core-tools-mcp.js";

import { VISIBLE_TOOLS } from "./tool-filters.js";
import { getAgentType } from "./agent-state.js";
import { botManager, bumpBotManagerVersion } from "./bot-manager/index.js";
import { registry } from "./tool-handler-registry.js";

// (high-level-actions removed — agents write mineflayer code directly in mc_execute)

// Tool definitions for tools/list and CallTool
const allToolDefs: Record<string, { description: string; inputSchema: object }> = {
  ...coreTools,
  // Hot-reload tool
  mc_reload: {
    description: "Hot-reload tool implementations after code changes. Re-imports core-tools module without restarting the MCP server process. Call after `npm run build` to reflect code changes. Stdio connection is preserved.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
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

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const agentType = getAgentType();

  let visibleTools: [string, { description: string; inputSchema: object }][];

  if (agentType === "dev") {
    // Dev mode: show ALL tools
    visibleTools = Object.entries(allToolDefs);
  } else {
    // Game mode: only mc_execute, mc_connect, mc_chat, mc_reload
    visibleTools = Object.entries(allToolDefs)
      .filter(([name]) => VISIBLE_TOOLS.has(name));
  }

  console.error(`[MCP-Stdio] tools/list for agentType=${agentType}: ${visibleTools.length} tools`);

  return {
    tools: visibleTools.map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Global tool timeout (5 minutes) — prevents any tool from hanging indefinitely
const TOOL_TIMEOUT_MS = 300_000;

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = (args || {}) as Record<string, unknown>;

  try {
    let result: string;

    const toolExecution = async (): Promise<string> => {
      // Core tools (mc_execute, mc_connect, mc_chat, mc_status, mc_gather, etc.)
      if (name in coreTools) {
        const toolResult = await handleCoreTool(name, toolArgs);
        // After mc_connect, refresh tools/list
        if ((name === "mc_connect" && toolArgs.action !== "disconnect") || name === "mc_reconnect") {
          try {
            await server.sendToolListChanged();
          } catch (_) { /* ignore */ }
        }
        return toolResult;
      }
      // Hot-reload
      else if (name === "mc_reload") {
        return await reloadModules();
      }
      else {
        throw new Error(`Unknown tool: ${name}`);
      }
    };

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
    let chatSuffix = "";
    if (name !== "mc_chat" && name !== "mc_connect") {
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

  const modules = [
    { name: 'core-tools', path: 'tools/core-tools.js' },
    { name: 'mc-execute', path: 'tools/mc-execute.js' },
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

  bumpBotManagerVersion();

  // Reload viewer-server: stop the old HTTP server, import fresh code, restart.
  // viewer-server now reads botManager directly on each request, so no re-attach needed.
  try {
    const viewerPort = parseInt(process.env.VIEWER_PORT || '3099');

    // Step 1: Force-close any active HTTP server on the viewer port via _getActiveHandles().
    // This handles the case where the cached module's stopViewerServer() cannot reach
    // the running server (e.g., module-level `server` var vs. global.__viewerServer mismatch).
    const handles: any[] = (process as any)._getActiveHandles?.() ?? [];
    for (const h of handles) {
      try {
        const addr = typeof h.address === 'function' ? h.address() : null;
        if (addr && addr.port === viewerPort) {
          console.error(`[mc_reload] Force-closing handle on port ${viewerPort}`);
          if (typeof (h as any).closeAllConnections === 'function') (h as any).closeAllConnections();
          if (typeof h.close === 'function') h.close(() => {});
        }
      } catch {}
    }
    // Give the OS time to release the port
    await new Promise(r => setTimeout(r, 300));

    // Step 2: Also call the module's stopViewerServer() as a belt-and-suspenders cleanup
    const oldViewer = await import(base + 'viewer-server.js');
    try { await oldViewer.stopViewerServer(); } catch {}

    // Step 3: Load fresh viewer-server and start it
    const newViewer = await import(base + 'viewer-server.js?v=' + v);
    await newViewer.startViewerServer(viewerPort);
    reloaded.push('viewer-server');
  } catch (e) {
    errors.push(`viewer-server: ${e}`);
  }

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
  // Always start the viewer/dashboard server (VIEWER_PORT env var, default 3099)
  {
    const viewerPort = parseInt(process.env.VIEWER_PORT || "3099");
    try {
      const { startViewerServer } = await import("./viewer-server.js");
      await startViewerServer(viewerPort);
    } catch (e) {
      console.error(`[Main] Failed to start viewer server: ${e}`);
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mineflayer MCP Server v2.0 running on stdio");
}

// Cleanup
function cleanup() {
  console.error('[MCP-Stdio] Cleaning up - disconnecting all bots...');
  try {
    botManager.disconnectAll();
    console.error('[MCP-Stdio] All bots disconnected');
  } catch (e) {
    console.error('[MCP-Stdio] Cleanup error:', e);
  }
}

process.on('SIGUSR1', () => {
  console.error('[MCP-Stdio] SIGUSR1 received - hot-reloading modules');
  reloadModules().then((result) => {
    console.error('[MCP-Stdio] Reload result:', result);
  }).catch((err) => {
    console.error('[MCP-Stdio] Reload failed:', err);
  });
});

process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });

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
