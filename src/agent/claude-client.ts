/**
 * Claude Agent Client
 *
 * Uses Claude Agent SDK for OAuth authentication.
 * Routes tool calls through MCP Bridge (stdio → WebSocket).
 */

import { query, type SDKMessage, type Query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "events";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { MCPWebSocketClientTransport } from "./mcp-ws-transport.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for terminal output
const C = {
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};
const PREFIX = `${C.magenta}[Claude]${C.reset}`;

// MCP Bridge path
const projectRoot = join(__dirname, "..", "..");
const MCP_BRIDGE_PATH = join(projectRoot, "dist", "agent", "mcp-bridge.js");

export interface ClaudeConfig {
  systemInstruction?: string;
  model?: string;
  maxTurns?: number;
  mcpServerUrl?: string;
  agentName?: string;  // For board write hook
}

// Supported models (cost order: low → high)
const SUPPORTED_MODELS: Record<string, string> = {
  "sonnet": "claude-sonnet-4-20250514",
  "opus": "claude-opus-4-6",
  "haiku": "claude-haiku-3-5-20241022",
};

// Default to Sonnet for cost efficiency
const DEFAULT_MODEL = process.env.CLAUDE_MODEL
  ? (SUPPORTED_MODELS[process.env.CLAUDE_MODEL.toLowerCase()] || process.env.CLAUDE_MODEL)
  : "claude-sonnet-4-20250514";

export interface AgentResult {
  success: boolean;
  result?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUSD: number;
  };
}

const DEFAULT_SYSTEM_INSTRUCTION = `Minecraftサバイバルエージェント。自律的に行動。

## 利用可能スキル（get_agent_skill で詳細取得可能）

| 状況 | 推奨スキル |
|------|-----------|
| 夜を安全に過ごしたい | bed-crafting |
| 鉄を効率的に掘りたい | iron-mining |
| ダイヤを掘りたい | diamond-mining |
| ネザーに行きたい | nether-gate → nether-fortress |
| 装備を強化したい | enchanting, potion-brewing |
| 自動化したい | auto-farm, iron-golem-trap, mob-farm |
| 村人と取引したい | villager-trading |
| レッドストーン回路 | redstone-basics |
| エンドラ討伐 | ender-dragon |

詳細が必要なら: get_agent_skill { skill_name: "スキル名" }

## 基本ルール

### 毎ターン最初に
1. minecraft_get_surroundings で状況確認
2. minecraft_get_status でHP・空腹確認
3. minecraft_get_inventory で所持品確認

### 優先順位
1. **生存**: HP低い→食事/逃走、溺れ→上へ移動
2. **食料確保**: 空腹10以下→動物狩り/農作物
3. **装備強化**: 木→石→鉄→ダイヤ
4. **インフラ**: 拠点、農場、かまど

### 緊急時（最優先）
- **HP5以下** → 即逃走、食事
- **溺れ中** → pillar_up または上へ泳ぐ
- **敵に囲まれた** → flee → 安全確保後に食事

## チーム協調ツール（team_* ツール）

チームモード時に使用可能:
- team_join / team_leave: チームの参加・離脱
- team_task_list: タスク一覧確認
- team_task_claim: 未割り当てタスクを自分が取得
- team_task_complete: タスク完了報告
- team_task_create: 新タスク作成（リード推奨）
- team_message_read: 未読メッセージ確認
- team_message_send: 特定メンバーにDM
- team_message_broadcast: 全員にメッセージ

## 禁止事項
- 接続エラー時に別名を試さない
- HP低い状態で採掘継続しない
- 食料0で探索に出ない

出力: 簡潔に。`;


// Content block types
interface TextBlock {
  type: "text";
  text: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

type ContentBlock = TextBlock | ToolUseBlock | { type: string };

interface BufferedEvent {
  type: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * ClaudeClient using Agent SDK OAuth + MCP Bridge
 */
export class ClaudeClient extends EventEmitter {
  private config: ClaudeConfig;
  private env: Record<string, string>;
  private mcp: MCPWebSocketClientTransport | null = null;
  private eventBuffer: BufferedEvent[] = [];

  constructor(config: ClaudeConfig = {}) {
    super();
    this.config = {
      model: DEFAULT_MODEL,
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      maxTurns: 50,
      mcpServerUrl: "ws://localhost:8765",
      agentName: "Claude",
      ...config,
    };

    // Remove ANTHROPIC_API_KEY to use Claude Code OAuth
    const { ANTHROPIC_API_KEY, ...envWithoutApiKey } = process.env;
    this.env = envWithoutApiKey as Record<string, string>;

    // Pass MCP_WS_URL to bridge
    this.env.MCP_WS_URL = this.config.mcpServerUrl!;

    if (ANTHROPIC_API_KEY) {
      console.log(`${PREFIX} Removed ANTHROPIC_API_KEY to use Claude Code OAuth`);
    }
    console.log(`${PREFIX} Using Claude Code inherited authentication`);
    console.log(`${PREFIX} Model: ${this.config.model} (env CLAUDE_MODEL to change)`);

    // Initialize MCP transport for hooks
    this.initMCP();
  }

  /**
   * Initialize MCP WebSocket connection for hooks
   */
  private async initMCP(): Promise<void> {
    try {
      this.mcp = new MCPWebSocketClientTransport(this.config.mcpServerUrl!);
      await this.mcp.connect();
      console.log(`${PREFIX} MCP hook connection ready`);

      // Listen for game events pushed from server
      this.mcp.on("gameEvent", (event: { type: string; message: string; timestamp: number; data?: Record<string, unknown> }) => {
        const time = new Date(event.timestamp).toLocaleTimeString("ja-JP");
        console.log(`[Event] [${time}] ${event.type}: ${event.message}`);

        // Buffer events for next loop iteration
        this.eventBuffer.push(event);
        // Keep only last 20 events
        if (this.eventBuffer.length > 20) {
          this.eventBuffer.shift();
        }

        this.emit("gameEvent", event);
      });

      // Subscribe to events for this agent's bot
      // Wait a bit for the bot to connect first, then subscribe
      setTimeout(async () => {
        try {
          const agentName = this.config.agentName || "Claude";
          await this.mcp?.callTool("subscribe_events", { username: agentName });
          console.log(`${PREFIX} Subscribed to events for ${agentName}`);
        } catch (e) {
          console.error(`${PREFIX} Failed to subscribe to events:`, e);
        }
      }, 5000);
    } catch (error) {
      console.error(`${PREFIX} Failed to init MCP hook:`, error);
    }
  }

  /**
   * Create options for Agent SDK with MCP Bridge
   */
  private createOptions(): Options {
    return {
      // No built-in tools
      tools: [],

      // Use Claude Code OAuth
      env: this.env,

      // Route through MCP Bridge (stdio → WebSocket)
      mcpServers: {
        "minecraft-mcp": {
          command: "node",
          args: [MCP_BRIDGE_PATH],
          env: {
            MCP_WS_URL: this.config.mcpServerUrl!,
          },
        },
      },

      // Configuration
      model: this.config.model,
      systemPrompt: this.config.systemInstruction,
      maxTurns: this.config.maxTurns,

      // Load skills from project directory
      settingSources: ["project"],

      // Bypass permissions for MCP tools
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,

      // Include partial messages for streaming
      includePartialMessages: true,

      // Don't persist sessions
      persistSession: false,
    };
  }

  /**
   * Run a query with autonomous tool execution
   */
  async runQuery(prompt: string): Promise<AgentResult> {
    const options = this.createOptions();

    try {
      const queryResult = query({ prompt, options });

      let result: string | undefined;
      let usage: AgentResult["usage"] | undefined;
      let error: string | undefined;

      for await (const message of queryResult) {
        // Log assistant messages
        if (message.type === "assistant" && message.message.content) {
          const content = message.message.content as ContentBlock[];
          for (const block of content) {
            if (block.type === "text") {
              const text = (block as TextBlock).text;
              console.log(`${PREFIX} ${text}`);
              this.emit("text", text);
              // Log to board (truncate long messages)
              const shortText = text.length > 80 ? text.slice(0, 80) + "..." : text;
              this.logToBoard(`💭 ${shortText}`);
            } else if (block.type === "tool_use") {
              const toolBlock = block as ToolUseBlock;
              console.log(`${PREFIX} ${C.dim}Tool: ${toolBlock.name}${C.reset}`, toolBlock.input);
              this.emit("tool_use", toolBlock.name, toolBlock.input);
              // Log tool call to board
              const toolShort = toolBlock.name.replace("mcp__minecraft-mcp__", "");
              this.logToBoard(`🔧 ${toolShort}`);
            }
          }
        }

        // Capture result
        if (message.type === "result") {
          if (message.subtype === "success") {
            result = message.result;
            usage = {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
              costUSD: message.total_cost_usd,
            };
          } else {
            error = message.errors?.join(", ") || `Error: ${message.subtype}`;
          }
        }
      }

      return {
        success: !error,
        result,
        error,
        usage,
      };
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`${PREFIX} Error:`, errorMessage);
      this.emit("error", e);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Create a streaming query
   */
  createQuery(prompt: string): Query {
    const options = this.createOptions();
    return query({ prompt, options });
  }

  /**
   * Log a message to the board (fire and forget, non-blocking)
   */
  private logToBoard(message: string): void {
    if (!this.mcp) return;
    const agentName = this.config.agentName || "Claude";
    // Fire and forget - don't await
    this.mcp.callTool("agent_board_write", {
      agent_name: agentName,
      message,
    }).catch(() => {
      // Ignore errors for logging
    });
  }

  /**
   * Force write to agent board (called at end of each loop)
   */
  async forceBoardWrite(message: string): Promise<void> {
    if (!this.mcp) {
      console.error(`${PREFIX} Cannot write to board - MCP not connected`);
      return;
    }

    const agentName = this.config.agentName || "Claude";
    try {
      console.log(`${PREFIX} ${C.dim}Force writing to board: ${message}${C.reset}`);
      await this.mcp.callTool("agent_board_write", {
        agent_name: agentName,
        message: `[ループ終了] ${message}`,
      });
    } catch (error) {
      console.error(`${PREFIX} Failed to write to board:`, error);
    }
  }

  /**
   * Get buffered events and clear the buffer
   * Call this at the start of each loop to include events in prompt
   */
  getAndClearEvents(): BufferedEvent[] {
    const events = [...this.eventBuffer];
    this.eventBuffer = [];
    return events;
  }

  /**
   * Format buffered events as string for prompt injection
   */
  formatEventsForPrompt(): string {
    const events = this.getAndClearEvents();
    if (events.length === 0) {
      return "";
    }

    const lines = events.map((e) => {
      const time = new Date(e.timestamp).toLocaleTimeString("ja-JP");
      return `- [${time}] ${e.type}: ${e.message}`;
    });

    return `## 直近のゲームイベント（要確認）
${lines.join("\n")}

**重要**: 上記イベントを確認し、必要に応じて対応してください。
- health_changed/damaged → HPが低ければ食べるか逃げる
- hostile_spawn → 戦うか逃げるか判断`;
  }

  /**
   * Disconnect MCP hook connection
   */
  disconnect(): void {
    if (this.mcp) {
      this.mcp.close();
      this.mcp = null;
    }
  }
}
