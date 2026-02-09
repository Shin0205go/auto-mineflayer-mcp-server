/**
 * Bifurcation System - メインエクスポート
 *
 * システム生物学の「代替安定的状態」と「分岐」の概念を実装。
 * エージェントが環境の変化（外乱）に応じて「動的な自己組織化」を行う。
 *
 * アーキテクチャ:
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │                  Bifurcation System                      │
 * │                                                          │
 * │  ┌─────────────────┐    ┌───────────────────────┐       │
 * │  │ Entropy Monitor │───▶│ Bifurcation Engine    │       │
 * │  │ (散逸構造監視)   │    │ (相転移判定+実行)      │       │
 * │  └─────────────────┘    └──────────┬────────────┘       │
 * │         ▲                          │                     │
 * │         │                          ▼                     │
 * │  ┌──────┴──────────┐    ┌───────────────────────┐       │
 * │  │ Tool Logs /     │    │ Meta-Prompt Manager   │       │
 * │  │ Game Events     │    │ (自己書き換え)         │       │
 * │  └─────────────────┘    └───────────────────────┘       │
 * │                                                          │
 * │  States:                                                 │
 * │  [Primitive Survival] → [Organized Settlement]           │
 * │                           → [Industrial Complex]         │
 * │                                                          │
 * │  Hysteresis: 一度遷移したら簡単には戻らない               │
 * └──────────────────────────────────────────────────────────┘
 */

export { EntropyMonitor } from "./entropy-monitor.js";
export { BifurcationEngine } from "./bifurcation-engine.js";
export { MetaPromptManager } from "./meta-prompt.js";

// Re-export types
export type {
  SystemState,
  StateDefinition,
  EntropyMetrics,
  EntropyWeights,
  EntropyInput,
  PhaseTransitionEvent,
  MigrationAction,
  BehaviorProfile,
  PotentialLandscape,
  TransitionBarrier,
  HysteresisState,
  BifurcationSnapshot,
  BifurcationConfig,
} from "../types/bifurcation.js";

import { EntropyMonitor } from "./entropy-monitor.js";
import { BifurcationEngine } from "./bifurcation-engine.js";
import { MetaPromptManager } from "./meta-prompt.js";
import type { ToolExecutionLog } from "../types/tool-log.js";
import type { BifurcationConfig } from "../types/bifurcation.js";

/**
 * 分岐システム全体のファサード
 *
 * mcp-ws-serverやclaude-agentからこのクラスを通じて
 * 全機能にアクセスする。
 */
export class BifurcationSystem {
  readonly entropy: EntropyMonitor;
  readonly engine: BifurcationEngine;
  readonly metaPrompt: MetaPromptManager;

  constructor(config?: Partial<BifurcationConfig>) {
    this.entropy = new EntropyMonitor(config);
    this.engine = new BifurcationEngine(this.entropy, config);
    this.metaPrompt = new MetaPromptManager();

    // 相転移時にメタプロンプトを自動更新
    this.engine.on("state:changed", (event: {
      previousState: string;
      newState: string;
      behaviorProfile: import("../types/bifurcation.js").BehaviorProfile;
      transition: import("../types/bifurcation.js").PhaseTransitionEvent;
    }) => {
      this.metaPrompt.generatePrompt(
        event.newState as import("../types/bifurcation.js").SystemState,
        event.behaviorProfile,
        { transitionReason: event.transition.reason }
      );
    });
  }

  /**
   * ツール実行ログの参照を設定
   */
  connectToolLogs(logs: ToolExecutionLog[]): void {
    this.entropy.setToolLogSource(logs);
  }

  /**
   * システムを開始
   */
  start(): void {
    this.engine.start();
    console.log("[BifurcationSystem] System started.");
  }

  /**
   * システムを停止
   */
  stop(): void {
    this.engine.stop();
    console.log("[BifurcationSystem] System stopped.");
  }
}
