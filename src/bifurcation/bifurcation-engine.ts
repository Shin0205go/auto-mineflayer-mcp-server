/**
 * Bifurcation Engine - 相転移ロジック
 *
 * Waddingtonの発生学的ランドスケープに基づく状態遷移エンジン。
 * ポテンシャル関数 V(x) でシステムの安定性を計算し、
 * エントロピーが活性化エネルギー障壁を超えた際に相転移を実行する。
 *
 * ヒステリシスにより、一度遷移したら簡単には戻らない。
 * これは生物学における「不可逆的分化」に類似する。
 */

import { EventEmitter } from "events";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type {
  SystemState,
  StateDefinition,
  EntropyMetrics,
  PhaseTransitionEvent,
  MigrationAction,
  PotentialLandscape,
  TransitionBarrier,
  HysteresisState,
  BehaviorProfile,
  BifurcationConfig,
  BifurcationSnapshot,
} from "../types/bifurcation.js";
import { EntropyMonitor } from "./entropy-monitor.js";

// ========== Default State Definitions ==========

const DEFAULT_STATES: Record<SystemState, StateDefinition> = {
  primitive_survival: {
    id: "primitive_survival",
    name: "原始的サバイバル (Primitive Survival)",
    description: "手動の資源確保、小規模な家。環境への反応的対応。",
    maxEntropy: 35,
    minEntropyToReturn: 15,
    potentialDepth: 30,
    activationEnergy: 0,
    behaviorProfile: {
      phaseName: "原始的サバイバル",
      priorities: [
        "生存（HP・食料の維持）",
        "基本資源の確保（木、石、鉄）",
        "シェルターの確保",
        "作業台・かまどの設置",
        "夜間の安全確保",
      ],
      preferredTools: [
        "minecraft_dig_block",
        "minecraft_craft",
        "minecraft_eat",
        "minecraft_build_structure",
        "minecraft_fight",
      ],
      avoidActions: [
        "大規模建設",
        "レッドストーン回路",
        "マルチエージェント協調",
        "ネザー探索（十分な装備なし）",
      ],
      decisionCriteria: "生存と基本資源を最優先。リスクを避け、段階的に装備を改善する。",
      riskTolerance: 0.2,
      automationLevel: 0,
      coordinationMode: "solo",
    },
  },

  organized_settlement: {
    id: "organized_settlement",
    name: "組織化された集落 (Organized Settlement)",
    description: "自動農場、整理された拠点、基本防衛。計画的な資源管理。",
    maxEntropy: 65,
    minEntropyToReturn: 25,
    potentialDepth: 50,
    activationEnergy: 35,
    behaviorProfile: {
      phaseName: "組織化された集落",
      priorities: [
        "自動農場の構築・維持",
        "拠点の防衛強化",
        "資源の組織的管理（チェスト整理）",
        "ダイヤモンド装備の確保",
        "エンチャント設備の構築",
        "ネザー探索の準備",
      ],
      preferredTools: [
        "minecraft_build_structure",
        "minecraft_craft",
        "minecraft_place_block",
        "minecraft_dig_block",
        "minecraft_move_to",
        "save_skill",
      ],
      avoidActions: [
        "非効率な手動作業（自動化可能なもの）",
        "無計画な探索",
        "装備なしでの危険地帯侵入",
      ],
      decisionCriteria: "効率と持続可能性を重視。自動化できるものは自動化し、拠点を中心に活動範囲を拡大。",
      riskTolerance: 0.4,
      automationLevel: 0.5,
      coordinationMode: "cooperative",
    },
  },

  industrial_complex: {
    id: "industrial_complex",
    name: "工業コンプレックス (Industrial Complex)",
    description: "レッドストーン自動化、多拠点分散、マルチエージェント協調。",
    maxEntropy: 100,
    minEntropyToReturn: 50,
    potentialDepth: 80,
    activationEnergy: 65,
    behaviorProfile: {
      phaseName: "工業コンプレックス",
      priorities: [
        "レッドストーン自動化ファームの構築",
        "アイアンゴーレムトラップの建設",
        "モブファームによるXP・アイテム自動収集",
        "村人交易所の設立",
        "ネザー拠点の確保",
        "エンダードラゴン討伐の準備",
        "マルチエージェント分業の最適化",
      ],
      preferredTools: [
        "minecraft_build_structure",
        "minecraft_build_road",
        "minecraft_build_village",
        "minecraft_place_block",
        "agent_board_write",
        "agent_board_read",
        "save_skill",
        "reflect_and_learn",
      ],
      avoidActions: [
        "手動での反復作業",
        "自動化されていない資源収集",
        "単独での大規模プロジェクト",
      ],
      decisionCriteria: "スケーラビリティと自動化を最優先。すべての反復的作業を自動化し、エージェント間で分業する。",
      riskTolerance: 0.7,
      automationLevel: 0.9,
      coordinationMode: "hierarchical",
    },
  },
};

/** 状態の順序（遷移方向の参照用） */
const STATE_ORDER: SystemState[] = ["primitive_survival", "organized_settlement", "industrial_complex"];

// ========== Default Configuration ==========

const DEFAULT_CONFIG: BifurcationConfig = {
  measurementInterval: 30_000, // 30秒ごとにエントロピー計測
  entropyWeights: {
    structuralComplexity: 0.2,
    operationalEntropy: 0.35,
    demandPressure: 0.3,
    coordinationLoad: 0.15,
  },
  states: DEFAULT_STATES,
  hysteresisReturnDuration: 5 * 60_000, // 5分間連続で閾値以下なら戻り遷移
  minTransitionInterval: 10 * 60_000,   // 最低10分間隔で遷移
  entropyHistorySize: 100,
  autoTransitionEnabled: true,
};

/** 永続化ディレクトリ */
const DATA_DIR = join(process.cwd(), "bifurcation");
const SNAPSHOT_FILE = join(DATA_DIR, "snapshot.json");
const TRANSITION_LOG_FILE = join(DATA_DIR, "transitions.jsonl");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ========== Bifurcation Engine ==========

export class BifurcationEngine extends EventEmitter {
  private config: BifurcationConfig;
  private entropyMonitor: EntropyMonitor;

  /** 現在のシステム状態 */
  private currentState: SystemState = "primitive_survival";

  /** ヒステリシス状態 */
  private hysteresis: HysteresisState;

  /** 遷移履歴 */
  private transitionHistory: PhaseTransitionEvent[] = [];

  /** 進行中の遷移 */
  private activeTransition: PhaseTransitionEvent | null = null;

  /** 計測タイマー */
  private measurementTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    entropyMonitor: EntropyMonitor,
    config?: Partial<BifurcationConfig>
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.entropyMonitor = entropyMonitor;

    this.hysteresis = {
      timeInCurrentState: 0,
      entryEntropy: 0,
      returnThreshold: this.getStateDefinition(this.currentState).minEntropyToReturn,
      belowThresholdDuration: 0,
      requiredBelowDuration: this.config.hysteresisReturnDuration,
      recentTransitions: [],
    };

    // 永続化されたスナップショットから復元
    this.restoreFromSnapshot();
  }

  /**
   * エントロピー監視ループを開始
   */
  start(): void {
    if (this.measurementTimer) return;

    console.log(`[Bifurcation] Engine started. Current state: ${this.currentState}`);
    console.log(`[Bifurcation] Measurement interval: ${this.config.measurementInterval}ms`);

    this.measurementTimer = setInterval(() => {
      this.tick();
    }, this.config.measurementInterval);

    // 初回即時計測
    this.tick();
  }

  /**
   * 監視ループを停止
   */
  stop(): void {
    if (this.measurementTimer) {
      clearInterval(this.measurementTimer);
      this.measurementTimer = null;
    }
    this.saveSnapshot();
    console.log("[Bifurcation] Engine stopped.");
  }

  /**
   * 1ティックの処理: 計測 → 評価 → 遷移判定
   */
  private tick(): void {
    const metrics = this.entropyMonitor.measure();
    const landscape = this.computeLandscape(metrics);

    // ヒステリシス更新
    this.updateHysteresis(metrics);

    // 遷移判定
    if (this.config.autoTransitionEnabled) {
      this.evaluateTransition(metrics, landscape);
    }

    // イベント発火
    this.emit("tick", {
      metrics,
      landscape,
      currentState: this.currentState,
      hysteresis: this.hysteresis,
    });
  }

  // ========== Potential Landscape ==========

  /**
   * ポテンシャルランドスケープを計算
   *
   * V(x) = potentialDepth - entropy による安定性関数。
   * 現在のエントロピーが状態のポテンシャルの深さを超えると、
   * その状態は不安定になる（谷から飛び出す）。
   */
  computeLandscape(metrics: EntropyMetrics): PotentialLandscape {
    const stateEnergies: Record<SystemState, number> = {
      primitive_survival: 0,
      organized_settlement: 0,
      industrial_complex: 0,
    };

    // 各状態のポテンシャルエネルギーを計算
    for (const stateId of STATE_ORDER) {
      const def = this.getStateDefinition(stateId);
      // ポテンシャルの深さからエントロピーを引いた値
      // 正: まだ安定、負: 不安定（谷から溢れている）
      stateEnergies[stateId] = def.potentialDepth - metrics.totalEntropy;
    }

    // 遷移障壁の計算
    const barriers: TransitionBarrier[] = [];
    for (let i = 0; i < STATE_ORDER.length - 1; i++) {
      const from = STATE_ORDER[i];
      const to = STATE_ORDER[i + 1];
      const toDef = this.getStateDefinition(to);
      const barrierHeight = toDef.activationEnergy;
      const progress = Math.min(metrics.totalEntropy / barrierHeight, 1);

      barriers.push({ from, to, barrierHeight, currentProgress: progress });
    }

    // 逆方向の障壁（戻り遷移）
    for (let i = STATE_ORDER.length - 1; i > 0; i--) {
      const from = STATE_ORDER[i];
      const to = STATE_ORDER[i - 1];
      const fromDef = this.getStateDefinition(from);
      // 戻り遷移の障壁はヒステリシスの影響で高い
      const barrierHeight = fromDef.minEntropyToReturn;
      const progress = metrics.totalEntropy < barrierHeight
        ? (barrierHeight - metrics.totalEntropy) / barrierHeight
        : 0;

      barriers.push({ from, to, barrierHeight, currentProgress: progress });
    }

    return {
      currentState: this.currentState,
      stateEnergies,
      currentEnergy: metrics.totalEntropy,
      transitionBarriers: barriers,
      timestamp: Date.now(),
    };
  }

  // ========== Transition Evaluation ==========

  /**
   * 遷移を評価して実行するかどうか判定
   */
  private evaluateTransition(metrics: EntropyMetrics, landscape: PotentialLandscape): void {
    // 進行中の遷移があれば評価しない
    if (this.activeTransition && this.activeTransition.status === "in_progress") {
      return;
    }

    // バタつき防止: 最小遷移間隔チェック
    const lastTransition = this.hysteresis.recentTransitions[
      this.hysteresis.recentTransitions.length - 1
    ];
    if (lastTransition) {
      const elapsed = Date.now() - lastTransition.timestamp;
      if (elapsed < this.config.minTransitionInterval) {
        return;
      }
    }

    const currentIdx = STATE_ORDER.indexOf(this.currentState);
    const currentDef = this.getStateDefinition(this.currentState);

    // === 前方遷移（より複雑な状態へ） ===
    if (currentIdx < STATE_ORDER.length - 1) {
      const nextState = STATE_ORDER[currentIdx + 1];
      const nextDef = this.getStateDefinition(nextState);

      if (metrics.totalEntropy > currentDef.maxEntropy) {
        // エントロピーが現在の状態の限界を超えた
        // 活性化エネルギーも超えているか確認
        if (metrics.totalEntropy >= nextDef.activationEnergy) {
          const trend = this.entropyMonitor.getTrend();
          if (trend >= 0) {
            // エントロピーが増加傾向 → 相転移を開始
            this.initiateTransition(
              nextState,
              metrics,
              `エントロピー(${metrics.totalEntropy.toFixed(1)})が${currentDef.name}の限界(${currentDef.maxEntropy})を超過。` +
              `トレンド: +${trend.toFixed(2)}。${nextDef.name}へ相転移開始。`
            );
            return;
          }
        }
      }
    }

    // === 後方遷移（より単純な状態へ戻る） ===
    if (currentIdx > 0) {
      const prevState = STATE_ORDER[currentIdx - 1];

      if (metrics.totalEntropy < currentDef.minEntropyToReturn) {
        // ヒステリシス: 十分な時間、閾値を下回り続けているか
        if (this.hysteresis.belowThresholdDuration >= this.hysteresis.requiredBelowDuration) {
          this.initiateTransition(
            prevState,
            metrics,
            `エントロピー(${metrics.totalEntropy.toFixed(1)})が${this.hysteresis.requiredBelowDuration / 1000}秒間` +
            `閾値(${currentDef.minEntropyToReturn})を下回り続けた。${this.getStateDefinition(prevState).name}への回帰遷移。`
          );
        }
      }
    }
  }

  // ========== Transition Execution ==========

  /**
   * 相転移を開始
   */
  private initiateTransition(
    targetState: SystemState,
    triggerEntropy: EntropyMetrics,
    reason: string
  ): void {
    const migrationPlan = this.createMigrationPlan(this.currentState, targetState);

    const transition: PhaseTransitionEvent = {
      id: `transition_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      fromState: this.currentState,
      toState: targetState,
      triggerEntropy: { ...triggerEntropy },
      reason,
      migrationPlan,
      status: "initiated",
    };

    console.log(`\n[Bifurcation] ====================================`);
    console.log(`[Bifurcation] PHASE TRANSITION INITIATED`);
    console.log(`[Bifurcation] ${transition.fromState} → ${transition.toState}`);
    console.log(`[Bifurcation] Reason: ${reason}`);
    console.log(`[Bifurcation] Migration plan: ${migrationPlan.length} actions`);
    console.log(`[Bifurcation] ====================================\n`);

    this.activeTransition = transition;
    transition.status = "in_progress";

    // イベント発火
    this.emit("transition:initiated", transition);

    // 状態を更新
    const previousState = this.currentState;
    this.currentState = targetState;

    // ヒステリシス更新
    this.hysteresis = {
      timeInCurrentState: 0,
      entryEntropy: triggerEntropy.totalEntropy,
      returnThreshold: this.getStateDefinition(targetState).minEntropyToReturn,
      belowThresholdDuration: 0,
      requiredBelowDuration: this.config.hysteresisReturnDuration,
      recentTransitions: [
        ...this.hysteresis.recentTransitions.slice(-9),
        { timestamp: Date.now(), from: previousState, to: targetState },
      ],
    };

    // 遷移完了
    transition.status = "completed";
    transition.completedAt = Date.now();
    this.transitionHistory.push(transition);
    this.activeTransition = null;

    // 永続化
    this.persistTransition(transition);
    this.saveSnapshot();

    // イベント発火
    this.emit("transition:completed", transition);
    this.emit("state:changed", {
      previousState,
      newState: targetState,
      behaviorProfile: this.getCurrentBehaviorProfile(),
      transition,
    });
  }

  /**
   * マイグレーション計画を生成
   */
  private createMigrationPlan(from: SystemState, to: SystemState): MigrationAction[] {
    const fromIdx = STATE_ORDER.indexOf(from);
    const toIdx = STATE_ORDER.indexOf(to);

    if (toIdx > fromIdx) {
      // 前方遷移: より複雑な状態へ
      return this.createForwardMigrationPlan(from, to);
    } else {
      // 後方遷移: より単純な状態へ
      return this.createBackwardMigrationPlan(from, to);
    }
  }

  private createForwardMigrationPlan(from: SystemState, to: SystemState): MigrationAction[] {
    const actions: MigrationAction[] = [];
    let idCounter = 0;
    const nextId = () => `action_${Date.now()}_${idCounter++}`;

    // メタプロンプト更新（必ず最初）
    actions.push({
      id: nextId(),
      type: "meta_prompt_update",
      description: `行動規範を「${this.getStateDefinition(to).behaviorProfile.phaseName}」モードに更新`,
      priority: 0,
      status: "pending",
    });

    if (to === "organized_settlement") {
      actions.push(
        {
          id: nextId(),
          type: "setup_farm",
          description: "自動小麦農場を構築して食料供給を自動化",
          priority: 1,
          status: "pending",
        },
        {
          id: nextId(),
          type: "create_storage",
          description: "チェスト倉庫を整備して資源管理を体系化",
          priority: 2,
          status: "pending",
        },
        {
          id: nextId(),
          type: "establish_perimeter",
          description: "拠点周囲に柵と松明で防衛線を構築",
          priority: 3,
          status: "pending",
        },
        {
          id: nextId(),
          type: "upgrade_tools",
          description: "鉄→ダイヤモンド装備への段階的アップグレード",
          priority: 4,
          status: "pending",
        }
      );
    }

    if (to === "industrial_complex") {
      actions.push(
        {
          id: nextId(),
          type: "deploy_redstone",
          description: "レッドストーン回路による自動仕分けシステム構築",
          priority: 1,
          status: "pending",
        },
        {
          id: nextId(),
          type: "build_automation",
          description: "アイアンゴーレムトラップで鉄の自動生産を確立",
          priority: 2,
          status: "pending",
        },
        {
          id: nextId(),
          type: "build_automation",
          description: "モブファームでXP・アイテムの自動収集",
          priority: 3,
          status: "pending",
        },
        {
          id: nextId(),
          type: "coordinate_agents",
          description: "マルチエージェント分業体制を確立（採掘・建設・探索）",
          priority: 4,
          status: "pending",
        },
        {
          id: nextId(),
          type: "restructure_base",
          description: "工業エリア・農業エリア・居住エリアのゾーニング",
          priority: 5,
          status: "pending",
        }
      );
    }

    return actions;
  }

  private createBackwardMigrationPlan(_from: SystemState, to: SystemState): MigrationAction[] {
    const actions: MigrationAction[] = [];
    let idCounter = 0;
    const nextId = () => `action_${Date.now()}_${idCounter++}`;

    // メタプロンプト更新
    actions.push({
      id: nextId(),
      type: "meta_prompt_update",
      description: `行動規範を「${this.getStateDefinition(to).behaviorProfile.phaseName}」モードにダウングレード`,
      priority: 0,
      status: "pending",
    });

    return actions;
  }

  // ========== Hysteresis Management ==========

  /**
   * ヒステリシス状態を更新
   */
  private updateHysteresis(metrics: EntropyMetrics): void {
    const currentDef = this.getStateDefinition(this.currentState);
    const interval = this.config.measurementInterval;

    this.hysteresis.timeInCurrentState += interval;

    // 戻り遷移の閾値チェック
    if (metrics.totalEntropy < currentDef.minEntropyToReturn) {
      this.hysteresis.belowThresholdDuration += interval;
    } else {
      // リセット（連続性が途切れた）
      this.hysteresis.belowThresholdDuration = 0;
    }
  }

  // ========== Public API ==========

  /**
   * 現在のシステム状態を取得
   */
  getCurrentState(): SystemState {
    return this.currentState;
  }

  /**
   * 現在の行動規範を取得
   */
  getCurrentBehaviorProfile(): BehaviorProfile {
    return this.getStateDefinition(this.currentState).behaviorProfile;
  }

  /**
   * 状態定義を取得
   */
  getStateDefinition(state: SystemState): StateDefinition {
    return this.config.states[state];
  }

  /**
   * 全体のスナップショットを取得
   */
  getSnapshot(): BifurcationSnapshot {
    const latestEntropy = this.entropyMonitor.getLatest();
    const metrics = latestEntropy || {
      structuralComplexity: 0,
      operationalEntropy: 0,
      demandPressure: 0,
      coordinationLoad: 0,
      totalEntropy: 0,
      timestamp: Date.now(),
    };

    return {
      currentState: this.currentState,
      entropy: metrics,
      landscape: this.computeLandscape(metrics),
      hysteresis: { ...this.hysteresis },
      activeTransition: this.activeTransition,
      transitionHistory: [...this.transitionHistory],
      lastUpdated: Date.now(),
    };
  }

  /**
   * 手動で遷移を強制（デバッグ用・人間の直接指示用）
   */
  forceTransition(targetState: SystemState, reason: string): PhaseTransitionEvent | null {
    if (targetState === this.currentState) {
      return null;
    }

    const metrics = this.entropyMonitor.measure();
    this.initiateTransition(targetState, metrics, `[手動遷移] ${reason}`);
    return this.transitionHistory[this.transitionHistory.length - 1] || null;
  }

  /**
   * 設定を更新
   */
  updateConfig(partial: Partial<BifurcationConfig>): void {
    Object.assign(this.config, partial);
  }

  /**
   * EntropyMonitorへのアクセス
   */
  getEntropyMonitor(): EntropyMonitor {
    return this.entropyMonitor;
  }

  // ========== Persistence ==========

  private saveSnapshot(): void {
    try {
      ensureDataDir();
      const snapshot = this.getSnapshot();
      writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
    } catch (e) {
      console.error("[Bifurcation] Failed to save snapshot:", e);
    }
  }

  private restoreFromSnapshot(): void {
    try {
      if (existsSync(SNAPSHOT_FILE)) {
        const data = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf-8"));
        if (data.currentState && STATE_ORDER.includes(data.currentState)) {
          this.currentState = data.currentState;
          console.log(`[Bifurcation] Restored state: ${this.currentState}`);
        }
        if (data.transitionHistory) {
          this.transitionHistory = data.transitionHistory;
        }
        if (data.hysteresis) {
          this.hysteresis = {
            ...this.hysteresis,
            ...data.hysteresis,
          };
        }
      }
    } catch {
      // ファイルがない、パースエラー等は無視して初期状態で開始
    }
  }

  private persistTransition(transition: PhaseTransitionEvent): void {
    try {
      ensureDataDir();
      const line = JSON.stringify(transition) + "\n";
      writeFileSync(TRANSITION_LOG_FILE, line, { flag: "a" });
    } catch (e) {
      console.error("[Bifurcation] Failed to persist transition:", e);
    }
  }
}
