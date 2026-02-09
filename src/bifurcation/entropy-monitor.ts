/**
 * Phase Space Observer - 位相空間の観測
 *
 * ツール実行ログ・ゲームイベント・環境状態から
 * 位相空間上の座標（PhasePoint）を生成する。
 *
 * 「エントロピー監視」というより「系の状態の知覚器官」。
 * 生物学アナロジー: 感覚ニューロンの集合。
 * 外部環境を多次元の信号に変換する。
 */

import type {
  PhasePoint,
  PhaseSpaceInput,
  PhaseDimension,
  BifurcationConfig,
} from "../types/bifurcation.js";
import type { ToolExecutionLog } from "../types/tool-log.js";

/** 計測ウィンドウ（直近のログを集計する期間、ms） */
const MEASUREMENT_WINDOW = 5 * 60 * 1000; // 5分

/**
 * デフォルトの位相空間次元定義
 *
 * 各次元は [0, 1] に正規化される。
 * 次元名はヒントであり、系の挙動には直接影響しない。
 */
const DEFAULT_DIMENSIONS: PhaseDimension[] = [
  { name: "tool_failure_rate",   min: 0, max: 1 },
  { name: "tool_diversity",      min: 0, max: 30 },    // ユニークツール数
  { name: "tool_throughput",     min: 0, max: 100 },   // 5分間のツール呼び出し数
  { name: "repeated_failures",   min: 0, max: 10 },
  { name: "exploration_radius",  min: 0, max: 500 },   // ブロック
  { name: "combat_frequency",    min: 0, max: 1 },
  { name: "crafting_frequency",  min: 0, max: 1 },
  { name: "building_frequency",  min: 0, max: 1 },
  { name: "inventory_diversity", min: 0, max: 30 },    // ユニークアイテム数
  { name: "resource_surplus",    min: 0, max: 1 },
  { name: "health_stability",    min: 0, max: 1 },
  { name: "death_frequency",     min: 0, max: 5 },     // 5分間の死亡数
  { name: "demand_rate",         min: 0, max: 10 },    // 指示/分
  { name: "demand_complexity",   min: 0, max: 1 },
  { name: "agent_count",         min: 1, max: 10 },
  { name: "message_rate",        min: 0, max: 20 },    // メッセージ/分
];

/** ツールカテゴリ分類（行動パターン計測用） */
const COMBAT_TOOLS = ["minecraft_fight", "minecraft_attack", "minecraft_flee"];
const CRAFTING_TOOLS = ["minecraft_craft", "minecraft_smelt", "minecraft_equip_item"];
const BUILDING_TOOLS = [
  "minecraft_place_block", "minecraft_build_structure",
  "minecraft_build_road", "minecraft_build_village",
];
const MOVEMENT_TOOLS = ["minecraft_move_to", "minecraft_explore_for_biome"];

export class PhaseSpaceObserver {
  private dimensions: PhaseDimension[];

  /** ツール実行ログの参照（外部から注入） */
  private toolLogs: ToolExecutionLog[] = [];

  /** 位置履歴（exploration radius計測用） */
  private positionHistory: { x: number; y: number; z: number; timestamp: number }[] = [];

  /** 死亡イベントの記録 */
  private deathTimestamps: number[] = [];

  /** HP履歴（stability計測用） */
  private healthHistory: { hp: number; timestamp: number }[] = [];

  /** 人間の指示の記録 */
  private instructionTimestamps: number[] = [];
  private instructionComplexities: number[] = [];

  /** 協調状態 */
  private agentCount: number = 1;
  private boardMessageTimestamps: number[] = [];

  constructor(config?: Partial<BifurcationConfig>) {
    this.dimensions = config?.dimensions || DEFAULT_DIMENSIONS;
  }

  /** 位相空間の次元数 */
  get dimensionCount(): number {
    return this.dimensions.length;
  }

  /** 次元定義を取得 */
  getDimensions(): PhaseDimension[] {
    return [...this.dimensions];
  }

  /**
   * ツール実行ログ配列への参照を設定
   */
  setToolLogSource(logs: ToolExecutionLog[]): void {
    this.toolLogs = logs;
  }

  /**
   * 位置を記録（exploration radius計測用）
   */
  recordPosition(x: number, y: number, z: number): void {
    const now = Date.now();
    this.positionHistory.push({ x, y, z, timestamp: now });
    this.pruneOld(this.positionHistory, now);
  }

  /**
   * 死亡を記録
   */
  recordDeath(): void {
    const now = Date.now();
    this.deathTimestamps.push(now);
    this.pruneOldTimestamps(this.deathTimestamps, now);
  }

  /**
   * HPを記録
   */
  recordHealth(hp: number): void {
    const now = Date.now();
    this.healthHistory.push({ hp, timestamp: now });
    this.pruneOld(this.healthHistory, now);
  }

  /**
   * 人間の指示を記録
   */
  recordInstruction(complexity: number = 0.5): void {
    const now = Date.now();
    this.instructionTimestamps.push(now);
    this.instructionComplexities.push(Math.max(0, Math.min(1, complexity)));
    this.pruneOldTimestamps(this.instructionTimestamps, now);
    // complexitiesは同期して刈り込む
    while (this.instructionComplexities.length > this.instructionTimestamps.length) {
      this.instructionComplexities.shift();
    }
  }

  /**
   * エージェント数を更新
   */
  setAgentCount(count: number): void {
    this.agentCount = Math.max(1, count);
  }

  /**
   * 掲示板メッセージを記録
   */
  recordBoardMessage(): void {
    const now = Date.now();
    this.boardMessageTimestamps.push(now);
    this.pruneOldTimestamps(this.boardMessageTimestamps, now);
  }

  /**
   * 現在の位相空間座標を計測する
   *
   * 生データを集計し、各次元を [0, 1] に正規化して PhasePoint を生成。
   */
  observe(): PhasePoint {
    const now = Date.now();
    const input = this.gatherInput(now);
    const coordinates = this.normalize(input);

    return {
      coordinates,
      timestamp: now,
      rawInput: input,
    };
  }

  // ========== Internal: 生データ集計 ==========

  private gatherInput(now: number): PhaseSpaceInput {
    const windowStart = now - MEASUREMENT_WINDOW;
    const recentLogs = this.toolLogs.filter(l => l.timestamp > windowStart);

    // ツール使用パターン
    const totalCalls = recentLogs.length;
    const failureLogs = recentLogs.filter(l => l.result === "failure");
    const toolFailureRate = totalCalls > 0 ? failureLogs.length / totalCalls : 0;
    const uniqueTools = new Set(recentLogs.map(l => l.tool));
    const toolDiversity = uniqueTools.size;
    const toolThroughput = totalCalls;
    const repeatedFailures = this.countRepeatedFailures(recentLogs);

    // 行動パターン（ツールカテゴリ別の使用率）
    const combatCalls = recentLogs.filter(l => COMBAT_TOOLS.includes(l.tool)).length;
    const craftingCalls = recentLogs.filter(l => CRAFTING_TOOLS.includes(l.tool)).length;
    const buildingCalls = recentLogs.filter(l => BUILDING_TOOLS.includes(l.tool)).length;

    const combatFrequency = totalCalls > 0 ? combatCalls / totalCalls : 0;
    const craftingFrequency = totalCalls > 0 ? craftingCalls / totalCalls : 0;
    const buildingFrequency = totalCalls > 0 ? buildingCalls / totalCalls : 0;

    // 探索半径: 最近の位置のばらつき
    const recentPositions = this.positionHistory.filter(p => p.timestamp > windowStart);
    const explorationRadius = this.calcExplorationRadius(recentPositions);

    // 資源状態: 最近のインベントリ情報からの推定
    const lastLogWithInventory = [...recentLogs]
      .reverse()
      .find(l => l.context?.inventory && l.context.inventory.length > 0);
    const inventoryDiversity = lastLogWithInventory?.context?.inventory?.length || 0;
    const resourceSurplus = this.estimateResourceSurplus(lastLogWithInventory);

    // 生存指標
    const healthStability = this.calcHealthStability(windowStart);
    const recentDeaths = this.deathTimestamps.filter(t => t > windowStart);
    const deathFrequency = recentDeaths.length;

    // 外部圧力
    const recentInstructions = this.instructionTimestamps.filter(t => t > windowStart);
    const demandRate = recentInstructions.length / (MEASUREMENT_WINDOW / 60000);
    const recentComplexities = this.instructionComplexities.slice(
      -(recentInstructions.length || 1)
    );
    const demandComplexity = recentComplexities.length > 0
      ? recentComplexities.reduce((a, b) => a + b, 0) / recentComplexities.length
      : 0;

    // 協調状態
    const recentBoardMessages = this.boardMessageTimestamps.filter(t => t > windowStart);
    const messageRate = recentBoardMessages.length / (MEASUREMENT_WINDOW / 60000);

    return {
      toolFailureRate,
      toolDiversity,
      toolThroughput,
      repeatedFailures,
      explorationRadius,
      combatFrequency,
      craftingFrequency,
      buildingFrequency,
      inventoryDiversity,
      resourceSurplus,
      healthStability,
      deathFrequency,
      demandRate,
      demandComplexity,
      agentCount: this.agentCount,
      messageRate,
    };
  }

  // ========== Internal: 正規化 ==========

  /**
   * 生データを位相空間の [0, 1] 座標に正規化
   */
  private normalize(input: PhaseSpaceInput): number[] {
    const values: number[] = [
      input.toolFailureRate,
      input.toolDiversity,
      input.toolThroughput,
      input.repeatedFailures,
      input.explorationRadius,
      input.combatFrequency,
      input.craftingFrequency,
      input.buildingFrequency,
      input.inventoryDiversity,
      input.resourceSurplus,
      input.healthStability,
      input.deathFrequency,
      input.demandRate,
      input.demandComplexity,
      input.agentCount,
      input.messageRate,
    ];

    return values.map((v, i) => {
      const dim = this.dimensions[i];
      if (!dim) return 0;
      const range = dim.max - dim.min;
      if (range === 0) return 0;
      return Math.max(0, Math.min(1, (v - dim.min) / range));
    });
  }

  // ========== Internal: ヘルパー ==========

  private countRepeatedFailures(logs: ToolExecutionLog[]): number {
    let count = 0;
    const sorted = [...logs].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 1; i < sorted.length; i++) {
      if (
        sorted[i].result === "failure" &&
        sorted[i - 1].result === "failure" &&
        sorted[i].tool === sorted[i - 1].tool
      ) {
        count++;
      }
    }
    return count;
  }

  private calcExplorationRadius(positions: { x: number; y: number; z: number }[]): number {
    if (positions.length < 2) return 0;

    // 重心からの平均距離
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length;

    const avgDist = positions.reduce((s, p) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      return s + Math.sqrt(dx * dx + dz * dz);
    }, 0) / positions.length;

    return avgDist;
  }

  private estimateResourceSurplus(log: ToolExecutionLog | undefined): number {
    if (!log?.context?.inventory) return 0;
    const totalItems = log.context.inventory.reduce((s, i) => s + i.count, 0);
    // 64スタック以上あれば余剰と見なす（0-1正規化）
    return Math.min(totalItems / 256, 1);
  }

  private calcHealthStability(windowStart: number): number {
    const recent = this.healthHistory.filter(h => h.timestamp > windowStart);
    if (recent.length < 2) return 1; // データ不足は安定とみなす

    // HPの分散が小さいほど安定
    const mean = recent.reduce((s, h) => s + h.hp, 0) / recent.length;
    const variance = recent.reduce((s, h) => s + (h.hp - mean) ** 2, 0) / recent.length;
    const stddev = Math.sqrt(variance);

    // stddev=0 → 完全安定 (1.0)、stddev=10 → 不安定 (0.0)
    return Math.max(0, 1 - stddev / 10);
  }

  private pruneOld<T extends { timestamp: number }>(arr: T[], now: number): void {
    const cutoff = now - MEASUREMENT_WINDOW * 2; // 2ウィンドウ分保持
    while (arr.length > 0 && arr[0].timestamp < cutoff) {
      arr.shift();
    }
  }

  private pruneOldTimestamps(arr: number[], now: number): void {
    const cutoff = now - MEASUREMENT_WINDOW * 2;
    while (arr.length > 0 && arr[0] < cutoff) {
      arr.shift();
    }
  }
}
