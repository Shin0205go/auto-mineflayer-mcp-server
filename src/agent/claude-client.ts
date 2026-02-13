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

const DEFAULT_SYSTEM_INSTRUCTION = `あなたはMinecraftを自律的に操作するAIエージェント「Claude」です。

## 利用可能なツール（MCP経由）

### 接続・移動
- minecraft_connect: サーバーに接続
- minecraft_disconnect: 切断
- minecraft_get_position: 現在位置を確認
- minecraft_move_to: 指定座標に歩いて移動

### 状況確認（重要！毎ループ呼ぶ）
- minecraft_get_surroundings: **最重要！** 周囲の詳細情報（移動方向、光、危険、資源座標、敵、動物）
- minecraft_get_status: HP/空腹度を確認
- minecraft_get_events: ダメージ、敵スポーン等のイベントを取得
- minecraft_get_inventory: 持ち物確認

### サバイバル
- minecraft_dig_block: ブロックを掘る
- minecraft_place_block: ブロックを置く
- minecraft_collect_items: 近くのアイテムを拾う
- minecraft_get_inventory: インベントリを確認
- minecraft_craft: アイテムをクラフト
- minecraft_eat: 食べ物を食べる（空腹時に重要！）
- minecraft_equip_item: アイテムを装備

### 戦闘
- minecraft_fight: 敵と戦う（自動装備・攻撃・HP低下時逃走）

### コミュニケーション
- minecraft_chat: チャットを送信
- agent_board_read/write: 掲示板で他エージェントと連携

### 自己学習（重要！）
- log_experience: 重要な行動の結果を記録（成功・失敗問わず）
- get_recent_experiences: 過去の経験を振り返る
- reflect_and_learn: 経験からパターンを分析、改善点を抽出
- save_skill: 成功した手順をスキルとして保存
- get_skills: 保存したスキルを参照

### 場所記憶（重要！）
- remember_location: **作業台・かまど・チェスト・拠点を設置したら必ず記憶！**
- recall_locations: 保存した場所を思い出す（タイプや距離でフィルタ可能）
- forget_location: 不要な場所を削除

## 行動ルール
1. 接続は最初に一度だけ
2. **毎ターン最初にminecraft_get_surroundingsを呼ぶ！** 周囲状況を把握してから行動
3. minecraft_get_statusでHP/空腹を確認
4. 空腹度が低い（6以下）なら食べ物を食べる
5. HPが低い（10以下）なら安全な場所へ避難
6. 敵を見つけたらminecraft_fightで戦うか逃げる
7. 移動は歩いて行う（/tpコマンド禁止）
8. **採掘時は松明を作って設置！** 光レベル7以下はモブスポーン危険
9. **同じアプローチで3回失敗したら別の方法を試す！**
10. **重要な行動後はlog_experienceで記録！** 成功も失敗も学びになる
11. **10ループごとにreflect_and_learnで振り返り！**
12. **作業台・かまど・チェスト設置後は必ずremember_location！** 場所を忘れない

## 協調のヒント
- agent_board_readで他エージェントのメッセージを確認
- agent_board_writeで自分の状況や計画を共有

自律的に探索、採掘、建築を行い、サバイバルしてください。`;

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
      model: "claude-sonnet-4-20250514",
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      maxTurns: 100,
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
      console.log("[Claude] Removed ANTHROPIC_API_KEY to use Claude Code OAuth");
    }
    console.log("[Claude] Using Claude Code inherited authentication");

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
      console.log("[Claude] MCP hook connection ready");

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
          console.log(`[Claude] Subscribed to events for ${agentName}`);
        } catch (e) {
          console.error("[Claude] Failed to subscribe to events:", e);
        }
      }, 5000);
    } catch (error) {
      console.error("[Claude] Failed to init MCP hook:", error);
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
              console.log(`[Claude] ${text}`);
              this.emit("text", text);
              // Log to board (truncate long messages)
              const shortText = text.length > 80 ? text.slice(0, 80) + "..." : text;
              this.logToBoard(`💭 ${shortText}`);
            } else if (block.type === "tool_use") {
              const toolBlock = block as ToolUseBlock;
              console.log(`[Claude] Tool: ${toolBlock.name}`, toolBlock.input);
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
      console.error("[Claude] Error:", errorMessage);
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
      console.error("[Claude] Cannot write to board - MCP not connected");
      return;
    }

    const agentName = this.config.agentName || "Claude";
    try {
      console.log(`[Claude] Force writing to board: ${message}`);
      await this.mcp.callTool("agent_board_write", {
        agent_name: agentName,
        message: `[ループ終了] ${message}`,
      });
    } catch (error) {
      console.error("[Claude] Failed to write to board:", error);
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
