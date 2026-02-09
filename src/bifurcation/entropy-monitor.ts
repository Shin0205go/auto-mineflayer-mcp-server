/**
 * Entropy Monitor - 散逸構造の監視
 *
 * システム生物学における「ストレス指標」に相当。
 * ツール実行ログ、環境状態、要求パターン、協調状態から
 * 複合的なエントロピー指標を算出する。
 *
 * エントロピーが現在の安定状態の閾値を超えると、
 * BifurcationEngineが相転移を検討する。
 */

import type {
  EntropyMetrics,
  EntropyWeights,
  EntropyInput,
  BifurcationConfig,
} from "../types/bifurcation.js";
import type { ToolExecutionLog } from "../types/tool-log.js";

/**
 * デフォルトのエントロピー重み
 *
 * 生物学的アナロジー:
 * - structuralComplexity ≈ 形態的複雑度（器官数・分化度）
 * - operationalEntropy  ≈ 代謝ストレス（エラー修復コスト）
 * - demandPressure      ≈ 環境ストレス（外的選択圧）
 * - coordinationLoad    ≈ 細胞間シグナル負荷
 */
const DEFAULT_WEIGHTS: EntropyWeights = {
  structuralComplexity: 0.2,
  operationalEntropy: 0.35,
  demandPressure: 0.3,
  coordinationLoad: 0.15,
};

/** エントロピー履歴のデフォルト保持数 */
const DEFAULT_HISTORY_SIZE = 100;

/** 計測ウィンドウ（直近のログを集計する期間、ms） */
const MEASUREMENT_WINDOW = 5 * 60 * 1000; // 5分

export class EntropyMonitor {
  private weights: EntropyWeights;
  private history: EntropyMetrics[] = [];
  private maxHistory: number;

  /** ツール実行ログの参照（外部から注入） */
  private toolLogs: ToolExecutionLog[] = [];

  /** 人間の指示の記録 */
  private instructionTimestamps: number[] = [];
  private instructionComplexities: number[] = [];

  /** 環境状態のキャッシュ */
  private environmentCache: EntropyInput["environmentState"] = {
    automatedFarms: 0,
    structuresBuilt: 0,
    uniqueResourceTypes: 0,
    inventoryDiversity: 0,
  };

  /** エージェント状態のキャッシュ */
  private coordinationCache: EntropyInput["coordinationState"] = {
    activeAgents: 1,
    messageFrequency: 0,
    conflictingGoals: 0,
    boardMessageRate: 0,
  };

  constructor(config?: Partial<BifurcationConfig>) {
    this.weights = config?.entropyWeights || DEFAULT_WEIGHTS;
    this.maxHistory = config?.entropyHistorySize || DEFAULT_HISTORY_SIZE;
  }

  /**
   * ツール実行ログ配列への参照を設定
   * mcp-ws-serverのtoolExecutionLogsを直接参照
   */
  setToolLogSource(logs: ToolExecutionLog[]): void {
    this.toolLogs = logs;
  }

  /**
   * 人間の指示を記録（要求圧力計測用）
   */
  recordInstruction(complexity: number = 0.5): void {
    const now = Date.now();
    this.instructionTimestamps.push(now);
    this.instructionComplexities.push(Math.max(0, Math.min(1, complexity)));

    // 古い記録を削除（1時間以上前）
    const cutoff = now - 60 * 60 * 1000;
    while (this.instructionTimestamps.length > 0 && this.instructionTimestamps[0] < cutoff) {
      this.instructionTimestamps.shift();
      this.instructionComplexities.shift();
    }
  }

  /**
   * 環境状態を更新
   */
  updateEnvironment(state: Partial<EntropyInput["environmentState"]>): void {
    Object.assign(this.environmentCache, state);
  }

  /**
   * 協調状態を更新
   */
  updateCoordination(state: Partial<EntropyInput["coordinationState"]>): void {
    Object.assign(this.coordinationCache, state);
  }

  /**
   * エントロピーを計測
   * 全次元の指標を集計し、加重合計を算出する
   */
  measure(): EntropyMetrics {
    const now = Date.now();
    const input = this.gatherInput(now);

    const structural = this.calcStructuralComplexity(input);
    const operational = this.calcOperationalEntropy(input);
    const demand = this.calcDemandPressure(input);
    const coordination = this.calcCoordinationLoad(input);

    const total =
      structural * this.weights.structuralComplexity +
      operational * this.weights.operationalEntropy +
      demand * this.weights.demandPressure +
      coordination * this.weights.coordinationLoad;

    const metrics: EntropyMetrics = {
      structuralComplexity: structural,
      operationalEntropy: operational,
      demandPressure: demand,
      coordinationLoad: coordination,
      totalEntropy: total,
      timestamp: now,
    };

    // 履歴に追加
    this.history.push(metrics);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return metrics;
  }

  /**
   * エントロピーのトレンド（変化率）を取得
   * 正: エントロピー増加中、負: 減少中
   */
  getTrend(windowSize: number = 10): number {
    if (this.history.length < 2) return 0;

    const recent = this.history.slice(-windowSize);
    if (recent.length < 2) return 0;

    // 線形回帰の傾き
    const n = recent.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += recent[i].totalEntropy;
      sumXY += i * recent[i].totalEntropy;
      sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope;
  }

  /**
   * エントロピー履歴を取得
   */
  getHistory(limit?: number): EntropyMetrics[] {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /**
   * 最新のエントロピーを取得
   */
  getLatest(): EntropyMetrics | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  // ========== Internal: 入力データ収集 ==========

  private gatherInput(now: number): EntropyInput {
    const windowStart = now - MEASUREMENT_WINDOW;
    const recentLogs = this.toolLogs.filter(l => l.timestamp > windowStart);

    // ツール統計
    const totalCalls = recentLogs.length;
    const failureLogs = recentLogs.filter(l => l.result === "failure");
    const failureCount = failureLogs.length;
    const failureRate = totalCalls > 0 ? failureCount / totalCalls : 0;

    const uniqueTools = new Set(recentLogs.map(l => l.tool));
    const avgDuration = totalCalls > 0
      ? recentLogs.reduce((sum, l) => sum + l.duration, 0) / totalCalls
      : 0;

    // 連続失敗の検出
    const repeatedFailures = this.countRepeatedFailures(recentLogs);

    // 要求パターン
    const recentInstructions = this.instructionTimestamps.filter(t => t > windowStart);
    const instructionFrequency = recentInstructions.length / (MEASUREMENT_WINDOW / 60000); // 回/分
    const recentComplexities = this.instructionComplexities.slice(
      -(recentInstructions.length || 1)
    );
    const avgComplexity = recentComplexities.length > 0
      ? recentComplexities.reduce((a, b) => a + b, 0) / recentComplexities.length
      : 0;

    return {
      toolStats: {
        totalCalls,
        failureCount,
        failureRate,
        uniqueToolsUsed: uniqueTools.size,
        avgDuration,
        repeatedFailures,
      },
      environmentState: { ...this.environmentCache },
      demandPattern: {
        instructionFrequency,
        instructionComplexity: avgComplexity,
        unfulfilledRequests: failureCount, // 失敗≈未達成の指示
        resourceDeficit: 0, // 外部から更新
      },
      coordinationState: { ...this.coordinationCache },
    };
  }

  // ========== Internal: 各次元の計算 ==========

  /**
   * 構造的複雑度 (0-100)
   *
   * 生物学アナロジー: 器官の分化度と形態的複雑さ
   * - 自動化ファーム数（分化した器官数）
   * - 構造物数（組織の多様性）
   * - 資源多様性（代謝経路の多様性）
   */
  private calcStructuralComplexity(input: EntropyInput): number {
    const env = input.environmentState;

    // 各指標を正規化して合算 (0-100)
    const farmScore = Math.min(env.automatedFarms * 15, 30);
    const structScore = Math.min(env.structuresBuilt * 5, 25);
    const resourceScore = Math.min(env.uniqueResourceTypes * 2, 25);
    const diversityScore = Math.min(env.inventoryDiversity * 3, 20);

    return farmScore + structScore + resourceScore + diversityScore;
  }

  /**
   * 操作エントロピー (0-100)
   *
   * 生物学アナロジー: DNA修復コスト、代謝エラー率
   * - ツール失敗率（突然変異率）
   * - 連続失敗（修復不能損傷）
   * - 実行時間の増大（代謝効率の低下）
   */
  private calcOperationalEntropy(input: EntropyInput): number {
    const stats = input.toolStats;

    if (stats.totalCalls === 0) return 0;

    // 失敗率スコア (0-40): 失敗率が高いほどエントロピー大
    const failureScore = Math.min(stats.failureRate * 100, 40);

    // 連続失敗スコア (0-30): 同じツールの連続失敗はシステムの構造的問題
    const repeatScore = Math.min(stats.repeatedFailures * 10, 30);

    // 実行時間スコア (0-30): 平均実行時間が長いほど非効率
    // 1秒以下は正常、5秒超はストレス
    const durationScore = Math.min(Math.max((stats.avgDuration - 1000) / 4000, 0) * 30, 30);

    return failureScore + repeatScore + durationScore;
  }

  /**
   * 要求圧力 (0-100)
   *
   * 生物学アナロジー: 環境選択圧、生態系への外乱
   * - 指示頻度（環境変動の頻度）
   * - 指示複雑度（選択圧の強度）
   * - 未達成要求（適応失敗の蓄積）
   */
  private calcDemandPressure(input: EntropyInput): number {
    const demand = input.demandPattern;

    // 指示頻度スコア (0-30): 1回/分以上は高圧力
    const freqScore = Math.min(demand.instructionFrequency * 15, 30);

    // 複雑度スコア (0-30)
    const complexScore = demand.instructionComplexity * 30;

    // 未達成スコア (0-40): 蓄積する未達成要求はシステムの限界を示す
    const unfulfilledScore = Math.min(demand.unfulfilledRequests * 8, 40);

    return freqScore + complexScore + unfulfilledScore;
  }

  /**
   * 協調負荷 (0-100)
   *
   * 生物学アナロジー: 多細胞生物の細胞間シグナリングコスト
   * - エージェント数（細胞数）
   * - メッセージ頻度（シグナル負荷）
   * - 目標競合（シグナル干渉）
   */
  private calcCoordinationLoad(input: EntropyInput): number {
    const coord = input.coordinationState;

    // エージェント数スコア (0-20): ソロなら0、多いほど高い
    const agentScore = Math.min((coord.activeAgents - 1) * 10, 20);

    // メッセージ頻度スコア (0-30)
    const msgScore = Math.min(coord.messageFrequency * 5, 30);

    // 目標競合スコア (0-30)
    const conflictScore = Math.min(coord.conflictingGoals * 15, 30);

    // 掲示板メッセージ率スコア (0-20)
    const boardScore = Math.min(coord.boardMessageRate * 4, 20);

    return agentScore + msgScore + conflictScore + boardScore;
  }

  // ========== Internal: ヘルパー ==========

  /**
   * 同じツールの連続失敗を数える
   */
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
}
