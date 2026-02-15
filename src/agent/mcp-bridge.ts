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

interface GameEvent {
  type: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

class MCPBridge {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private eventBuffer: GameEvent[] = [];
  private subscribedToEvents = false;
  private lastFoodManagementTime = 0;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(MCP_WS_URL);

      this.ws.on("open", () => {
        console.error(`[Bridge] Connected to ${MCP_WS_URL}`);
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle pushed game events (notifications)
          if (message.method === "notifications/gameEvent" && message.params) {
            // Format: { username, event: { type, message, timestamp, data } }
            const event = (message.params as { event: GameEvent }).event;
            if (event) {
              this.eventBuffer.push(event);
              // Keep only last 10 events
              if (this.eventBuffer.length > 10) {
                this.eventBuffer.shift();
              }
              console.error(`[Bridge] Event: ${event.type}: ${event.message}`);
            }
            return;
          }

          const response = message as JSONRPCResponse;

          // Skip other notifications
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

  async subscribeToEvents(username: string): Promise<void> {
    if (this.subscribedToEvents) return;
    try {
      await this.request("tools/call", {
        name: "subscribe_events",
        arguments: { username },
      });
      this.subscribedToEvents = true;
      console.error(`[Bridge] Subscribed to events for ${username}`);
    } catch (e) {
      console.error(`[Bridge] Failed to subscribe to events:`, e);
    }
  }

  getAndClearEvents(): GameEvent[] {
    const events = [...this.eventBuffer];
    this.eventBuffer = [];
    return events;
  }

  /**
   * Format events for result injection
   * Returns { urgent, normal } - urgent goes at START, normal at END
   */
  formatEventsForResult(): { urgent: string; normal: string } {
    const events = this.getAndClearEvents();
    if (events.length === 0) return { urgent: "", normal: "" };

    // Separate urgent vs normal events
    const urgentTypes = ["drowning", "damaged", "death", "hostile_spawn", "health_changed"];
    const urgentEvents: GameEvent[] = [];
    const normalEvents: GameEvent[] = [];

    for (const e of events) {
      // health_changed is urgent only if health is low
      if (e.type === "health_changed" && e.data) {
        const health = e.data.health as number | undefined;
        const hunger = e.data.food as number | undefined;

        // Early-exit for stable state: ignore minor fluctuations
        if (health !== undefined && hunger !== undefined && health >= 18 && hunger >= 17) {
          continue; // Dead zone - system is stable, no action needed
        }

        // Fast negative feedback loop: if hunger < 15, immediately consume food
        if (hunger !== undefined && hunger < 15) {
          const now = Date.now();
          if (now - this.lastFoodManagementTime > 5000) {
            this.lastFoodManagementTime = now;
            urgentEvents.push(e);
          }
          continue; // Early return - skip diagnostics
        }

        if (health !== undefined && health < 10) {
          urgentEvents.push(e);
        } else {
          normalEvents.push(e);
        }
      } else if (urgentTypes.includes(e.type)) {
        urgentEvents.push(e);
      } else {
        normalEvents.push(e);
      }
    }

    const formatEvent = (e: GameEvent) => {
      const time = new Date(e.timestamp).toLocaleTimeString("ja-JP");
      return `[${time}] ${e.type}: ${e.message}`;
    };

    let urgent = "";
    if (urgentEvents.length > 0) {
      const lines = urgentEvents.map(formatEvent);
      urgent = `\n🚨🚨🚨 **緊急イベント - 即座に対応が必要！** 🚨🚨🚨\n${lines.join("\n")}\n→ 現在のタスクより優先して対処してください！\n\n`;
    }

    let normal = "";
    if (normalEvents.length > 0) {
      const lines = normalEvents.map(formatEvent);
      normal = `\n\n📋 その他のイベント:\n${lines.join("\n")}`;
    }

    return { urgent, normal };
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
  const BOT_USERNAME = process.env.BOT_USERNAME || "Claude";

  // Connect to WebSocket MCP server
  await bridge.connect();
  // Events are subscribed when minecraft_connect is called

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

  // Forward tool call requests - append events to result
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Force username for minecraft_connect - ignore what Claude sends
    let finalArgs = args;
    if (name === "minecraft_connect") {
      finalArgs = { ...args, username: BOT_USERNAME };
      console.error(`[Bridge] Forcing username to: ${BOT_USERNAME}`);
    }

    const result = await bridge.request("tools/call", {
      name,
      arguments: finalArgs,
    }) as { content: Array<{ type: string; text: string }> };

    // Subscribe to events after successful connection
    if (name === "minecraft_connect") {
      await bridge.subscribeToEvents(BOT_USERNAME);
    }

    // Inject events: urgent at START, normal at END
    const { urgent, normal } = bridge.formatEventsForResult();
    if ((urgent || normal) && result.content && result.content.length > 0) {
      const firstContent = result.content[0];
      const lastContent = result.content[result.content.length - 1];

      // Urgent events go at the BEGINNING (most visible)
      if (urgent && firstContent.type === "text") {
        firstContent.text = urgent + firstContent.text;
        console.error(`[Bridge] URGENT events prepended to ${name} result`);
      }

      // Normal events go at the END
      if (normal && lastContent.type === "text") {
        lastContent.text += normal;
        console.error(`[Bridge] Normal events appended to ${name} result`);
      }
    }

    // Note: Skill injection is now handled by MCP-WS-Server directly
    // Bridge skill injection disabled for reliability

    return result;
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
