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
- minecraft_connect: サーバーに接続
- minecraft_disconnect: 切断
- minecraft_get_position: 現在位置を確認
- minecraft_move_to: 指定座標に歩いて移動（pathfinder使用）
- minecraft_look_around: 周囲のブロックをスキャン
- minecraft_dig_block: ブロックを掘る
- minecraft_place_block: ブロックを置く（4.5ブロック以内）
- minecraft_collect_items: 近くのアイテムを拾う
- minecraft_get_inventory: インベントリを確認
- minecraft_craft: アイテムをクラフト
- minecraft_chat: チャットを送信
- agent_board_read/write: 掲示板で他エージェントと連携

## 行動ルール
1. 接続は最初に一度だけ
2. 移動は歩いて行う（/tpコマンド禁止）
3. 周囲を確認してから行動する
4. 掲示板を確認して、他のエージェント（Gemini等）と協力する

## 協調のヒント
- agent_board_readで他エージェントのメッセージを確認
- agent_board_writeで自分の状況や計画を共有
- 「Claude」という名前で書き込む

自律的に探索、採掘、建築を行ってください。`;

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

/**
 * ClaudeClient using Agent SDK OAuth + MCP Bridge
 */
export class ClaudeClient extends EventEmitter {
  private config: ClaudeConfig;
  private env: Record<string, string>;

  constructor(config: ClaudeConfig = {}) {
    super();
    this.config = {
      model: "claude-sonnet-4-20250514",
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      maxTurns: 20,
      mcpServerUrl: "ws://localhost:8765",
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
              console.log(`[Claude] ${(block as TextBlock).text}`);
              this.emit("text", (block as TextBlock).text);
            } else if (block.type === "tool_use") {
              const toolBlock = block as ToolUseBlock;
              console.log(`[Claude] Tool: ${toolBlock.name}`, toolBlock.input);
              this.emit("tool_use", toolBlock.name, toolBlock.input);
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
}
