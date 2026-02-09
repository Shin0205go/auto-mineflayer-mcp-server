/**
 * Bifurcation MCP Tools
 *
 * 分岐システムをMCPツールとして公開。
 * エージェントがシステムの安定性を監視し、
 * 相転移の状況を把握・制御できるようにする。
 */

import type { BifurcationSystem } from "../bifurcation/index.js";

// ========== Tool Definitions ==========

export const bifurcationTools = {
  bifurcation_get_status: {
    description: "分岐システムの現在状態を取得。現在のフェーズ、エントロピー指標、ポテンシャルランドスケープ、遷移履歴を含む。",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  bifurcation_get_entropy: {
    description: "現在のエントロピー計測値を取得。構造的複雑度、操作エントロピー、要求圧力、協調負荷の各次元を確認。",
    inputSchema: {
      type: "object" as const,
      properties: {
        include_history: {
          type: "boolean",
          description: "過去の計測履歴を含めるか（デフォルト: false）",
        },
        history_limit: {
          type: "number",
          description: "履歴の取得件数（デフォルト: 10）",
        },
      },
    },
  },

  bifurcation_get_phase_directive: {
    description: "現在のフェーズに対応する行動指示を取得。エージェントが自分の行動規範を確認する際に使用。",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  bifurcation_report_demand: {
    description: "人間からの指示を分岐システムに報告。要求圧力の計測に使用される。",
    inputSchema: {
      type: "object" as const,
      properties: {
        complexity: {
          type: "number",
          description: "指示の複雑度 (0.0-1.0)。0=単純(移動), 0.5=中(建築), 1.0=複雑(自動化構築)",
        },
        description: {
          type: "string",
          description: "指示の概要",
        },
      },
      required: ["complexity"],
    },
  },

  bifurcation_update_environment: {
    description: "環境状態を分岐システムに報告。構造的複雑度の計測に使用。自動農場数、構造物数、資源種類数などを更新。",
    inputSchema: {
      type: "object" as const,
      properties: {
        automated_farms: {
          type: "number",
          description: "自動農場の数",
        },
        structures_built: {
          type: "number",
          description: "構築済み構造物の数",
        },
        unique_resource_types: {
          type: "number",
          description: "保有している資源の種類数",
        },
        inventory_diversity: {
          type: "number",
          description: "インベントリの多様性スコア (ユニークアイテム数)",
        },
      },
    },
  },

  bifurcation_force_transition: {
    description: "システム状態を手動で遷移させる（通常はエントロピー閾値による自動遷移）。デバッグまたは人間の直接指示に使用。",
    inputSchema: {
      type: "object" as const,
      properties: {
        target_state: {
          type: "string",
          enum: ["primitive_survival", "organized_settlement", "industrial_complex"],
          description: "遷移先の状態",
        },
        reason: {
          type: "string",
          description: "遷移理由",
        },
      },
      required: ["target_state", "reason"],
    },
  },

  bifurcation_get_landscape: {
    description: "Waddingtonポテンシャルランドスケープを取得。各状態のエネルギーレベル、遷移障壁、現在のエネルギーを可視化。",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  bifurcation_get_transition_history: {
    description: "過去の相転移履歴を取得。いつ、なぜ、どの状態から何へ遷移したかを確認。",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "取得件数（デフォルト: 10）",
        },
      },
    },
  },
};

// ========== Tool Handlers ==========

export function handleBifurcationTool(
  system: BifurcationSystem,
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case "bifurcation_get_status":
      return handleGetStatus(system);

    case "bifurcation_get_entropy":
      return handleGetEntropy(system, args);

    case "bifurcation_get_phase_directive":
      return handleGetPhaseDirective(system);

    case "bifurcation_report_demand":
      return handleReportDemand(system, args);

    case "bifurcation_update_environment":
      return handleUpdateEnvironment(system, args);

    case "bifurcation_force_transition":
      return handleForceTransition(system, args);

    case "bifurcation_get_landscape":
      return handleGetLandscape(system);

    case "bifurcation_get_transition_history":
      return handleGetTransitionHistory(system, args);

    default:
      return `Unknown bifurcation tool: ${toolName}`;
  }
}

// ========== Handler Implementations ==========

function handleGetStatus(system: BifurcationSystem): string {
  const snapshot = system.engine.getSnapshot();
  const trend = system.entropy.getTrend();
  const profile = system.engine.getCurrentBehaviorProfile();

  const lines: string[] = [
    `## 分岐システム状態`,
    ``,
    `**現在のフェーズ**: ${profile.phaseName}`,
    `**システム状態**: ${snapshot.currentState}`,
    ``,
    `### エントロピー指標`,
    `- 総合エントロピー: ${snapshot.entropy.totalEntropy.toFixed(1)} / ${system.engine.getStateDefinition(snapshot.currentState).maxEntropy}`,
    `- 構造的複雑度: ${snapshot.entropy.structuralComplexity.toFixed(1)}`,
    `- 操作エントロピー: ${snapshot.entropy.operationalEntropy.toFixed(1)}`,
    `- 要求圧力: ${snapshot.entropy.demandPressure.toFixed(1)}`,
    `- 協調負荷: ${snapshot.entropy.coordinationLoad.toFixed(1)}`,
    `- トレンド: ${trend >= 0 ? "+" : ""}${trend.toFixed(3)} (${trend > 0 ? "増加中" : trend < 0 ? "減少中" : "安定"})`,
    ``,
    `### ヒステリシス`,
    `- 現在の状態の滞在時間: ${(snapshot.hysteresis.timeInCurrentState / 1000).toFixed(0)}秒`,
    `- 戻り遷移の閾値: ${snapshot.hysteresis.returnThreshold}`,
    `- 閾値以下の持続時間: ${(snapshot.hysteresis.belowThresholdDuration / 1000).toFixed(0)}秒 / ${(snapshot.hysteresis.requiredBelowDuration / 1000).toFixed(0)}秒`,
    ``,
    `### 遷移`,
    `- 進行中の遷移: ${snapshot.activeTransition ? `${snapshot.activeTransition.fromState} → ${snapshot.activeTransition.toState}` : "なし"}`,
    `- 遷移回数: ${snapshot.transitionHistory.length}`,
  ];

  return lines.join("\n");
}

function handleGetEntropy(system: BifurcationSystem, args: Record<string, unknown>): string {
  const latest = system.entropy.getLatest();
  const includeHistory = args.include_history as boolean || false;
  const historyLimit = args.history_limit as number || 10;

  if (!latest) {
    return "エントロピー計測データなし。システムがまだ開始されていないか、計測が行われていません。";
  }

  const lines: string[] = [
    `## 最新エントロピー計測`,
    ``,
    `| 指標 | 値 |`,
    `|------|------|`,
    `| 構造的複雑度 | ${latest.structuralComplexity.toFixed(2)} |`,
    `| 操作エントロピー | ${latest.operationalEntropy.toFixed(2)} |`,
    `| 要求圧力 | ${latest.demandPressure.toFixed(2)} |`,
    `| 協調負荷 | ${latest.coordinationLoad.toFixed(2)} |`,
    `| **総合** | **${latest.totalEntropy.toFixed(2)}** |`,
    ``,
    `トレンド: ${system.entropy.getTrend().toFixed(3)}`,
  ];

  if (includeHistory) {
    const history = system.entropy.getHistory(historyLimit);
    lines.push(``, `### 履歴 (直近${history.length}件)`);
    history.forEach((h, i) => {
      const date = new Date(h.timestamp).toLocaleTimeString();
      lines.push(`${i + 1}. [${date}] total=${h.totalEntropy.toFixed(1)} (struct=${h.structuralComplexity.toFixed(1)}, ops=${h.operationalEntropy.toFixed(1)}, demand=${h.demandPressure.toFixed(1)}, coord=${h.coordinationLoad.toFixed(1)})`);
    });
  }

  return lines.join("\n");
}

function handleGetPhaseDirective(system: BifurcationSystem): string {
  const directive = system.metaPrompt.getPhaseDirective();
  if (!directive) {
    // まだプロンプトが生成されていない場合、現在の状態から生成
    const profile = system.engine.getCurrentBehaviorProfile();
    const state = system.engine.getCurrentState();
    return system.metaPrompt.generatePrompt(state, profile);
  }
  return directive;
}

function handleReportDemand(system: BifurcationSystem, args: Record<string, unknown>): string {
  const complexity = args.complexity as number;
  const description = args.description as string || "";

  system.entropy.recordInstruction(complexity);

  return `要求圧力を記録: 複雑度=${complexity.toFixed(2)}${description ? ` (${description})` : ""}`;
}

function handleUpdateEnvironment(system: BifurcationSystem, args: Record<string, unknown>): string {
  const update: Record<string, number> = {};

  if (args.automated_farms !== undefined) {
    update.automatedFarms = args.automated_farms as number;
  }
  if (args.structures_built !== undefined) {
    update.structuresBuilt = args.structures_built as number;
  }
  if (args.unique_resource_types !== undefined) {
    update.uniqueResourceTypes = args.unique_resource_types as number;
  }
  if (args.inventory_diversity !== undefined) {
    update.inventoryDiversity = args.inventory_diversity as number;
  }

  system.entropy.updateEnvironment(update);

  const entries = Object.entries(update)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return `環境状態を更新: ${entries}`;
}

function handleForceTransition(system: BifurcationSystem, args: Record<string, unknown>): string {
  const targetState = args.target_state as string;
  const reason = args.reason as string;

  const validStates = ["primitive_survival", "organized_settlement", "industrial_complex"];
  if (!validStates.includes(targetState)) {
    return `無効な状態: ${targetState}. 有効: ${validStates.join(", ")}`;
  }

  const transition = system.engine.forceTransition(
    targetState as import("../types/bifurcation.js").SystemState,
    reason
  );

  if (!transition) {
    return `遷移不要: すでに${targetState}状態です。`;
  }

  return [
    `## 手動相転移を実行`,
    ``,
    `- 遷移元: ${transition.fromState}`,
    `- 遷移先: ${transition.toState}`,
    `- 理由: ${transition.reason}`,
    `- ステータス: ${transition.status}`,
    `- マイグレーション計画: ${transition.migrationPlan.length}アクション`,
    ``,
    `行動規範が「${system.engine.getCurrentBehaviorProfile().phaseName}」モードに更新されました。`,
  ].join("\n");
}

function handleGetLandscape(system: BifurcationSystem): string {
  const metrics = system.entropy.getLatest() || {
    structuralComplexity: 0,
    operationalEntropy: 0,
    demandPressure: 0,
    coordinationLoad: 0,
    totalEntropy: 0,
    timestamp: Date.now(),
  };
  const landscape = system.engine.computeLandscape(metrics);

  const lines: string[] = [
    `## Waddington ポテンシャルランドスケープ`,
    ``,
    `現在のエネルギー: ${landscape.currentEnergy.toFixed(1)}`,
    ``,
    `### 状態エネルギー（正=安定, 負=不安定）`,
  ];

  const stateNames: Record<string, string> = {
    primitive_survival: "原始的サバイバル",
    organized_settlement: "組織化された集落",
    industrial_complex: "工業コンプレックス",
  };

  for (const [state, energy] of Object.entries(landscape.stateEnergies)) {
    const marker = state === landscape.currentState ? " ← 現在" : "";
    const stability = energy > 0 ? "安定" : "不安定";
    lines.push(`  ${stateNames[state] || state}: ${energy.toFixed(1)} (${stability})${marker}`);
  }

  lines.push(``, `### 遷移障壁`);
  for (const barrier of landscape.transitionBarriers) {
    const dir = barrier.from < barrier.to ? "→" : "←";
    const progress = (barrier.currentProgress * 100).toFixed(0);
    const bar = "█".repeat(Math.round(barrier.currentProgress * 10)) +
                "░".repeat(10 - Math.round(barrier.currentProgress * 10));
    lines.push(`  ${stateNames[barrier.from] || barrier.from} ${dir} ${stateNames[barrier.to] || barrier.to}`);
    lines.push(`    障壁: ${barrier.barrierHeight.toFixed(1)} | 進行: [${bar}] ${progress}%`);
  }

  return lines.join("\n");
}

function handleGetTransitionHistory(system: BifurcationSystem, args: Record<string, unknown>): string {
  const limit = args.limit as number || 10;
  const snapshot = system.engine.getSnapshot();
  const history = snapshot.transitionHistory.slice(-limit);

  if (history.length === 0) {
    return "相転移履歴なし。システムは初期状態のまま安定しています。";
  }

  const lines: string[] = [
    `## 相転移履歴 (直近${history.length}件)`,
    ``,
  ];

  history.forEach((t, i) => {
    const date = new Date(t.timestamp).toLocaleString();
    lines.push(`### ${i + 1}. ${t.fromState} → ${t.toState}`);
    lines.push(`- 日時: ${date}`);
    lines.push(`- 理由: ${t.reason}`);
    lines.push(`- トリガーエントロピー: ${t.triggerEntropy.totalEntropy.toFixed(1)}`);
    lines.push(`- ステータス: ${t.status}`);
    lines.push(`- アクション計画: ${t.migrationPlan.length}件`);
    lines.push(``);
  });

  return lines.join("\n");
}
