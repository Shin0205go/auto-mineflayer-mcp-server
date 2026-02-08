/**
 * Claude Agent Client
 *
 * Uses Claude Agent SDK for OAuth authentication.
 * Routes tool calls through MCP Bridge (stdio → WebSocket).
 */

import { query, type SDKMessage, type Query, type Options, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "events";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { MCPWebSocketClientTransport } from "./mcp-ws-transport.js";
import type { AgentConfig } from "../types/agent-config.js";

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
  toolCalls?: { tool: string; result: string; error?: string }[];
}

const DEFAULT_SYSTEM_INSTRUCTION = `Minecraftサバイバル司令官。スキルを使って行動する。

## アーキテクチャ
あなたは「司令官」です。直接行動するのではなく、スキル（専門サブエージェント）に委譲します。

使えるツール:
- minecraft_get_status: HP/空腹を確認（読み取り専用）
- minecraft_get_surroundings: 周囲の状況確認（読み取り専用）
- minecraft_get_inventory: 持ち物確認（読み取り専用）
- minecraft_get_equipment: 装備確認（読み取り専用）
- Task: スキルを発動（実際の行動はこれで行う）

## スキル一覧
Task toolで以下のスキルを発動:
- survival: 緊急対応（食事・戦闘・逃走・睡眠）
- exploration: 探索・移動
- iron-mining: 鉄採掘・精錬
- diamond-mining: ダイヤモンド採掘
- bed-crafting: ベッド作成
- nether-gate: ネザーポータル建設
- base-building: 拠点構築

## Task呼び出し例
description: "鉄を集める", prompt: "鉄鉱石を見つけて採掘し、精錬して鉄インゴットを5個集めて", subagent_type: "iron-mining"

## 判断フロー
1. get_status, get_surroundings で状況確認
2. 優先度判断:
   - HP≤10 or 敵近い → survival スキル
   - 夜 → bed-crafting or survival
   - 装備不足 → iron-mining or diamond-mining
   - 通常 → exploration or 目標に応じたスキル
3. Task で適切なスキルを発動
4. スキル完了後、再度状況確認

## ルール
- 直接dig/craft/moveはしない（スキルに任せる）
- 質問しない、選択肢を提示しない
- 簡潔に報告`;

/**
 * Build system prompt from AgentConfig
 * Converts personality, priorities, rules, thresholds into prompt text
 */
export function buildSystemPromptFromConfig(config: AgentConfig): string {
  // Sort priorities by weight (descending)
  const sortedPriorities = Object.entries(config.priorities)
    .sort(([, a], [, b]) => b - a)
    .map(([name, weight]) => `- ${name}: ${weight}`)
    .join("\n");

  // Format personality
  const personality = config.personality;
  const personalityText = [
    `攻撃性: ${personality.aggressiveness}/10`,
    `探索意欲: ${personality.explorationDrive}/10`,
    `資源収集: ${personality.resourceHoarding}/10`,
    `リスク許容: ${personality.riskTolerance}/10`,
  ].join("、");

  // Format decision rules
  const rulesText = config.decisionRules.length > 0
    ? config.decisionRules
        .map(r => `- [${r.priority}] ${r.condition} → ${r.action}`)
        .join("\n")
    : "（なし）";

  // Format thresholds
  const thresholds = config.thresholds;
  const thresholdsText = [
    `逃走HP: ${thresholds.fleeHP}`,
    `食事空腹度: ${thresholds.eatHunger}`,
    `夜行動開始: ${thresholds.nightShelterTime} tick`,
  ].join("、");

  return `Minecraftサバイバル司令官。スキルを使って行動する。

## アーキテクチャ
あなたは「司令官」です。直接行動するのではなく、スキル（専門サブエージェント）に委譲します。

使えるツール:
- minecraft_get_status: HP/空腹を確認（読み取り専用）
- minecraft_get_surroundings: 周囲の状況確認（読み取り専用）
- minecraft_get_inventory: 持ち物確認（読み取り専用）
- minecraft_get_equipment: 装備確認（読み取り専用）
- Task: スキルを発動（実際の行動はこれで行う）

## スキル一覧
Task toolで以下のスキルを発動:
- survival: 緊急対応（食事・戦闘・逃走・睡眠）
- exploration: 探索・移動
- iron-mining: 鉄採掘・精錬
- diamond-mining: ダイヤモンド採掘
- bed-crafting: ベッド作成
- nether-gate: ネザーポータル建設
- base-building: 拠点構築

## Task呼び出し例
description: "鉄を集める", prompt: "鉄鉱石を見つけて採掘し、精錬して鉄インゴットを5個集めて", subagent_type: "iron-mining"

## 性格特性
${personalityText}

## 行動優先度（重み順）
${sortedPriorities}

## 判断ルール
${rulesText}

## 閾値
${thresholdsText}

## 判断フロー
1. get_status, get_surroundings で状況確認
2. 優先度判断:
   - HP≤${thresholds.fleeHP} or 敵近い → survival スキル
   - 夜（${thresholds.nightShelterTime} tick以降） → bed-crafting or survival
   - 装備不足 → iron-mining or diamond-mining
   - 通常 → 優先度リストに従う
3. Task で適切なスキルを発動
4. スキル完了後、再度状況確認

## ルール
- 直接dig/craft/moveはしない（スキルに任せる）
- 質問しない、選択肢を提示しない
- 簡潔に報告`;
}

// Tool prefix for MCP tools (server name = "mineflayer")
const MCP_PREFIX = "mcp__mineflayer__";

// Common tool sets that skills can compose
const TOOL_SETS: Record<string, string[]> = {
  awareness: [
    "minecraft_get_status",
    "minecraft_get_surroundings",
    "minecraft_get_inventory",
    "minecraft_get_position",
  ],
  movement: [
    "minecraft_move_to",
    "minecraft_find_block",
  ],
  mining: [
    "minecraft_dig_block",
    "minecraft_tunnel",
    "minecraft_collect_items",
  ],
  crafting: [
    "minecraft_craft",
    "minecraft_check_infrastructure",
  ],
  building: [
    "minecraft_place_block",
  ],
  combat: [
    "minecraft_fight",
    "minecraft_attack",
    "minecraft_flee",
    "minecraft_get_nearby_entities",
  ],
  equipment: [
    "minecraft_equip_item",
  ],
  survival: [
    "minecraft_eat",
    "minecraft_sleep",
  ],
  smelting: [
    "minecraft_smelt",
  ],
  memory: [
    "save_memory",
    "recall_memory",
  ],
  skill: [
    "get_agent_skill",
  ],
};

// Skill definitions with specific tool access
const SKILL_DEFINITIONS: Record<string, {
  description: string;
  toolSets: string[];
  extraTools?: string[];
}> = {
  "iron-mining": {
    description: "鉄鉱石採掘・精錬。鉄装備が必要な時に使う。",
    toolSets: ["awareness", "movement", "mining", "crafting", "smelting", "equipment", "skill"],
  },
  "diamond-mining": {
    description: "ダイヤモンド採掘。Y=-59でブランチマイニング。",
    toolSets: ["awareness", "movement", "mining", "crafting", "equipment", "skill"],
    extraTools: ["minecraft_pillar_up"],
  },
  "bed-crafting": {
    description: "ベッド作成（羊狩り→羊毛→ベッド）。夜をスキップしたい時に使う。",
    toolSets: ["awareness", "movement", "mining", "crafting", "combat", "survival", "skill"],
  },
  "nether-gate": {
    description: "ネザーポータル建設（黒曜石採掘 or 鋳造）。",
    toolSets: ["awareness", "movement", "mining", "crafting", "building", "skill"],
    extraTools: ["minecraft_smelt"],
  },
  "survival": {
    description: "サバイバル基本行動（食事・戦闘・逃走・睡眠）。緊急時に使う。",
    toolSets: ["awareness", "movement", "combat", "survival", "equipment", "skill"],
  },
  "exploration": {
    description: "探索・移動。新しい場所を見つけたい時に使う。",
    toolSets: ["awareness", "movement", "mining", "memory", "skill"],
    extraTools: ["minecraft_pillar_up"],
  },
  "base-building": {
    description: "拠点構築（チェスト・かまど・作業台設置）。",
    toolSets: ["awareness", "movement", "mining", "crafting", "building", "memory", "skill"],
  },
};

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
      model: process.env.CLAUDE_MODEL || "haiku",
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
   * Main agent only has Task + minimal awareness tools
   * All action tools are hidden and only available through skill subagents
   */
  private createOptions(): Options {
    // Main agent only sees these tools (read-only awareness + Task)
    const mainAgentTools = [
      "Task",  // For invoking skill subagents
      `${MCP_PREFIX}minecraft_get_status`,      // HP/hunger check
      `${MCP_PREFIX}minecraft_get_surroundings`, // Environment awareness
      `${MCP_PREFIX}minecraft_get_inventory`,   // What do we have?
      `${MCP_PREFIX}minecraft_get_equipment`,   // What are we wearing?
    ];

    return {
      // Main agent tools - minimal awareness only
      tools: mainAgentTools,

      // Auto-allow these tools without permission prompts
      allowedTools: mainAgentTools,  // Only awareness + Task, no action tools

      // Use Claude Code OAuth
      env: this.env,

      // Route through MCP Bridge (stdio → WebSocket)
      mcpServers: {
        "mineflayer": {
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
   * Each skill only sees the tools it needs
   */
  private createSkillAgents(): Record<string, AgentDefinition> {
    const agents: Record<string, AgentDefinition> = {};

    for (const [skillName, skillDef] of Object.entries(SKILL_DEFINITIONS)) {
      // Build tool list from tool sets
      const tools: string[] = [];
      for (const setName of skillDef.toolSets) {
        const toolSet = TOOL_SETS[setName];
        if (toolSet) {
          for (const tool of toolSet) {
            const fullName = MCP_PREFIX + tool;
            if (!tools.includes(fullName)) {
              tools.push(fullName);
            }
          }
        }
      }
      // Add extra tools
      if (skillDef.extraTools) {
        for (const tool of skillDef.extraTools) {
          const fullName = MCP_PREFIX + tool;
          if (!tools.includes(fullName)) {
            tools.push(fullName);
          }
        }
      }

      agents[skillName] = {
        description: skillDef.description,
        prompt: `あなたは「${skillName}」スキルの専門エージェントです。

## 使えるツール
このスキルでは以下のツールのみ使用可能です:
${tools.map(t => "- " + t.replace(MCP_PREFIX, "")).join("\n")}

## 手順
1. get_agent_skill で "${skillName}" のスキル詳細を取得
2. スキルの手順に従って実行
3. 完了したら結果を報告

## 安全ルール
- HP≤5 → ツールがブロックされ「緊急中断」メッセージが返る
- 「緊急中断」を受けたら → eat/flee後、即座にスキル終了して報告
- 素材不足 → 報告して終了

スキル詳細を取得してください。`,
        tools: tools,  // Only these tools are visible to this skill
        model: "inherit",
      };
    }

    return agents;
  }

  /**
   * Update the system prompt (called when config changes)
   */
  updateSystemPrompt(prompt: string): void {
    this.config.systemInstruction = prompt;
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
      const toolCalls: { tool: string; result: string; error?: string }[] = [];

      for await (const message of queryResult) {
        // Track tool completions via tool_use_summary
        if (message.type === "tool_use_summary") {
          const summary = message as unknown as { toolName?: string; success?: boolean; error?: string; output?: string };
          if (summary.toolName) {
            const toolName = summary.toolName.replace(MCP_PREFIX, "");
            toolCalls.push({
              tool: toolName,
              result: summary.success ? "success" : "failure",
              error: summary.error || undefined,
            });
          }
          console.log(`${PREFIX} ${C.dim}[${message.type}]${C.reset}`, JSON.stringify(message).slice(0, 500));
        }

        // Debug: log tool progress
        if (message.type === "tool_progress") {
          console.log(`${PREFIX} ${C.dim}[${message.type}]${C.reset}`, JSON.stringify(message).slice(0, 500));
        }

        // Log assistant messages (main agent)
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
              const toolShort = toolBlock.name.replace(MCP_PREFIX, "");
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
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
   * Call a tool on the MCP server directly
   */
  async callMCPTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.mcp) {
      throw new Error("MCP not connected");
    }
    return this.mcp.callTool(name, args);
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
