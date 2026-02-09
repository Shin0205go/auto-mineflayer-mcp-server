/**
 * Bifurcation Architecture Types - 創発的アトラクター発見
 *
 * 事前定義された状態を持たない。
 * 系の位相空間上の軌跡から、アトラクター盆地を動的に発見する。
 *
 * 生物学アナロジー:
 * - 位相空間の各軸 = 遺伝子発現量
 * - 軌跡 = 細胞の分化過程
 * - アトラクター = 分化した細胞型（事前に設計されたものではなく創発する）
 * - 相転移 = 細胞のリプログラミング（外乱による盆地間遷移）
 */

// ========== Phase Space (位相空間) ==========

/**
 * 位相空間上の一点。
 * 系の「今の状態」を多次元ベクトルとして表現する。
 *
 * 各次元は正規化された0-1の値。
 * 次元の意味はシステムが自分で発見する — 名前はヒントに過ぎない。
 */
export interface PhasePoint {
  /** 位相空間の座標ベクトル */
  coordinates: number[];

  /** 計測タイムスタンプ */
  timestamp: number;

  /** この点を計測した時の生データ（デバッグ用） */
  rawInput?: PhaseSpaceInput;
}

/**
 * 位相空間の次元定義
 * 系が何を「知覚」しているかを定義する
 */
export interface PhaseDimension {
  /** 次元名（ヒント。系の挙動には影響しない） */
  name: string;

  /** 正規化の最小・最大値 */
  min: number;
  max: number;
}

/**
 * 位相空間への入力データ
 * ツール実行ログ・ゲームイベント・環境状態から集計される
 */
export interface PhaseSpaceInput {
  /** ツール使用パターン */
  toolFailureRate: number;
  toolDiversity: number;
  toolThroughput: number;
  repeatedFailures: number;

  /** 行動パターン */
  explorationRadius: number;
  combatFrequency: number;
  craftingFrequency: number;
  buildingFrequency: number;

  /** 資源状態 */
  inventoryDiversity: number;
  resourceSurplus: number;

  /** 生存指標 */
  healthStability: number;
  deathFrequency: number;

  /** 外部圧力 */
  demandRate: number;
  demandComplexity: number;

  /** 協調状態 */
  agentCount: number;
  messageRate: number;
}

// ========== Attractor (アトラクター) ==========

/**
 * 発見されたアトラクター盆地
 *
 * 事前定義ではなく、軌跡のクラスタリングから創発する。
 * 名前すら持たない — 系が自ら特徴を抽出し、記述する。
 */
export interface Attractor {
  /** 一意識別子（発見順に振られる） */
  id: string;

  /** 重心（centroid）: この盆地の「代表的な位相座標」 */
  centroid: number[];

  /** 分散: 各次元のばらつき。盆地の「広さ」 */
  variance: number[];

  /** この盆地に滞在した観測数 */
  sampleCount: number;

  /** 最初に発見されたタイムスタンプ */
  discoveredAt: number;

  /** 最後にこの盆地に滞在していたタイムスタンプ */
  lastVisited: number;

  /** この盆地での滞在合計時間（ms） */
  totalResidenceTime: number;

  /** 安定性: 滞在時間 / 観測回数。長いほど安定な谷 */
  stability: number;

  /** 盆地での振る舞い統計（創発的行動プロファイル） */
  behaviorStats: EmergentBehaviorStats;
}

/**
 * 創発的行動統計
 *
 * テンプレートではなく、実際の観測から自動的に集計される。
 * 「この盆地にいるとき、系は何をしていたか」の統計的記述。
 */
export interface EmergentBehaviorStats {
  /** ツール使用頻度ランキング（降順） */
  topTools: { tool: string; frequency: number; successRate: number }[];

  /** 高失敗率ツール（避けるべき行動の創発的発見） */
  problematicTools: { tool: string; failureRate: number; count: number }[];

  /** 平均的な資源状態 */
  avgResourceDiversity: number;

  /** 平均HP安定性 */
  avgHealthStability: number;

  /** この盆地への遷移時のトリガー特徴 */
  entryConditions: number[];  // 遷移時の位相座標

  /** この盆地からの離脱時のトリガー特徴 */
  exitConditions: number[];   // 離脱時の位相座標
}

// ========== Transition (遷移) ==========

/**
 * 盆地間遷移イベント
 *
 * fromAttractor/toAttractor は事前定義ではなく、
 * 発見されたアトラクターのIDを参照する。
 * toAttractor が null なら「未知の領域への逸脱」を意味する。
 */
export interface BasinTransition {
  id: string;
  timestamp: number;

  /** 遷移元のアトラクターID（null = 初期状態/未知領域） */
  fromAttractorId: string | null;

  /** 遷移先のアトラクターID（null = 新しい未知の領域） */
  toAttractorId: string | null;

  /** 遷移時の位相座標 */
  transitionPoint: number[];

  /** 遷移前の軌跡（直近N点） */
  precedingTrajectory: number[][];

  /** 遷移の要因分析: どの次元が最も変化したか */
  dominantDimensions: { dimension: number; name: string; delta: number }[];

  /** 外部トリガーがあったか */
  externalTrigger?: string;
}

// ========== Landscape (ランドスケープ) ==========

/**
 * 現在のランドスケープ状態
 *
 * 事前定義のポテンシャル関数ではなく、
 * 観測された軌跡の密度から逆算されるランドスケープ。
 */
export interface EmergentLandscape {
  /** 現在の位相座標 */
  currentPosition: number[];

  /** 現在属しているアトラクターID（null = 遷移中/未知領域） */
  currentAttractorId: string | null;

  /** 発見済みの全アトラクター */
  attractors: Attractor[];

  /** 現在位置から各アトラクターまでの距離 */
  distancesToAttractors: { attractorId: string; distance: number }[];

  /** 軌跡の最近の方向ベクトル（どの方向に動いているか） */
  trajectoryDirection: number[];

  /** 軌跡の速度（位相空間上の移動速度） */
  trajectorySpeed: number;

  /** スナップショット時刻 */
  timestamp: number;
}

// ========== Configuration ==========

/**
 * 分岐システムの設定
 *
 * 事前定義の状態は含まない。
 * 発見アルゴリズムのハイパーパラメータのみ。
 */
export interface BifurcationConfig {
  /** 計測間隔（ms） */
  measurementInterval: number;

  /** 位相空間の次元定義 */
  dimensions: PhaseDimension[];

  /** アトラクター判定の距離閾値: これ以下ならアトラクター内 */
  attractorRadius: number;

  /** 新しいアトラクターとして認識するための最小滞在観測数 */
  minSamplesForAttractor: number;

  /** 遷移判定: アトラクターから逸脱したと判定する距離 */
  escapeRadius: number;

  /** 軌跡の保持数（スライディングウィンドウ） */
  trajectoryWindowSize: number;

  /** 重心の更新率（指数移動平均の係数、0-1） */
  centroidLearningRate: number;

  /** 永続化ファイルのパス */
  dataDir: string;
}

// ========== Snapshot ==========

/**
 * システム全体のスナップショット
 */
export interface BifurcationSnapshot {
  landscape: EmergentLandscape;
  recentTrajectory: PhasePoint[];
  transitionHistory: BasinTransition[];
  config: BifurcationConfig;
  lastUpdated: number;
}
