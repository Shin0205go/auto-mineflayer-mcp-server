/**
 * Bifurcation System - 創発的アトラクター発見
 *
 * 事前定義された状態を持たない分岐システム。
 * 位相空間上の軌跡から、系が「自然に留まる領域」を動的に発見する。
 *
 * アーキテクチャ:
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │                  Bifurcation System                      │
 * │                                                          │
 * │  ┌─────────────────────┐    ┌─────────────────────────┐ │
 * │  │ PhaseSpaceObserver  │───▶│ AttractorLandscape      │ │
 * │  │ (位相空間の知覚)     │    │ (アトラクター発見)       │ │
 * │  └─────────────────────┘    └───────────┬─────────────┘ │
 * │         ▲                               │               │
 * │         │                               ▼               │
 * │  ┌──────┴──────────────┐    ┌─────────────────────────┐ │
 * │  │ Tool Logs /         │    │ MetaPromptManager       │ │
 * │  │ Game Events         │    │ (創発的行動規範生成)      │ │
 * │  └─────────────────────┘    └─────────────────────────┘ │
 * │                                                          │
 * │  Attractors: 事前定義なし — 軌跡から自動発見              │
 * │  Prompts: テンプレートなし — 統計から動的生成             │
 * └──────────────────────────────────────────────────────────┘
 */

export { PhaseSpaceObserver } from "./entropy-monitor.js";
export { AttractorLandscape } from "./attractor-landscape.js";
export { MetaPromptManager } from "./meta-prompt.js";

export type {
  PhasePoint,
  PhaseDimension,
  PhaseSpaceInput,
  Attractor,
  EmergentBehaviorStats,
  BasinTransition,
  EmergentLandscape,
  BifurcationConfig,
  BifurcationSnapshot,
} from "../types/bifurcation.js";

import { PhaseSpaceObserver } from "./entropy-monitor.js";
import { AttractorLandscape } from "./attractor-landscape.js";
import { MetaPromptManager } from "./meta-prompt.js";
import type { ToolExecutionLog } from "../types/tool-log.js";
import type { BifurcationConfig, Attractor, BasinTransition } from "../types/bifurcation.js";

/**
 * 分岐システム全体のファサード
 */
export class BifurcationSystem {
  readonly observer: PhaseSpaceObserver;
  readonly landscape: AttractorLandscape;
  readonly metaPrompt: MetaPromptManager;

  constructor(config?: Partial<BifurcationConfig>) {
    this.observer = new PhaseSpaceObserver(config);
    this.landscape = new AttractorLandscape(this.observer, config);
    this.metaPrompt = new MetaPromptManager();

    // アトラクター発見時にメタプロンプトを更新
    this.landscape.on("attractor:discovered", (attractor: Attractor) => {
      this.metaPrompt.generateFromAttractor(
        attractor,
        this.observer.getDimensions(),
        `新しいアトラクター ${attractor.id} が発見された`
      );
    });

    // 遷移時にメタプロンプトを更新
    this.landscape.on("transition", (transition: BasinTransition) => {
      const toAttractor = transition.toAttractorId
        ? this.landscape.getLandscape().attractors.find(
            (a: Attractor) => a.id === transition.toAttractorId
          ) || null
        : null;

      const dims = transition.dominantDimensions
        .map((d: { name: string; delta: number }) => `${d.name}(Δ${d.delta.toFixed(3)})`)
        .join(", ");

      this.metaPrompt.generateFromAttractor(
        toAttractor,
        this.observer.getDimensions(),
        `盆地間遷移: ${transition.fromAttractorId || "unknown"} → ${transition.toAttractorId || "unknown"}。主要変化次元: ${dims}`
      );
    });
  }

  /**
   * ツール実行ログの参照を設定
   */
  connectToolLogs(logs: ToolExecutionLog[]): void {
    this.landscape.setToolLogSource(logs);
  }

  start(): void {
    this.landscape.start();
    console.log("[BifurcationSystem] System started (emergent attractor mode).");
  }

  stop(): void {
    this.landscape.stop();
    console.log("[BifurcationSystem] System stopped.");
  }
}
