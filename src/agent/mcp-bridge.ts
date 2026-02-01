#!/usr/bin/env node

/**
 * MCP Bridge: stdio → WebSocket
 *
 * Agent SDKからstdioで受けたMCPリクエストを
 * WebSocket MCPサーバーに転送する。
 * これによりOAuth認証と永続接続を両立できる。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";

const MCP_WS_URL = process.env.MCP_WS_URL || "ws://localhost:8765";

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

class MCPBridge {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(MCP_WS_URL);

      this.ws.on("open", () => {
        console.error(`[Bridge] Connected to ${MCP_WS_URL}`);
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString()) as JSONRPCResponse;

          // Skip server/ready notification
          if (!("id" in response)) return;

          const pending = this.pendingRequests.get(response.id as number);
          if (pending) {
            this.pendingRequests.delete(response.id as number);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (error) {
          console.error("[Bridge] Failed to parse response:", error);
        }
      });

      this.ws.on("error", (error) => {
        console.error("[Bridge] WebSocket error:", error);
        reject(error);
      });

      this.ws.on("close", () => {
        console.error("[Bridge] WebSocket closed");
        this.ws = null;
      });
    });
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.ws!.send(JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }));

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 60000);
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

async function main() {
  const bridge = new MCPBridge();

  // Connect to WebSocket MCP server
  await bridge.connect();

  // Create stdio MCP server
  const server = new Server(
    {
      name: "mcp-bridge",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Forward tool list requests
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await bridge.request("tools/list") as { tools: unknown[] };
    return result;
  });

  // Forward tool call requests
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await bridge.request("tools/call", {
      name,
      arguments: args,
    });
    return result as { content: Array<{ type: string; text: string }> };
  });

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Bridge] MCP Bridge running on stdio");

  // Graceful shutdown
  process.on("SIGINT", () => {
    bridge.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[Bridge] Fatal error:", error);
  process.exit(1);
});
