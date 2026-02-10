/**
 * Agent Configuration Types
 *
 * Dev Agentが行動チューニングに使う設定の型定義。
 * agent-config.json で性格・優先度・閾値を管理し、
 * Game Agentのシステムプロンプトに反映する。
 */

export interface AgentConfig {
  version: number;
  lastUpdated: string;
  updatedBy: string;

  personality: {
    aggressiveness: number;    // 0-10: 戦闘に積極的か
    explorationDrive: number;  // 0-10: 探索に積極的か
    resourceHoarding: number;  // 0-10: 資源を溜め込むか
    riskTolerance: number;     // 0-10: リスクをどこまで許容するか
  };

  priorities: Record<string, number>;  // survival:100, food:80, ...

  thresholds: {
    fleeHP: number;           // このHP以下で逃走
    eatHunger: number;        // この空腹度以下で食事
    nightShelterTime: number; // この時刻で夜の行動開始
  };
}

export interface LoopResult {
  id: string;
  loopNumber: number;
  timestamp: number;
  success: boolean;
  summary: string;
  toolCalls: { tool: string; result: string; error?: string }[];
  status: { hp: number; food: number; position: number[] };
  usage?: { inputTokens: number; outputTokens: number; costUSD: number };
  intent?: string;
}

export interface EvolutionEntry {
  timestamp: string;
  configVersion: number;
  changes: ConfigChange[];
  analysis: string;
}

export interface ConfigChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
}
