/**
 * Stability Analyzer
 *
 * 制御理論的アプローチでシステムの安定性を分析
 * - 外乱（Minecraftイベント）を検出
 * - システムの応答を記録
 * - 安定化時間・成功率を測定
 * - 不安定な外乱を特定
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  SystemState,
  DisturbanceEvent,
  DisturbanceResponse,
  StabilityMetrics,
  FailureMode
} from "./types/stability.js";
import {
  calculateSeverity,
  isStable,
  isInStabilityZone,
  computePseudoEigenvalue,
  identifyDominantVariable
} from "./types/stability.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const RESPONSES_LOG = join(projectRoot, "logs", "stability-responses.jsonl");

// ログディレクトリを確保
if (!existsSync(dirname(RESPONSES_LOG))) {
  mkdirSync(dirname(RESPONSES_LOG), { recursive: true });
}

interface ActiveDisturbance {
  event: DisturbanceEvent;
  actions: DisturbanceResponse['actions'];
  startTime: number;
}

export class StabilityAnalyzer {
  private activeDisturbances = new Map<string, ActiveDisturbance>(); // username -> disturbance
  private responses: DisturbanceResponse[] = [];
  private observationWindow = 30000; // 30秒以内の行動を応答とみなす

  /**
   * ゲームイベントを受信し、外乱として記録
   */
  onGameEvent(username: string, event: { type: string; message: string; priority: string }, currentState?: SystemState) {
    // 外乱として扱うイベントタイプ
    const disturbanceTypes = [
      'damaged', 'hostile_spawn', 'death', 'time_night', 'health_changed'
    ];

    if (!disturbanceTypes.includes(event.type)) {
      return; // 外乱ではない
    }

    const severity = calculateSeverity(event.type);
    if (severity < 3) {
      return; // 深刻度が低すぎる
    }

    if (!currentState) {
      return; // 状態が取得できない
    }

    const disturbanceEvent: DisturbanceEvent = {
      id: `${username}-${Date.now()}`,
      type: event.type as DisturbanceEvent['type'],
      timestamp: Date.now(),
      severity,
      username,
      stateBefore: currentState,
      details: { message: event.message, priority: event.priority }
    };

    // アクティブな外乱として記録
    this.activeDisturbances.set(username, {
      event: disturbanceEvent,
      actions: [],
      startTime: Date.now()
    });

    console.log(`[Stability] Disturbance detected: ${username} - ${event.type} (severity: ${severity})`);
  }

  /**
   * ツール実行ログを応答として記録
   */
  onToolExecution(username: string, log: {
    tool: string;
    success: boolean;
    duration: number;
    error?: string;
  }) {
    const active = this.activeDisturbances.get(username);
    if (!active) {
      return; // アクティブな外乱がない
    }

    const elapsed = Date.now() - active.startTime;
    if (elapsed > this.observationWindow) {
      // 観測期間を過ぎた → 応答を終了
      this.finalizeResponse(username);
      return;
    }

    // 応答アクションとして記録
    active.actions.push({
      tool: log.tool,
      timestamp: Date.now(),
      success: log.success,
      duration: log.duration,
      error: log.error
    });
  }

  /**
   * 状態更新を受信（ループ結果等から）
   */
  onStateUpdate(username: string, state: SystemState) {
    const active = this.activeDisturbances.get(username);
    if (!active) {
      return;
    }

    // 安定化したか判定
    if (isStable(state)) {
      this.finalizeResponse(username, state);
    }
  }

  /**
   * 応答を終了し、メトリクスを計算
   */
  private finalizeResponse(username: string, finalState?: SystemState) {
    const active = this.activeDisturbances.get(username);
    if (!active) {
      return;
    }

    const settlementTime = finalState ? Date.now() - active.startTime : null;
    const stabilized = finalState ? isStable(finalState) : false;

    const response: DisturbanceResponse = {
      disturbanceId: active.event.id,
      disturbance: active.event,
      actions: active.actions,
      stateAfter: finalState || null,
      settlementTime,
      overshoot: this.detectOvershoot(active),
      stabilized,
      energyCost: active.actions.length
    };

    this.responses.push(response);
    this.saveResponse(response);

    console.log(
      `[Stability] Response finalized: ${username} - ${active.event.type} ` +
      `(settled: ${stabilized}, time: ${settlementTime}ms, cost: ${active.actions.length})`
    );

    this.activeDisturbances.delete(username);
  }

  /**
   * 過剰反応（overshoot）を検出
   * 例: 敵1体に対して10回も攻撃、逃げすぎて遠くへ行く等
   */
  private detectOvershoot(active: ActiveDisturbance): boolean {
    // 簡易版: 同じツールを5回以上連続で呼んでいたら過剰反応
    const toolCounts = new Map<string, number>();
    for (const action of active.actions) {
      toolCounts.set(action.tool, (toolCounts.get(action.tool) || 0) + 1);
    }

    for (const count of toolCounts.values()) {
      if (count >= 5) {
        return true;
      }
    }

    return false;
  }


  /**
   * 応答をJSONLファイルに保存
   */
  private saveResponse(response: DisturbanceResponse) {
    try {
      appendFileSync(RESPONSES_LOG, JSON.stringify(response) + "\n", "utf-8");
    } catch (err) {
      console.error(`[Stability] Failed to save response:`, err);
    }
  }

  /**
   * 外乱タイプごとの安定性メトリクスを計算
   */
  getMetrics(): Map<string, StabilityMetrics> {
    const byType = new Map<string, DisturbanceResponse[]>();

    for (const response of this.responses) {
      const type = response.disturbance.type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(response);
    }

    const metrics = new Map<string, StabilityMetrics>();

    for (const [type, responses] of byType) {
      const stabilized = responses.filter(r => r.stabilized);
      const withSettlementTime = responses.filter(r => r.settlementTime !== null);

      metrics.set(type, {
        disturbanceType: type,
        totalCount: responses.length,
        stabilizationRate: stabilized.length / responses.length,
        avgSettlementTime: withSettlementTime.length > 0
          ? withSettlementTime.reduce((sum, r) => sum + r.settlementTime!, 0) / withSettlementTime.length
          : 0,
        avgEnergyCost: responses.reduce((sum, r) => sum + r.energyCost, 0) / responses.length,
        overshootRate: responses.filter(r => r.overshoot).length / responses.length,
        lastUpdated: Date.now()
      });
    }

    return metrics;
  }

  /**
   * 不安定な外乱タイプを取得（安定化率 < 80%）
   */
  getUnstableDisturbances(): string[] {
    const metrics = this.getMetrics();
    const unstable: string[] = [];

    for (const [type, metric] of metrics) {
      if (metric.stabilizationRate < 0.8) {
        unstable.push(type);
      }
    }

    return unstable;
  }

  /**
   * 指定した外乱タイプの失敗応答を取得
   */
  getFailedResponses(disturbanceType: string): DisturbanceResponse[] {
    return this.responses.filter(
      r => r.disturbance.type === disturbanceType && !r.stabilized
    );
  }

  /**
   * メトリクスをログ出力
   */
  printMetrics() {
    const metrics = this.getMetrics();

    console.log("\n=== Stability Metrics ===");
    for (const [type, metric] of metrics) {
      console.log(
        `[${type}] Count: ${metric.totalCount}, ` +
        `Success: ${(metric.stabilizationRate * 100).toFixed(1)}%, ` +
        `AvgTime: ${metric.avgSettlementTime.toFixed(0)}ms, ` +
        `AvgCost: ${metric.avgEnergyCost.toFixed(1)}, ` +
        `Overshoot: ${(metric.overshootRate * 100).toFixed(1)}%`
      );
    }
    console.log("========================\n");
  }

  /**
   * 保存済みの応答ログを読み込み
   */
  loadResponses() {
    if (!existsSync(RESPONSES_LOG)) {
      return;
    }

    try {
      const content = readFileSync(RESPONSES_LOG, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const response = JSON.parse(line) as DisturbanceResponse;
          this.responses.push(response);
        } catch (err) {
          console.error(`[Stability] Failed to parse response:`, err);
        }
      }

      console.log(`[Stability] Loaded ${this.responses.length} responses from log`);
    } catch (err) {
      console.error(`[Stability] Failed to load responses:`, err);
    }
  }

  // ========== Eigenmode Analysis (Conceptual) ==========

  /**
   * 固有モード解析（概念的）
   *
   * システム生物学の固有値解析を概念的に実装:
   * - 失敗パターンを「不安定な固有モード」として特定
   * - 疑似固有値で不安定性を定量化
   * - 固有ベクトル（支配的な状態変数）を特定
   */
  analyzeFailureModes(): FailureMode[] {
    const modes: FailureMode[] = [];
    const byType = new Map<string, DisturbanceResponse[]>();

    // 外乱タイプごとにグループ化
    for (const response of this.responses) {
      const type = response.disturbance.type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(response);
    }

    // 各タイプについて固有モードを計算
    for (const [type, responses] of byType) {
      const failed = responses.filter(r => !r.stabilized);
      const failureRate = failed.length / responses.length;

      // 平均回復時間（失敗は無限大として扱う）
      const recoveryTimes = responses
        .filter(r => r.settlementTime !== null)
        .map(r => r.settlementTime!);
      const avgRecoveryTime = recoveryTimes.length > 0
        ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length
        : 30000; // デフォルト30秒

      // 振動的かどうか（繰り返し失敗）
      const oscillatory = responses.length >= 3 &&
        responses.slice(-3).every(r => !r.stabilized);

      // 疑似固有値を計算
      const pseudoEigenvalue = computePseudoEigenvalue(
        failureRate,
        avgRecoveryTime,
        oscillatory
      );

      // 支配的な状態変数を特定
      const actions = failed.flatMap(r => r.actions.map(a => a.tool));
      const dominantVariable = identifyDominantVariable(type, actions);

      modes.push({
        pattern: type,
        pseudoEigenvalue,
        dominantVariable,
        failureCount: failed.length,
        averageRecoveryTime: avgRecoveryTime,
        oscillatory
      });
    }

    // 疑似固有値でソート（不安定な順）
    modes.sort((a, b) => b.pseudoEigenvalue - a.pseudoEigenvalue);

    return modes;
  }

  /**
   * 最も不安定な固有モードを取得
   */
  getMostUnstableMode(): FailureMode | null {
    const modes = this.analyzeFailureModes();
    const unstable = modes.filter(m => m.pseudoEigenvalue > 0);

    if (unstable.length === 0) {
      return null;
    }

    return unstable[0]; // 最大の正の固有値
  }

  /**
   * 固有モード分析レポートを出力
   */
  printEigenmodeAnalysis() {
    const modes = this.analyzeFailureModes();

    console.log("\n=== Eigenmode Analysis (Conceptual) ===");
    console.log("Modes sorted by pseudo-eigenvalue (most unstable first):\n");

    for (const mode of modes) {
      const stability = mode.pseudoEigenvalue > 0 ? "UNSTABLE" : "STABLE";
      const oscillation = mode.oscillatory ? " (oscillatory)" : "";

      console.log(`[${mode.pattern}]`);
      console.log(`  λ (pseudo): ${mode.pseudoEigenvalue.toFixed(3)} - ${stability}${oscillation}`);
      console.log(`  Dominant variable: ${mode.dominantVariable}`);
      console.log(`  Failure count: ${mode.failureCount}`);
      console.log(`  Avg recovery: ${(mode.averageRecoveryTime / 1000).toFixed(1)}s`);
      console.log(`  Convergence rate: ${(-mode.pseudoEigenvalue).toFixed(3)}`);
      console.log("");
    }

    const unstable = modes.filter(m => m.pseudoEigenvalue > 0);
    if (unstable.length > 0) {
      console.log(`⚠️  ${unstable.length} unstable mode(s) detected`);
      console.log(`   Priority: ${unstable[0].pattern} (λ=${unstable[0].pseudoEigenvalue.toFixed(3)})`);
    } else {
      console.log(`✓ All modes are stable`);
    }

    console.log("=======================================\n");
  }
}
