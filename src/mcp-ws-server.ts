#!/usr/bin/env node

/**
 * MCP WebSocket Server
 *
 * Exposes the MCP tools via WebSocket for the Gemini agent to consume.
 * This allows real-time bidirectional communication between the agent and Minecraft.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { connectionTools, handleConnectionTool } from "./tools/connection.js";
import { movementTools, handleMovementTool } from "./tools/movement.js";
import { environmentTools, handleEnvironmentTool } from "./tools/environment.js";
import { visualizationTools, handleVisualizationTool } from "./tools/visualization.js";
import { buildingTools, handleBuildingTool } from "./tools/building.js";

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Combine all tools
const allTools = {
  ...connectionTools,
  ...movementTools,
  ...environmentTools,
  ...visualizationTools,
  ...buildingTools,
};

// Tool handlers mapping
async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name in connectionTools) {
    return handleConnectionTool(name, args);
  } else if (name in movementTools) {
    return handleMovementTool(name, args);
  } else if (name in environmentTools) {
    return handleEnvironmentTool(name, args);
  } else if (name in visualizationTools) {
    return handleVisualizationTool(name, args);
  } else if (name in buildingTools) {
    return handleBuildingTool(name, args);
  } else {
    throw new Error(`Unknown tool: ${name}`);
  }
}

// Handle JSON-RPC requests
async function handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'tools/list': {
        const tools = Object.entries(allTools).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
        return {
          jsonrpc: '2.0',
          id,
          result: { tools }
        };
      }

      case 'tools/call': {
        const toolName = params?.name as string;
        const toolArgs = (params?.arguments || {}) as Record<string, unknown>;

        if (!toolName) {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: 'Missing tool name'
            }
          };
        }

        const result = await handleTool(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: result }]
          }
        };
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: { pong: true, timestamp: Date.now() }
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: errorMessage
      }
    };
  }
}

// Start WebSocket server
function startServer(port: number = 8765) {
  const wss = new WebSocketServer({ port });

  console.log(`[MCP-WS-Server] Starting on port ${port}...`);

  wss.on('connection', (ws: WebSocket, req) => {
    const clientAddr = req.socket.remoteAddress;
    console.log(`[MCP-WS-Server] Client connected from ${clientAddr}`);

    ws.on('message', async (data: Buffer) => {
      try {
        const request = JSON.parse(data.toString()) as JSONRPCRequest;
        console.log(`[MCP-WS-Server] Received: ${request.method}`);

        const response = await handleRequest(request);
        ws.send(JSON.stringify(response));
      } catch (error) {
        console.error('[MCP-WS-Server] Parse error:', error);
        const errorResponse: JSONRPCResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: {
            code: -32700,
            message: 'Parse error'
          }
        };
        ws.send(JSON.stringify(errorResponse));
      }
    });

    ws.on('close', () => {
      console.log(`[MCP-WS-Server] Client disconnected: ${clientAddr}`);
    });

    ws.on('error', (error) => {
      console.error(`[MCP-WS-Server] WebSocket error:`, error);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'server/ready',
      params: {
        name: 'mineflayer-mcp-server',
        version: '1.0.0',
        tools: Object.keys(allTools)
      }
    }));
  });

  wss.on('listening', () => {
    console.log(`[MCP-WS-Server] Mineflayer MCP WebSocket Server running on ws://localhost:${port}`);
    console.log(`[MCP-WS-Server] Available tools: ${Object.keys(allTools).join(', ')}`);
  });

  wss.on('error', (error) => {
    console.error('[MCP-WS-Server] Server error:', error);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[MCP-WS-Server] Shutting down...');
    wss.close(() => {
      console.log('[MCP-WS-Server] Server closed');
      process.exit(0);
    });
  });

  return wss;
}

// Main entry point
const port = parseInt(process.env.MCP_WS_PORT || '8765', 10);
startServer(port);
