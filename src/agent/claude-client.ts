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

const DEFAULT_SYSTEM_INSTRUCTION = `Minecraftサバイバルエージェント。完全自律で判断・行動する。

## 絶対ルール
- ユーザーに質問しない。選択肢を提示しない。自分で決めて即実行。
- 「何をしましょうか？」「どれがいいですか？」は禁止。
- 迷ったら安全優先で行動を選ぶ。

## 優先順位（上から順に判断）
1. 緊急: HP≤10→食事/flee、敵近い→戦闘/flee
2. 夜間: ベッドで寝る（なければ作る）
3. 装備: 持ってる最強装備を着る
4. 進行: エンチャント→ネザー→エンドの順で進める
5. 資源不足時: 必要素材を集める

## サブエージェント（Task tool）
複雑作業は委譲:
- iron-mining / diamond-mining / bed-crafting / nether-gate

## 行動パターン
- 状況確認→判断→即実行（報告は簡潔に）
- 装備後はget_surroundingsで装備確認

出力: 行動と結果のみ。質問禁止。`;


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
      model: "claude-opus-4-6",
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
      // Enable Task tool for subagent invocation
      tools: ["Task"],

      // Auto-allow Task and MCP tools without permission prompts
      allowedTools: ["Task", "mcp__minecraft-mcp__*"],

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

      // Skill-based subagents
      agents: this.createSkillAgents(),

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
   * Create skill-based subagent definitions
   * Subagents inherit MCP servers from parent automatically
   * Use 'tools' array to control which tools subagent can access
   */
  private createSkillAgents(): Record<string, {
    description: string;
    prompt: string;
    tools?: string[];
    model?: "sonnet" | "opus" | "haiku" | "inherit";
  }> {
    const skills = [
      { name: "iron-mining", description: "鉄鉱石採掘・精錬の専門家。鉄装備が必要な時に使う。" },
      { name: "diamond-mining", description: "ダイヤモンド採掘の専門家。ダイヤ装備が必要な時に使う。" },
      { name: "bed-crafting", description: "ベッド作成（羊毛収集含む）の専門家。夜をスキップしたい時に使う。" },
      { name: "nether-gate", description: "ネザーポータル建設の専門家。ネザーに行きたい時に使う。" },
      { name: "nether-fortress", description: "ネザー要塞探索の専門家。ブレイズロッドが必要な時に使う。" },
      { name: "enchanting", description: "エンチャント・XPファームの専門家。装備を強化したい時に使う。" },
      { name: "auto-farm", description: "自動農場建設の専門家。食料を自動化したい時に使う。" },
      { name: "mob-farm", description: "モブトラップ建設の専門家。経験値・ドロップを自動化したい時に使う。" },
      { name: "iron-golem-trap", description: "アイアンゴーレムトラップ建設の専門家。鉄を無限化したい時に使う。" },
      { name: "villager-trading", description: "村人取引・繁殖の専門家。エメラルドやレアアイテムが欲しい時に使う。" },
      { name: "potion-brewing", description: "ポーション醸造の専門家。バフポーションが必要な時に使う。" },
      { name: "redstone-basics", description: "レッドストーン回路の専門家。自動化装置を作りたい時に使う。" },
      { name: "ender-dragon", description: "エンダードラゴン討伐の専門家。エンドに行ってボスを倒したい時に使う。" },
    ];

    const agents: Record<string, {
      description: string;
      prompt: string;
      tools?: string[];
      model?: "sonnet" | "opus" | "haiku" | "inherit";
    }> = {};

    for (const skill of skills) {
      agents[skill.name] = {
        description: skill.description,
        prompt: `あなたは「${skill.name}」スキルの専門サブエージェントです。

## 最初にやること
1. mcp__minecraft-mcp__get_agent_skill で skill_name: "${skill.name}" のスキル詳細を取得
2. スキルの手順に従って実行

## 実行中のルール
- 毎ターン mcp__minecraft-mcp__minecraft_get_status でHP確認
- HP5以下なら即座に中断して報告
- 必要な素材が足りない場合は報告

## 完了条件
- スキルの目標を達成したら結果を報告して終了

では、まずスキル詳細を取得してください。`,
        // Inherit all tools from parent (including MCP tools)
        // By omitting 'tools', subagent gets access to all parent's tools
        model: "sonnet",
      };
    }

    return agents;
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
