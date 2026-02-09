/**
 * Stability Control System Types
 *
 * 制御理論的アプローチでシステムの安定性を管理する
 * - 外乱（Disturbance） = Minecraftイベント
 * - システム = Game Agent + ツール群
 * - 制御器 = Dev Agent
 * - 目標 = 安定状態の維持・回復
 */

export interface SystemState {
  timestamp: number;
  health: number;           // HP [0-20]
  hunger: number;           // 空腹度 [0-20]
  position: {
    x: number;
    y: number;
    z: number;
  };
  nearbyHostiles: number;   // 近くの敵の数
  hasWeapon: boolean;       // 武器を持っているか
  timeOfDay: number;        // ゲーム内時刻
  inventoryCount: number;   // アイテム数
}

export interface StabilityZone {
  name: string;
  health: [number, number];    // 範囲 [min, max]
  hunger: [number, number];
  nearbyHostiles: number;      // 最大数
  isStable: boolean;           // この領域は安定か
}

export interface DisturbanceEvent {
  id: string;
  type: 'hostile_spawn' | 'damaged' | 'health_changed' | 'time_night' | 'time_dusk' | 'death' | 'entity_gone' | 'block_broken' | 'item_collected';
  timestamp: number;
  severity: number;            // 0-10: 深刻度
  username: string;            // どのボットか
  stateBefore: SystemState;
  details?: Record<string, unknown>;
}

export interface DisturbanceResponse {
  disturbanceId: string;
  disturbance: DisturbanceEvent;
  actions: {
    tool: string;
    timestamp: number;
    success: boolean;
    duration: number;
    error?: string;
  }[];
  stateAfter: SystemState | null;

  // 制御指標
  settlementTime: number | null;  // 安定化時間（ms）、nullは安定化失敗
  overshoot: boolean;             // 過剰反応があったか
  stabilized: boolean;            // 安定状態に戻れたか
  energyCost: number;             // コスト（ツール呼び出し回数）
}

export interface StabilityMetrics {
  disturbanceType: string;
  totalCount: number;
  stabilizationRate: number;      // 安定化成功率 [0-1]
  avgSettlementTime: number;      // 平均安定化時間（ms）
  avgEnergyCost: number;          // 平均コスト
  overshootRate: number;          // 過剰反応率 [0-1]
  lastUpdated: number;
}

// 安定領域の定義
export const STABILITY_ZONES: StabilityZone[] = [
  {
    name: "Safe & Healthy",
    health: [15, 20],
    hunger: [15, 20],
    nearbyHostiles: 0,
    isStable: true
  },
  {
    name: "Moderate",
    health: [10, 14],
    hunger: [10, 14],
    nearbyHostiles: 0,
    isStable: true
  },
  {
    name: "Under Threat",
    health: [10, 20],
    hunger: [10, 20],
    nearbyHostiles: 1,
    isStable: false  // 遷移状態
  },
  {
    name: "Critical",
    health: [0, 9],
    hunger: [0, 9],
    nearbyHostiles: 0,
    isStable: false
  },
  {
    name: "Danger",
    health: [0, 20],
    hunger: [0, 20],
    nearbyHostiles: 2,
    isStable: false
  }
];

// 外乱の深刻度を計算
export function calculateSeverity(eventType: string, details?: Record<string, unknown>): number {
  switch (eventType) {
    case 'death':
      return 10;  // 最も深刻
    case 'damaged':
      return 7;
    case 'hostile_spawn':
      return 6;
    case 'time_night':
      return 4;
    case 'health_changed':
      return 3;
    case 'time_dusk':
      return 2;
    case 'entity_gone':
    case 'block_broken':
    case 'item_collected':
      return 1;
    default:
      return 0;
  }
}

// 状態が安定領域にあるか判定
export function isInStabilityZone(state: SystemState): StabilityZone | null {
  for (const zone of STABILITY_ZONES) {
    const healthOk = state.health >= zone.health[0] && state.health <= zone.health[1];
    const hungerOk = state.hunger >= zone.hunger[0] && state.hunger <= zone.hunger[1];
    const threatsOk = state.nearbyHostiles <= zone.nearbyHostiles;

    if (healthOk && hungerOk && threatsOk) {
      return zone;
    }
  }
  return null;
}

// 安定状態かどうか
export function isStable(state: SystemState): boolean {
  const zone = isInStabilityZone(state);
  return zone?.isStable ?? false;
}

// ========== Eigenmode Analysis (Conceptual) ==========

/**
 * FailureMode: システム生物学の「固有モード」の概念的実装
 *
 * - pattern: 失敗パターン（例："hostile_spawn", "hunger_depletion"）
 * - pseudoEigenvalue: 回復速度の指標
 *   - 正の値 → 不安定（発散傾向、悪化する）
 *   - 負の値 → 安定（収束傾向、自然回復する）
 *   - 値が大きいほど不安定性が強い
 * - dominantVariable: このモードで支配的な状態変数
 *   - 固有ベクトルに相当：どの変数を修正すべきか
 * - convergenceRate: 収束速度（-pseudoEigenvalue）
 */
export interface FailureMode {
  pattern: string;                // 失敗パターン
  pseudoEigenvalue: number;       // 疑似固有値（正=不安定、負=安定）
  dominantVariable: string;       // 支配的な状態変数（例："combat_ability", "food_management"）
  failureCount: number;           // このモードでの失敗回数
  averageRecoveryTime: number;    // 平均回復時間（ms）
  oscillatory: boolean;           // 振動的か（繰り返し失敗するか）
}

/**
 * 疑似固有値を計算
 *
 * 経験的な指標：
 * - 失敗率が高い → 正の固有値（不安定）
 * - 回復が遅い → 絶対値が小さい（収束が遅い）
 * - 繰り返し失敗 → 虚部がある（振動的）
 */
export function computePseudoEigenvalue(
  failureRate: number,      // 0-1
  recoveryTime: number,     // ms
  oscillatory: boolean
): number {
  // 失敗率が50%を超えると正（不安定）
  const base = (failureRate - 0.5) * 2;  // -1 to 1

  // 回復時間で正規化（遅いほど絶対値が小さい）
  const normalized = base / (1 + recoveryTime / 10000);

  return normalized;
}

/**
 * 支配的な状態変数を特定
 *
 * 失敗パターンから、どの能力/システムが問題かを推定
 */
export function identifyDominantVariable(disturbanceType: string, actions: string[]): string {
  // 外乱タイプから推定
  const variableMap: Record<string, string> = {
    'hostile_spawn': 'combat_ability',
    'damaged': 'defense_system',
    'death': 'survival_strategy',
    'health_changed': 'health_management',
    'time_night': 'night_adaptation',
  };

  const variable = variableMap[disturbanceType] || 'general_response';

  // 使用されたツールから詳細化
  const hasFight = actions.includes('minecraft_fight') || actions.includes('minecraft_attack');
  const hasFlee = actions.includes('minecraft_flee');
  const hasEat = actions.includes('minecraft_eat');

  if (disturbanceType === 'hostile_spawn') {
    if (hasFlee) return 'escape_strategy';
    if (hasFight) return 'combat_effectiveness';
  }

  if (disturbanceType === 'health_changed') {
    return 'food_management';
  }

  return variable;
}
