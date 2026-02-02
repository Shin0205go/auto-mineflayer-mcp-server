/**
 * Tool Execution Log Types
 *
 * ツール実行のログを記録し、Dev Agentによる自己改善に使用する
 */

export interface ToolExecutionLog {
  id: string;
  timestamp: number;

  // ツール情報
  tool: string;
  input: Record<string, unknown>;

  // 結果
  result: "success" | "failure" | "timeout";
  output?: unknown;
  error?: string;
  duration: number;  // ms

  // 実行時コンテキスト
  context: ToolExecutionContext;

  // メタデータ
  agentName: string;
  loopCount?: number;
}

export interface ToolExecutionContext {
  // ボット状態
  hp?: number;
  food?: number;
  position?: [number, number, number];

  // インベントリ（主要アイテムのみ）
  inventory?: InventorySummary[];

  // 環境
  biome?: string;
  timeOfDay?: "day" | "night";
  nearbyEntities?: EntitySummary[];

  // 直前のイベント
  recentEvents?: string[];
}

export interface InventorySummary {
  name: string;
  count: number;
}

export interface EntitySummary {
  type: string;
  distance: number;
  isHostile: boolean;
}

/**
 * 失敗パターン分析結果
 */
export interface FailurePattern {
  tool: string;
  pattern: string;           // "low_hp_combat", "missing_materials", etc.
  occurrences: number;
  examples: ToolExecutionLog[];
  suggestedFix?: string;
  affectedFile?: string;     // "src/tools/combat.ts"
  affectedCode?: string;     // 修正すべきコード断片
}

/**
 * 改善提案
 */
export interface ImprovementSuggestion {
  id: string;
  timestamp: number;

  // 問題
  pattern: FailurePattern;

  // 提案
  description: string;
  filePath: string;
  currentCode: string;
  suggestedCode: string;

  // ステータス
  status: "proposed" | "approved" | "applied" | "rejected";
  appliedAt?: number;
  result?: "improved" | "no_change" | "worse";
}

/**
 * Dev Agentへの通知イベント
 */
export interface DevAgentNotification {
  type: "tool_log" | "failure_detected" | "improvement_suggested" | "build_requested";
  payload: ToolExecutionLog | FailurePattern | ImprovementSuggestion | BuildRequest;
}

export interface BuildRequest {
  reason: string;
  changedFiles: string[];
  requestedBy: string;
}
