/**
 * Bifurcation Architecture Types
 *
 * システム生物学の「代替安定的状態（Alternative Stable States）」と
 * 「分岐（Bifurcation）」を導入するための型定義。
 *
 * Waddingtonの発生学的ランドスケープに基づき、システムの安定性を
 * 「谷（アトラクター）」として捉え、外乱が閾値を超えた際に
 * 相転移（Phase Transition）を行う。
 */

// ========== System States (Attractor Basins) ==========

/**
 * システムの安定状態（アトラクター盆地）
 *
 * State A: Primitive Survival - 手動の資源確保、小規模構造
 * State B: Organized Settlement - 自動農場、整理された拠点、基本防衛
 * State C: Industrial Complex - レッドストーン自動化、多拠点分散、マルチエージェント協調
 */
export type SystemState = "primitive_survival" | "organized_settlement" | "industrial_complex";

export interface StateDefinition {
  id: SystemState;
  name: string;
  description: string;

  /** この状態が維持可能な最大エントロピー閾値 */
  maxEntropy: number;

  /** この状態への遷移に必要な最小エントロピー（ヒステリシス：戻り用） */
  minEntropyToReturn: number;

  /** この状態で使用するエージェント行動規範 */
  behaviorProfile: BehaviorProfile;

  /** 状態の安定性ポテンシャル（深い谷ほど安定） */
  potentialDepth: number;

  /** 遷移に必要な活性化エネルギー */
  activationEnergy: number;
}

// ========== Entropy Metrics (散逸構造の監視) ==========

/**
 * エントロピー計測の各次元
 *
 * システムの「限界」を測る複合指標。
 * 生物学における「ストレス指標」に相当。
 */
export interface EntropyMetrics {
  /** 構造的複雑度: ビルド数、自動化レベル、資源多様性 */
  structuralComplexity: number;

  /** 操作エントロピー: ツール失敗率、タスク繰り返し、未解決エラー */
  operationalEntropy: number;

  /** 要求圧力: 人間の指示頻度・複雑度、資源不足度 */
  demandPressure: number;

  /** 協調負荷: エージェント数、メッセージ頻度、目標競合 */
  coordinationLoad: number;

  /** 総合エントロピー（加重合計） */
  totalEntropy: number;

  /** 計測タイムスタンプ */
  timestamp: number;
}

/**
 * エントロピー計測用の重み付け設定
 */
export interface EntropyWeights {
  structuralComplexity: number;
  operationalEntropy: number;
  demandPressure: number;
  coordinationLoad: number;
}

/**
 * エントロピー計測の入力ソース
 */
export interface EntropyInput {
  /** ツール実行ログからの集計 */
  toolStats: {
    totalCalls: number;
    failureCount: number;
    failureRate: number;
    uniqueToolsUsed: number;
    avgDuration: number;
    repeatedFailures: number;  // 同じツールの連続失敗
  };

  /** 環境状態 */
  environmentState: {
    automatedFarms: number;
    structuresBuilt: number;
    uniqueResourceTypes: number;
    inventoryDiversity: number;
  };

  /** 要求パターン */
  demandPattern: {
    instructionFrequency: number;    // 指示/分
    instructionComplexity: number;   // 0-1 scale
    unfulfilledRequests: number;
    resourceDeficit: number;         // 必要量 - 保有量
  };

  /** マルチエージェント状態 */
  coordinationState: {
    activeAgents: number;
    messageFrequency: number;
    conflictingGoals: number;
    boardMessageRate: number;
  };
}

// ========== Bifurcation Events (分岐イベント) ==========

/**
 * 相転移イベント
 */
export interface PhaseTransitionEvent {
  id: string;
  timestamp: number;

  /** 遷移元 */
  fromState: SystemState;

  /** 遷移先 */
  toState: SystemState;

  /** 遷移のトリガーとなったエントロピー */
  triggerEntropy: EntropyMetrics;

  /** 遷移理由 */
  reason: string;

  /** 遷移に伴うアクション計画 */
  migrationPlan: MigrationAction[];

  /** 遷移ステータス */
  status: "initiated" | "in_progress" | "completed" | "failed" | "rolled_back";

  /** 完了時間 */
  completedAt?: number;
}

/**
 * マイグレーションアクション
 * 相転移時に実行する具体的アクション
 */
export interface MigrationAction {
  id: string;
  type: "build_automation" | "restructure_base" | "deploy_redstone" |
        "setup_farm" | "coordinate_agents" | "upgrade_tools" |
        "establish_perimeter" | "create_storage" | "meta_prompt_update";
  description: string;
  priority: number;
  status: "pending" | "in_progress" | "completed" | "skipped";
  prerequisiteIds?: string[];
}

// ========== Behavior Profiles (行動規範) ==========

/**
 * 各安定状態でのエージェント行動規範
 * メタ・プロンプトの自己書き換えに使用
 */
export interface BehaviorProfile {
  /** フェーズ名（System Promptに反映） */
  phaseName: string;

  /** 優先事項リスト（降順） */
  priorities: string[];

  /** 使用を推奨するツール群 */
  preferredTools: string[];

  /** 避けるべき行動 */
  avoidActions: string[];

  /** 意思決定の基準 */
  decisionCriteria: string;

  /** リスク許容度 0-1 */
  riskTolerance: number;

  /** 自動化レベル 0-1 */
  automationLevel: number;

  /** 協調モード */
  coordinationMode: "solo" | "cooperative" | "hierarchical";
}

// ========== Potential Landscape (ポテンシャルランドスケープ) ==========

/**
 * Waddingtonランドスケープのモデル
 * ポテンシャル関数 V(x) で安定性を表現
 */
export interface PotentialLandscape {
  /** 現在の状態 */
  currentState: SystemState;

  /** 各状態のポテンシャルエネルギー（低いほど安定） */
  stateEnergies: Record<SystemState, number>;

  /** 現在のシステムエネルギー（エントロピーから算出） */
  currentEnergy: number;

  /** 各遷移の活性化エネルギー障壁 */
  transitionBarriers: TransitionBarrier[];

  /** ランドスケープのスナップショット時間 */
  timestamp: number;
}

export interface TransitionBarrier {
  from: SystemState;
  to: SystemState;
  barrierHeight: number;
  currentProgress: number; // 0-1: 障壁をどれだけ越えかけているか
}

// ========== Hysteresis (ヒステリシス) ==========

/**
 * ヒステリシス状態
 * 一度遷移したら、簡単には戻らない
 */
export interface HysteresisState {
  /** 現在の状態に留まっている時間（ms） */
  timeInCurrentState: number;

  /** 現在の状態に遷移した時のエントロピー */
  entryEntropy: number;

  /** 戻り遷移を開始するための閾値 */
  returnThreshold: number;

  /** 連続で閾値を下回っている時間（ms） */
  belowThresholdDuration: number;

  /** 戻り遷移に必要な連続時間（ms）*/
  requiredBelowDuration: number;

  /** 遷移履歴（バタつき防止の参照用） */
  recentTransitions: { timestamp: number; from: SystemState; to: SystemState }[];
}

// ========== System Snapshot (システムスナップショット) ==========

/**
 * 分岐システム全体のスナップショット
 */
export interface BifurcationSnapshot {
  currentState: SystemState;
  entropy: EntropyMetrics;
  landscape: PotentialLandscape;
  hysteresis: HysteresisState;
  activeTransition: PhaseTransitionEvent | null;
  transitionHistory: PhaseTransitionEvent[];
  lastUpdated: number;
}

// ========== Configuration ==========

/**
 * 分岐システムの設定
 */
export interface BifurcationConfig {
  /** エントロピー計測間隔（ms） */
  measurementInterval: number;

  /** エントロピーの重み */
  entropyWeights: EntropyWeights;

  /** 各状態の定義 */
  states: Record<SystemState, StateDefinition>;

  /** ヒステリシスの戻り遷移に必要な連続時間（ms） */
  hysteresisReturnDuration: number;

  /** バタつき防止: 最小遷移間隔（ms） */
  minTransitionInterval: number;

  /** エントロピー履歴の保持数 */
  entropyHistorySize: number;

  /** 自動遷移を有効にするか */
  autoTransitionEnabled: boolean;
}
