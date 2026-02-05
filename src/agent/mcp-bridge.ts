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
import { getAgentSkill } from "../tools/learning.js";

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

/**
 * Analyze tool result and return relevant skill content
 * NOTE: Skill injection moved to mcp-ws-server.ts for reliability
 */
function getRelevantSkill(toolName: string, resultText: string): string {
  // Skill injection is now handled by MCP-WS-Server directly
  // This function is kept for potential future use

  // inventory check - no tools?
  if (toolName === "minecraft_get_inventory") {
    const hasPickaxe = /pickaxe/i.test(resultText);
    const hasSword = /sword/i.test(resultText);
    const hasAxe = /axe/i.test(resultText) && !/pickaxe/i.test(resultText);

    if (!hasPickaxe && !hasAxe) {
      // No tools at all - need wood gathering
      const skill = getAgentSkill("wood-gathering");
      return `\n\n📖 **推奨スキル: wood-gathering** (ツールがありません)\n${skill}`;
    }

    if (hasPickaxe && /wooden_pickaxe/i.test(resultText) && !/stone_pickaxe|iron_pickaxe|diamond_pickaxe/i.test(resultText)) {
      // Only wooden pickaxe - need stone tools
      const skill = getAgentSkill("stone-tools");
      return `\n\n📖 **推奨スキル: stone-tools** (木のピッケルしかありません)\n${skill}`;
    }

    if (/stone_pickaxe/i.test(resultText) && !/iron_pickaxe|diamond_pickaxe/i.test(resultText)) {
      // Only stone pickaxe - need iron mining
      const skill = getAgentSkill("iron-mining");
      return `\n\n📖 **推奨スキル: iron-mining** (石のピッケルがあります、鉄を目指しましょう)\n${skill}`;
    }
  }

  // status check - low HP or hunger?
  if (toolName === "minecraft_get_status") {
    const healthMatch = resultText.match(/Health:\s*([\d.]+)/i) || resultText.match(/HP:\s*([\d.]+)/i);
    const foodMatch = resultText.match(/Food:\s*(\d+)/i) || resultText.match(/空腹:\s*(\d+)/i);

    const health = healthMatch ? parseFloat(healthMatch[1]) : 20;
    const food = foodMatch ? parseInt(foodMatch[1]) : 20;

    if (health < 10 || food < 10) {
      const skill = getAgentSkill("food-hunting");
      return `\n\n📖 **推奨スキル: food-hunting** (HP/空腹が低い)\n${skill}`;
    }
  }

  // surroundings check - night time? hostile nearby?
  if (toolName === "minecraft_get_surroundings") {
    const isNight = /夜|night/i.test(resultText);
    const hasHostile = /zombie|skeleton|creeper|spider|ゾンビ|スケルトン|クリーパー/i.test(resultText);
    const noBed = !/bed|ベッド/i.test(resultText);

    if (hasHostile) {
      const skill = getAgentSkill("combat-basics");
      return `\n\n📖 **推奨スキル: combat-basics** (敵が近くにいます)\n${skill}`;
    }

    if (isNight && noBed) {
      const skill = getAgentSkill("bed-crafting");
      return `\n\n📖 **推奨スキル: bed-crafting** (夜でベッドがありません)\n${skill}`;
    }
  }

  return "";
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
