/**
 * Attractor Landscape - 創発的アトラクター発見
 *
 * 事前定義された状態を一切持たない。
 * 位相空間上の軌跡を記録し、系が「自然に留まる領域」を
 * オンラインで発見する。
 *
 * アルゴリズム:
 * 1. 各ティックで位相座標を記録
 * 2. 既知のアトラクターとの距離を計算
 * 3. 距離 < attractorRadius → そのアトラクターに属する（重心を更新）
 * 4. 距離 > escapeRadius for all → 未知の領域。滞在を観測し始める
 * 5. 未知領域での滞在 > minSamples → 新しいアトラクターを「発見」
 * 6. 既知アトラクターから逸脱 → BasinTransition を記録
 *
 * 生物学アナロジー:
 * - 細胞の遺伝子発現空間での軌跡追跡
 * - 細胞型（cell type）は事前に定義されるのではなく、
 *   発現パターンのクラスタとして観測的に発見される
 * - 転写因子の相互作用ネットワークが作る力学系のアトラクター
 */

import { EventEmitter } from "events";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type {
  PhasePoint,
  Attractor,
  EmergentBehaviorStats,
  BasinTransition,
  EmergentLandscape,
  BifurcationConfig,
  BifurcationSnapshot,
  PhaseDimension,
} from "../types/bifurcation.js";
import type { ToolExecutionLog } from "../types/tool-log.js";
import { PhaseSpaceObserver } from "./entropy-monitor.js";

// ========== Default Configuration ==========

const DEFAULT_DIMENSIONS: PhaseDimension[] = [
  { name: "tool_failure_rate",   min: 0, max: 1 },
  { name: "tool_diversity",      min: 0, max: 30 },
  { name: "tool_throughput",     min: 0, max: 100 },
  { name: "repeated_failures",   min: 0, max: 10 },
  { name: "exploration_radius",  min: 0, max: 500 },
  { name: "combat_frequency",    min: 0, max: 1 },
  { name: "crafting_frequency",  min: 0, max: 1 },
  { name: "building_frequency",  min: 0, max: 1 },
  { name: "inventory_diversity", min: 0, max: 30 },
  { name: "resource_surplus",    min: 0, max: 1 },
  { name: "health_stability",    min: 0, max: 1 },
  { name: "death_frequency",     min: 0, max: 5 },
  { name: "demand_rate",         min: 0, max: 10 },
  { name: "demand_complexity",   min: 0, max: 1 },
  { name: "agent_count",         min: 1, max: 10 },
  { name: "message_rate",        min: 0, max: 20 },
];

const DEFAULT_CONFIG: BifurcationConfig = {
  measurementInterval: 30_000,  // 30秒
  dimensions: DEFAULT_DIMENSIONS,
  attractorRadius: 0.25,        // 正規化空間上の距離
  minSamplesForAttractor: 5,    // 5回観測でアトラクターとして認識
  escapeRadius: 0.4,            // この距離を超えたらアトラクターから逸脱
  trajectoryWindowSize: 200,    // 直近200点を保持
  centroidLearningRate: 0.1,    // EMAの係数
  dataDir: join(process.cwd(), "bifurcation"),
};

// ========== Attractor Landscape ==========

export class AttractorLandscape extends EventEmitter {
  private config: BifurcationConfig;
  private observer: PhaseSpaceObserver;

  /** 発見済みアトラクター */
  private attractors: Attractor[] = [];

  /** 現在属しているアトラクターID */
  private currentAttractorId: string | null = null;

  /** 軌跡（スライディングウィンドウ） */
  private trajectory: PhasePoint[] = [];

  /** 遷移履歴 */
  private transitionHistory: BasinTransition[] = [];

  /** 未知領域での滞在バッファ（新アトラクター候補） */
  private unknownRegionBuffer: PhasePoint[] = [];

  /** ツール実行ログの参照（行動統計計算用） */
  private toolLogs: ToolExecutionLog[] = [];

  /** 計測タイマー */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** アトラクター連番カウンター */
  private attractorCounter: number = 0;

  constructor(
    observer: PhaseSpaceObserver,
    config?: Partial<BifurcationConfig>
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.observer = observer;

    this.restore();
  }

  // ========== Lifecycle ==========

  start(): void {
    if (this.timer) return;

    console.log(`[AttractorLandscape] Started. Dimensions: ${this.config.dimensions.length}, Interval: ${this.config.measurementInterval}ms`);
    console.log(`[AttractorLandscape] Known attractors: ${this.attractors.length}`);

    this.timer = setInterval(() => this.tick(), this.config.measurementInterval);
    this.tick(); // 初回即時
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.save();
    console.log("[AttractorLandscape] Stopped.");
  }

  /**
   * ツール実行ログの参照を設定
   */
  setToolLogSource(logs: ToolExecutionLog[]): void {
    this.toolLogs = logs;
    this.observer.setToolLogSource(logs);
  }

  // ========== Core Tick ==========

  private tick(): void {
    // 1. 位相座標を観測
    const point = this.observer.observe();

    // 2. 軌跡に追加
    this.trajectory.push(point);
    if (this.trajectory.length > this.config.trajectoryWindowSize) {
      this.trajectory.shift();
    }

    // 3. 各アトラクターとの距離を計算
    const distances = this.attractors.map(a => ({
      attractorId: a.id,
      distance: this.euclideanDistance(point.coordinates, a.centroid),
    }));

    // 4. 最も近いアトラクターを見つける
    const nearest = distances.length > 0
      ? distances.reduce((min, d) => d.distance < min.distance ? d : min)
      : null;

    // 5. 所属判定
    if (nearest && nearest.distance <= this.config.attractorRadius) {
      // 既知のアトラクターに属する
      const attractor = this.attractors.find(a => a.id === nearest.attractorId)!;
      this.updateAttractor(attractor, point);

      if (this.currentAttractorId !== attractor.id) {
        // 遷移: 前のアトラクター/未知領域 → この既知アトラクター
        this.recordTransition(this.currentAttractorId, attractor.id, point);
        this.currentAttractorId = attractor.id;
        this.unknownRegionBuffer = [];
      }
    } else if (!nearest || nearest.distance > this.config.escapeRadius) {
      // すべてのアトラクターから十分離れた → 未知領域
      this.unknownRegionBuffer.push(point);

      if (this.currentAttractorId !== null) {
        // アトラクターからの逸脱を記録
        this.recordTransition(this.currentAttractorId, null, point);
        this.currentAttractorId = null;
      }

      // 未知領域に十分長くいたら、新しいアトラクターを発見
      if (this.unknownRegionBuffer.length >= this.config.minSamplesForAttractor) {
        const newAttractor = this.discoverAttractor(this.unknownRegionBuffer);
        this.recordTransition(null, newAttractor.id, point);
        this.currentAttractorId = newAttractor.id;
        this.unknownRegionBuffer = [];
      }
    } else {
      // attractorRadius < distance <= escapeRadius: 境界領域
      // 現在のアトラクターに留まっていると見なすが、重心更新はしない
      // （遷移の予兆をキャプチャするため）
      this.unknownRegionBuffer.push(point);
    }

    // 6. イベント発火
    this.emit("tick", {
      point,
      currentAttractorId: this.currentAttractorId,
      distances,
      landscape: this.getLandscape(),
    });
  }

  // ========== Attractor Discovery ==========

  /**
   * 未知領域のバッファから新しいアトラクターを発見する
   */
  private discoverAttractor(buffer: PhasePoint[]): Attractor {
    const ndim = this.observer.dimensionCount;

    // 重心を計算
    const centroid = new Array(ndim).fill(0);
    for (const p of buffer) {
      for (let d = 0; d < ndim; d++) {
        centroid[d] += p.coordinates[d];
      }
    }
    for (let d = 0; d < ndim; d++) {
      centroid[d] /= buffer.length;
    }

    // 分散を計算
    const variance = new Array(ndim).fill(0);
    for (const p of buffer) {
      for (let d = 0; d < ndim; d++) {
        variance[d] += (p.coordinates[d] - centroid[d]) ** 2;
      }
    }
    for (let d = 0; d < ndim; d++) {
      variance[d] /= buffer.length;
    }

    const now = Date.now();
    this.attractorCounter++;
    const id = `attractor_${this.attractorCounter}`;

    const attractor: Attractor = {
      id,
      centroid,
      variance,
      sampleCount: buffer.length,
      discoveredAt: buffer[0].timestamp,
      lastVisited: now,
      totalResidenceTime: (buffer[buffer.length - 1].timestamp - buffer[0].timestamp),
      stability: 0,
      behaviorStats: this.computeBehaviorStats(buffer),
    };
    attractor.stability = attractor.sampleCount > 0
      ? attractor.totalResidenceTime / attractor.sampleCount
      : 0;

    this.attractors.push(attractor);
    this.save();

    console.log(`\n[AttractorLandscape] ==============================`);
    console.log(`[AttractorLandscape] NEW ATTRACTOR DISCOVERED: ${id}`);
    console.log(`[AttractorLandscape] Centroid: [${centroid.map(v => v.toFixed(3)).join(", ")}]`);
    console.log(`[AttractorLandscape] Samples: ${buffer.length}`);
    console.log(`[AttractorLandscape] Dominant dimensions: ${this.describeDominantDimensions(centroid)}`);
    console.log(`[AttractorLandscape] ==============================\n`);

    this.emit("attractor:discovered", attractor);

    return attractor;
  }

  /**
   * アトラクターの重心をEMAで更新し、統計を蓄積
   */
  private updateAttractor(attractor: Attractor, point: PhasePoint): void {
    const lr = this.config.centroidLearningRate;
    const ndim = point.coordinates.length;

    // 重心のEMA更新
    for (let d = 0; d < ndim; d++) {
      attractor.centroid[d] = (1 - lr) * attractor.centroid[d] + lr * point.coordinates[d];
    }

    // 分散の更新
    for (let d = 0; d < ndim; d++) {
      const diff = point.coordinates[d] - attractor.centroid[d];
      attractor.variance[d] = (1 - lr) * attractor.variance[d] + lr * (diff ** 2);
    }

    attractor.sampleCount++;
    attractor.lastVisited = point.timestamp;
    attractor.totalResidenceTime += this.config.measurementInterval;
    attractor.stability = attractor.totalResidenceTime / attractor.sampleCount;

    // 行動統計を定期的に更新（10サンプルごと）
    if (attractor.sampleCount % 10 === 0) {
      attractor.behaviorStats = this.computeBehaviorStats(
        this.trajectory.slice(-20) // 直近20点から統計
      );
    }
  }

  // ========== Transition Detection ==========

  private recordTransition(
    fromId: string | null,
    toId: string | null,
    point: PhasePoint
  ): void {
    // 同じアトラクター間の「遷移」は記録しない
    if (fromId === toId) return;

    const dimensions = this.observer.getDimensions();
    const precedingTrajectory = this.trajectory.slice(-10).map(p => p.coordinates);

    // どの次元が最も変化したか分析
    const dominantDimensions = this.analyzeDominantDimensions(point);

    const transition: BasinTransition = {
      id: `transition_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: point.timestamp,
      fromAttractorId: fromId,
      toAttractorId: toId,
      transitionPoint: [...point.coordinates],
      precedingTrajectory,
      dominantDimensions,
    };

    this.transitionHistory.push(transition);

    // 既知アトラクターの entry/exit conditions を更新
    if (fromId) {
      const from = this.attractors.find(a => a.id === fromId);
      if (from) {
        from.behaviorStats.exitConditions = [...point.coordinates];
      }
    }
    if (toId) {
      const to = this.attractors.find(a => a.id === toId);
      if (to) {
        to.behaviorStats.entryConditions = [...point.coordinates];
      }
    }

    const fromLabel = fromId || "unknown";
    const toLabel = toId || "unknown";
    console.log(`[AttractorLandscape] Transition: ${fromLabel} → ${toLabel}`);
    if (dominantDimensions.length > 0) {
      console.log(`[AttractorLandscape] Dominant dimensions: ${dominantDimensions.map(d => `${d.name}(Δ${d.delta.toFixed(3)})`).join(", ")}`);
    }

    this.emit("transition", transition);
    this.save();
  }

  /**
   * 軌跡から、どの次元の変化が遷移を駆動したかを分析
   */
  private analyzeDominantDimensions(
    currentPoint: PhasePoint
  ): { dimension: number; name: string; delta: number }[] {
    const dimensions = this.observer.getDimensions();

    if (this.trajectory.length < 5) {
      return [];
    }

    // 5ティック前の位置と比較
    const prev = this.trajectory[this.trajectory.length - 5];
    if (!prev) return [];

    const deltas = currentPoint.coordinates.map((v, i) => ({
      dimension: i,
      name: dimensions[i]?.name || `dim_${i}`,
      delta: Math.abs(v - prev.coordinates[i]),
    }));

    // 変化量が大きい上位3次元を返す
    return deltas
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .filter(d => d.delta > 0.05); // 5%以上の変化のみ
  }

  // ========== Behavior Stats ==========

  /**
   * 創発的行動統計を計算
   *
   * テンプレートではなく、実際のツール実行ログから統計的に導出する。
   */
  private computeBehaviorStats(buffer: PhasePoint[]): EmergentBehaviorStats {
    if (buffer.length === 0) {
      return {
        topTools: [],
        problematicTools: [],
        avgResourceDiversity: 0,
        avgHealthStability: 0,
        entryConditions: [],
        exitConditions: [],
      };
    }

    const windowStart = buffer[0].timestamp;
    const windowEnd = buffer[buffer.length - 1].timestamp;
    const relevantLogs = this.toolLogs.filter(
      l => l.timestamp >= windowStart && l.timestamp <= windowEnd
    );

    // ツール使用統計
    const toolStats = new Map<string, { total: number; success: number }>();
    for (const log of relevantLogs) {
      const stat = toolStats.get(log.tool) || { total: 0, success: 0 };
      stat.total++;
      if (log.result === "success") stat.success++;
      toolStats.set(log.tool, stat);
    }

    const topTools = [...toolStats.entries()]
      .map(([tool, stat]) => ({
        tool,
        frequency: stat.total,
        successRate: stat.total > 0 ? stat.success / stat.total : 0,
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);

    const problematicTools = [...toolStats.entries()]
      .map(([tool, stat]) => ({
        tool,
        failureRate: stat.total > 0 ? 1 - stat.success / stat.total : 0,
        count: stat.total,
      }))
      .filter(t => t.failureRate > 0.3 && t.count >= 3)
      .sort((a, b) => b.failureRate - a.failureRate);

    // 平均の資源多様性・HP安定性
    const diversityDimIdx = this.observer.getDimensions()
      .findIndex(d => d.name === "inventory_diversity");
    const healthDimIdx = this.observer.getDimensions()
      .findIndex(d => d.name === "health_stability");

    const avgResourceDiversity = diversityDimIdx >= 0
      ? buffer.reduce((s, p) => s + p.coordinates[diversityDimIdx], 0) / buffer.length
      : 0;
    const avgHealthStability = healthDimIdx >= 0
      ? buffer.reduce((s, p) => s + p.coordinates[healthDimIdx], 0) / buffer.length
      : 0;

    return {
      topTools,
      problematicTools,
      avgResourceDiversity,
      avgHealthStability,
      entryConditions: buffer[0].coordinates,
      exitConditions: buffer[buffer.length - 1].coordinates,
    };
  }

  // ========== Public API ==========

  /**
   * 現在のランドスケープを取得
   */
  getLandscape(): EmergentLandscape {
    const currentPosition = this.trajectory.length > 0
      ? this.trajectory[this.trajectory.length - 1].coordinates
      : new Array(this.observer.dimensionCount).fill(0);

    const distances = this.attractors.map(a => ({
      attractorId: a.id,
      distance: this.euclideanDistance(currentPosition, a.centroid),
    }));

    // 軌跡の方向ベクトル
    const trajectoryDirection = this.calcTrajectoryDirection();
    const trajectorySpeed = this.calcTrajectorySpeed();

    return {
      currentPosition,
      currentAttractorId: this.currentAttractorId,
      attractors: this.attractors.map(a => ({ ...a })),
      distancesToAttractors: distances,
      trajectoryDirection,
      trajectorySpeed,
      timestamp: Date.now(),
    };
  }

  /**
   * 全体のスナップショットを取得
   */
  getSnapshot(): BifurcationSnapshot {
    return {
      landscape: this.getLandscape(),
      recentTrajectory: this.trajectory.slice(-50),
      transitionHistory: [...this.transitionHistory],
      config: { ...this.config },
      lastUpdated: Date.now(),
    };
  }

  /**
   * 現在のアトラクターの行動統計を取得
   */
  getCurrentBehaviorStats(): EmergentBehaviorStats | null {
    if (!this.currentAttractorId) return null;
    const attractor = this.attractors.find(a => a.id === this.currentAttractorId);
    return attractor?.behaviorStats || null;
  }

  /**
   * 現在のアトラクターを取得
   */
  getCurrentAttractor(): Attractor | null {
    if (!this.currentAttractorId) return null;
    return this.attractors.find(a => a.id === this.currentAttractorId) || null;
  }

  /**
   * 遷移履歴を取得
   */
  getTransitionHistory(limit?: number): BasinTransition[] {
    if (limit) return this.transitionHistory.slice(-limit);
    return [...this.transitionHistory];
  }

  /**
   * PhaseSpaceObserver へのアクセス
   */
  getObserver(): PhaseSpaceObserver {
    return this.observer;
  }

  // ========== Internal: 幾何計算 ==========

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
  }

  private calcTrajectoryDirection(): number[] {
    const ndim = this.observer.dimensionCount;
    if (this.trajectory.length < 2) {
      return new Array(ndim).fill(0);
    }

    const recent = this.trajectory.slice(-5);
    const first = recent[0].coordinates;
    const last = recent[recent.length - 1].coordinates;

    const direction = new Array(ndim).fill(0);
    let magnitude = 0;
    for (let d = 0; d < ndim; d++) {
      direction[d] = last[d] - first[d];
      magnitude += direction[d] ** 2;
    }
    magnitude = Math.sqrt(magnitude);

    // 正規化
    if (magnitude > 0) {
      for (let d = 0; d < ndim; d++) {
        direction[d] /= magnitude;
      }
    }

    return direction;
  }

  private calcTrajectorySpeed(): number {
    if (this.trajectory.length < 2) return 0;

    const recent = this.trajectory.slice(-5);
    let totalDist = 0;
    for (let i = 1; i < recent.length; i++) {
      totalDist += this.euclideanDistance(
        recent[i - 1].coordinates,
        recent[i].coordinates
      );
    }
    return totalDist / (recent.length - 1);
  }

  /**
   * 重心の支配的次元を人間が読める形で記述
   */
  private describeDominantDimensions(centroid: number[]): string {
    const dims = this.observer.getDimensions();
    return centroid
      .map((v, i) => ({ name: dims[i]?.name || `dim_${i}`, value: v }))
      .filter(d => d.value > 0.3) // 30%以上の次元のみ
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map(d => `${d.name}=${d.value.toFixed(2)}`)
      .join(", ");
  }

  // ========== Persistence ==========

  private save(): void {
    try {
      const dir = this.config.dataDir;
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data = {
        attractors: this.attractors,
        attractorCounter: this.attractorCounter,
        currentAttractorId: this.currentAttractorId,
        transitionHistory: this.transitionHistory.slice(-100), // 直近100件のみ永続化
      };

      writeFileSync(join(dir, "landscape.json"), JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("[AttractorLandscape] Save failed:", e);
    }
  }

  private restore(): void {
    try {
      const filePath = join(this.config.dataDir, "landscape.json");
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        if (data.attractors) this.attractors = data.attractors;
        if (data.attractorCounter) this.attractorCounter = data.attractorCounter;
        if (data.currentAttractorId) this.currentAttractorId = data.currentAttractorId;
        if (data.transitionHistory) this.transitionHistory = data.transitionHistory;
        console.log(`[AttractorLandscape] Restored: ${this.attractors.length} attractors, ${this.transitionHistory.length} transitions`);
      }
    } catch {
      // ファイルなし or パースエラー → 初期状態
    }
  }
}
