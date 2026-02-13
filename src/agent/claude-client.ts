/**
 * Claude Agent Client
 *
 * Uses Claude Agent SDK for OAuth authentication.
 * Routes tool calls through MCP Bridge (stdio → WebSocket).
 */

import { query, type Query, type Options, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
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

## 判断フロー（状況適応型）
1. **必ず最初に**: get_status, get_surroundings で現在の状態を確認
2. **状況分析**: 以下の危機度を判定
   - 【緊急】HP≤10 or Food≤5 or 敵2体以上近接 → survival スキル（即座）
   - 【警戒】HP≤15 or Food≤10 or 夜+敵接近 → 現タスク中断、survival優先
   - 【注意】Food≤15 → 装備/探索の合間に食料確保を検討
   - 【通常】上記以外 → 目標に応じたスキル選択
3. 危機度に応じてTask発動（低優先度タスクは中断可）
4. スキル完了後、状況を再評価

## 最終目標：エンダードラゴン討伐

あなた自身で計画を立て、実行してください:

1. **タスク管理ツールを使う**
   - TaskCreate: 必要なタスクを自分で定義
   - TaskUpdate: 進捗を記録 (pending/in_progress/completed)
   - TaskList: 現在のタスクを確認

2. **自律的な計画**
   - agent_board_read で目標確認
   - 現在の状況から次に何をすべきか判断
   - 長期目標（ドラゴン討伐）に向けた中間目標を設定
   - 行き詰まったら計画を見直す

3. **階層的実行**
   - 複雑な作業はTask tool + スキルに委譲
   - 直接的なdig/craft/moveは避ける

## ルール
- 自分でTODOを考え、管理する
- 質問しない、選択肢を提示しない
- 掲示板に重要な判断を記録
- 簡潔に報告`;

/**
 * Build system prompt from AgentConfig
 * Converts personality, priorities, rules, thresholds into prompt text
 */
export function buildSystemPromptFromConfig(
  config: AgentConfig,
  connectionParams?: { host: string; port: number; username: string }
): string {
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

  // Format thresholds
  const thresholds = config.thresholds;
  const thresholdsText = [
    `逃走HP: ${thresholds.fleeHP}`,
    `食事空腹度: ${thresholds.eatHunger}`,
    `夜行動開始: ${thresholds.nightShelterTime} tick`,
  ].join("、");

  // Connection parameters text
  const connectionText = connectionParams
    ? `host="${connectionParams.host}", port=${connectionParams.port}, username="${connectionParams.username}"`
    : `指定されたパラメータを使用`;

  return `自律的にタスクを管理・実行するエージェント。

## 設定
性格: ${personalityText}
優先度: ${sortedPriorities}
閾値: ${thresholdsText}

## 利用可能なツール

【状態確認・通信】
- minecraft_get_state: 統合状態取得（位置・HP・空腹・インベントリ・周囲・エンティティ・バイオームを一括取得）
- minecraft_chat, minecraft_get_chat_messages
※接続は自動管理（手動接続不要）

【高レベル操作（推奨）】
- minecraft_gather_resources: 自動リソース収集
- minecraft_build_structure: 構造物建築
- minecraft_craft_chain: 複数段階クラフト（精錬も自動実行）
- minecraft_enchant_item: アイテムエンチャント（エンチャントテーブル必要）
- minecraft_brew_potion: ポーション醸造（醸造台・材料・blaze powder必要）
- minecraft_survival_routine: サバイバル最適化
- minecraft_explore_area: エリア探索

【基本操作（高レベルツールが使えない場合のみ）】
- minecraft_craft: 単一アイテムクラフト
- minecraft_smelt: 精錬
- minecraft_check_infrastructure: クラフト台・かまど検索

【記憶・連携】
- save_memory, recall_memory, log_experience, get_recent_experiences
- agent_board_write, agent_board_read, agent_board_wait

【スキルシステム（複雑な作業に推奨）】
- list_agent_skills: 利用可能なスキル一覧
- get_agent_skill: スキル詳細取得

主要スキル: resource-gathering, building, crafting-chain, survival, exploration, iron-mining, diamond-mining, bed-crafting, nether-gate など

## 行動方針
1. 状態確認（minecraft_get_state）
2. **高レベルツールまたはスキル**で行動
   - 単純な作業: 高レベルツール直接実行
   - 複雑な作業: スキルに委譲
3. 閾値を超えたら優先行動
4. 重要な判断は save_memory と agent_board_write で記録

## 食料確保の重要性
**食料は生存の最重要リソース**。空腹度が低下すると採掘・探索・戦闘が不可能になる。

- **近くに食料なし → 遠くまで探索必須**
  - 32ブロック範囲で動物が見つからない場合、128ブロック以上の探索が必要
  - minecraft_explore_area で半径100〜200ブロックの広範囲探索を実行
  - survival routine が失敗したら、より広範囲の exploration に切り替え

- **食料源の優先度**
  1. 動物（羊・牛・豚・鶏）- 最も確実
  2. 植物（小麦・ビートルート・ニンジン・ジャガイモ）- 村で発見可能
  3. 釣り - 水辺があれば最終手段

- **空腹度管理**
  - 15以下: 食料確保を計画開始
  - 10以下: 他の作業を中断して食料優先
  - 5以下: 緊急事態、即座に広範囲探索

## サバイバル基本要素（初期フェーズの優先順位）

**Minecraftサバイバルの3大基本:**

1. **🛏️ ベッド作成（最優先）**
   - 夜をスキップして危険回避
   - リスポーン地点を設定
   - スキル: bed-crafting（羊狩り→羊毛→ベッド）
   - **羊が見つからない場合**: 村を探索してベッドを入手
   - 状況: ベッドなし & 夜が近い → 即座に実行

2. **🏠 シェルター建設（重要）**
   - 夜間の敵モブから保護
   - 作業拠点として機能
   - スキル: building（シェルター建設）
   - 最低限: 4x4の囲いと屋根、ドア、松明
   - save_memory でシェルター位置を記録

3. **📦 チェスト作成（基本インフラ）**
   - インベントリ満杯を防ぐ
   - 貴重品（ダイヤ・鉄）を安全に保管
   - クラフト: 木材8個 → チェスト
   - 複数設置して分類保管（資源用・装備用・食料用）
   - チェスト位置を save_memory で記録

**初期行動の推奨順序:**
1. 木材収集（道具・松明・チェスト用）
2. 作業台作成
3. 木のツール作成（斧・ピッケル）
4. 石炭採掘 or 木炭作成（松明用）
5. シェルター建設 or 洞窟確保
6. チェスト設置
7. ベッド作成（羊探し or 村探索）
8. 石ツール → 鉄採掘へ進化

**記憶の活用:**
- シェルター座標: save_memory (type: "location", locationType: "base")
- チェスト位置: save_memory (type: "location", locationType: "chest")
- ベッド位置: save_memory (type: "location", locationType: "bed")

`;
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
  tasks: [
    "task_create",
    "task_list",
    "task_get",
    "task_update",
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
    // Main agent only sees these tools (awareness + coordination + Task)
    // IMPORTANT: Must use full MCP tool names (mcp__server__tool)
    const mainAgentTools = [
      "Task",  // For invoking skill subagents
      // Connection
      "mcp__mineflayer__minecraft_connect",
      "mcp__mineflayer__minecraft_disconnect",
      "mcp__mineflayer__minecraft_chat",
      // Awareness
      "mcp__mineflayer__minecraft_get_status",
      "mcp__mineflayer__minecraft_get_position",
      "mcp__mineflayer__minecraft_get_surroundings",
      "mcp__mineflayer__minecraft_get_inventory",
      "mcp__mineflayer__minecraft_get_equipment",
      // Coordination
      "mcp__mineflayer__agent_board_read",
      "mcp__mineflayer__agent_board_write",
      "mcp__mineflayer__list_agent_skills",
      "mcp__mineflayer__get_agent_skill",
      // Memory
      "mcp__mineflayer__save_memory",
      "mcp__mineflayer__recall_memory",
      "mcp__mineflayer__log_experience",
      "mcp__mineflayer__get_recent_experiences",
      // Task Management
      "mcp__mineflayer__task_create",
      "mcp__mineflayer__task_list",
      "mcp__mineflayer__task_get",
      "mcp__mineflayer__task_update",
    ];

    return {
      // Main agent tools - minimal awareness only
      tools: mainAgentTools,

      // Allow all MCP tools without prompts (tools param already restricts)
      allowedTools: ["Task", "mcp__mineflayer__*"],

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

      // Bypass permissions - tools param handles restriction
      permissionMode: "bypassPermissions",

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
