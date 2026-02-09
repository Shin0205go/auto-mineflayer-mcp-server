/**
 * Bifurcation MCP Tools - 創発的アトラクター発見
 *
 * 事前定義された状態を持たない。
 * エージェントが位相空間上の軌跡とアトラクターを観察・操作するためのツール。
 */

import type { BifurcationSystem } from "../bifurcation/index.js";

// ========== Tool Definitions ==========

export const bifurcationTools = {
  bifurcation_get_landscape: {
    description: "創発的アトラクターランドスケープを取得。発見済みアトラクター、現在位置、各アトラクターとの距離、軌跡の方向と速度を表示。",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  bifurcation_get_current_attractor: {
    description: "現在属しているアトラクター盆地の詳細を取得。null = 未知の領域（新アトラクター形成中の可能性）。",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  bifurcation_get_phase_directive: {
    description: "現在のアトラクターから創発的に導出された行動指示を取得。テンプレートではなく、観測データに基づく統計的ガイドライン。",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  bifurcation_report_demand: {
    description: "人間からの指示を分岐システムに報告。位相空間の「要求圧力」次元に影響する。",
    inputSchema: {
      type: "object" as const,
      properties: {
        complexity: {
          type: "number",
          description: "指示の複雑度 (0.0-1.0)。0=単純(移動), 0.5=中(建築), 1.0=複雑(自動化構築)",
        },
      },
      required: ["complexity"],
    },
  },

  bifurcation_get_trajectory: {
    description: "位相空間上の最近の軌跡を取得。系がどの方向に動いているか、遷移の予兆があるかを確認。",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "取得する軌跡点数（デフォルト: 20）",
        },
      },
    },
  },

  bifurcation_get_transition_history: {
    description: "アトラクター間の遷移履歴を取得。いつ、どの盆地からどこへ遷移し、どの次元の変化が支配的だったかを確認。",
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

  bifurcation_list_attractors: {
    description: "発見済みの全アトラクター一覧を取得。各アトラクターの重心座標、安定性、滞在時間、行動統計を表示。",
    inputSchema: {
      type: "object" as const,
      properties: {},
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
    case "bifurcation_get_landscape":
      return handleGetLandscape(system);

    case "bifurcation_get_current_attractor":
      return handleGetCurrentAttractor(system);

    case "bifurcation_get_phase_directive":
      return handleGetPhaseDirective(system);

    case "bifurcation_report_demand":
      return handleReportDemand(system, args);

    case "bifurcation_get_trajectory":
      return handleGetTrajectory(system, args);

    case "bifurcation_get_transition_history":
      return handleGetTransitionHistory(system, args);

    case "bifurcation_list_attractors":
      return handleListAttractors(system);

    default:
      return `Unknown bifurcation tool: ${toolName}`;
  }
}

// ========== Handler Implementations ==========

function handleGetLandscape(system: BifurcationSystem): string {
  const landscape = system.landscape.getLandscape();
  const dims = system.observer.getDimensions();
  const lines: string[] = [];

  lines.push(`## 創発的アトラクターランドスケープ`);
  lines.push(``);

  // 現在位置
  const posStr = landscape.currentPosition
    .map((v, i) => `${dims[i]?.name || `d${i}`}=${v.toFixed(2)}`)
    .filter((_, i) => landscape.currentPosition[i] > 0.1)
    .join(", ");
  lines.push(`**現在位置**: ${posStr || "(原点付近)"}`);
  lines.push(`**現在のアトラクター**: ${landscape.currentAttractorId || "なし（未知領域）"}`);
  lines.push(`**軌跡速度**: ${landscape.trajectorySpeed.toFixed(4)} (${landscape.trajectorySpeed < 0.05 ? "安定" : landscape.trajectorySpeed < 0.15 ? "変動中" : "急速変化"})`);
  lines.push(``);

  // 発見済みアトラクター
  lines.push(`### 発見済みアトラクター: ${landscape.attractors.length}個`);
  if (landscape.attractors.length === 0) {
    lines.push(`まだアトラクターは発見されていません。系が安定するまで観測を続けます。`);
  }
  for (const a of landscape.attractors) {
    const dist = landscape.distancesToAttractors.find(d => d.attractorId === a.id);
    const marker = landscape.currentAttractorId === a.id ? " ← 現在" : "";
    lines.push(`- **${a.id}**: 距離=${dist?.distance.toFixed(3) || "?"}, 安定性=${(a.stability / 1000).toFixed(1)}s, 観測=${a.sampleCount}${marker}`);
  }
  lines.push(``);

  // 軌跡の方向
  const dirStr = landscape.trajectoryDirection
    .map((v, i) => ({ name: dims[i]?.name || `d${i}`, value: v }))
    .filter(d => Math.abs(d.value) > 0.2)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 5)
    .map(d => `${d.name}:${d.value > 0 ? "+" : ""}${d.value.toFixed(2)}`)
    .join(", ");
  if (dirStr) {
    lines.push(`**軌跡の方向**: ${dirStr}`);
  }

  return lines.join("\n");
}

function handleGetCurrentAttractor(system: BifurcationSystem): string {
  const attractor = system.landscape.getCurrentAttractor();
  const dims = system.observer.getDimensions();

  if (!attractor) {
    return [
      `## 現在のアトラクター: なし`,
      ``,
      `系は既知のアトラクター盆地の外にいます。`,
      `新しい安定状態が形成されつつある可能性があります。`,
      ``,
      `観測を続けると、系が十分な時間留まった領域が`,
      `新しいアトラクターとして自動的に発見されます。`,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`## 現在のアトラクター: ${attractor.id}`);
  lines.push(``);

  // 重心の記述
  const centroidStr = attractor.centroid
    .map((v, i) => ({ name: dims[i]?.name || `d${i}`, value: v }))
    .filter(d => d.value > 0.2)
    .sort((a, b) => b.value - a.value)
    .map(d => `${d.name}=${d.value.toFixed(2)}`)
    .join(", ");
  lines.push(`**重心**: ${centroidStr || "(低活動)"}`);
  lines.push(`**発見日時**: ${new Date(attractor.discoveredAt).toLocaleString()}`);
  lines.push(`**観測数**: ${attractor.sampleCount}`);
  lines.push(`**安定性**: ${(attractor.stability / 1000).toFixed(1)}秒/観測`);
  lines.push(`**滞在時間**: ${(attractor.totalResidenceTime / 60000).toFixed(1)}分`);
  lines.push(``);

  // 行動統計
  const stats = attractor.behaviorStats;
  if (stats.topTools.length > 0) {
    lines.push(`### 頻用ツール`);
    stats.topTools.slice(0, 5).forEach(t => {
      lines.push(`- \`${t.tool}\`: ${t.frequency}回 (成功率: ${(t.successRate * 100).toFixed(0)}%)`);
    });
    lines.push(``);
  }

  if (stats.problematicTools.length > 0) {
    lines.push(`### 問題ツール`);
    stats.problematicTools.forEach(t => {
      lines.push(`- ⚠ \`${t.tool}\`: 失敗率 ${(t.failureRate * 100).toFixed(0)}% (${t.count}回)`);
    });
  }

  return lines.join("\n");
}

function handleGetPhaseDirective(system: BifurcationSystem): string {
  const directive = system.metaPrompt.getPhaseDirective();
  if (!directive) {
    const attractor = system.landscape.getCurrentAttractor();
    if (attractor) {
      return system.metaPrompt.generateFromAttractor(
        attractor,
        system.observer.getDimensions()
      );
    }
    return system.metaPrompt.generateFromAttractor(
      null,
      system.observer.getDimensions(),
      "初回起動 — アトラクター未発見"
    );
  }
  return directive;
}

function handleReportDemand(system: BifurcationSystem, args: Record<string, unknown>): string {
  const complexity = args.complexity as number;
  system.observer.recordInstruction(complexity);
  return `要求圧力を記録: 複雑度=${complexity.toFixed(2)}`;
}

function handleGetTrajectory(system: BifurcationSystem, args: Record<string, unknown>): string {
  const limit = (args.limit as number) || 20;
  const snapshot = system.landscape.getSnapshot();
  const points = snapshot.recentTrajectory.slice(-limit);
  const dims = system.observer.getDimensions();

  if (points.length === 0) {
    return "軌跡データなし。システムがまだ計測を開始していません。";
  }

  const lines: string[] = [];
  lines.push(`## 位相空間軌跡 (直近${points.length}点)`);
  lines.push(``);

  // 各点のサマリー
  points.forEach((p, idx) => {
    const time = new Date(p.timestamp).toLocaleTimeString();
    const significant = p.coordinates
      .map((v, i) => ({ name: dims[i]?.name || `d${i}`, value: v }))
      .filter(d => d.value > 0.3)
      .sort((a, b) => b.value - a.value)
      .slice(0, 4)
      .map(d => `${d.name}=${d.value.toFixed(2)}`)
      .join(", ");
    lines.push(`${idx + 1}. [${time}] ${significant || "(低活動)"}`);
  });

  return lines.join("\n");
}

function handleGetTransitionHistory(system: BifurcationSystem, args: Record<string, unknown>): string {
  const limit = (args.limit as number) || 10;
  const history = system.landscape.getTransitionHistory(limit);

  if (history.length === 0) {
    return "遷移履歴なし。アトラクター間の遷移はまだ発生していません。";
  }

  const lines: string[] = [];
  lines.push(`## アトラクター間遷移履歴 (直近${history.length}件)`);
  lines.push(``);

  history.forEach((t, i) => {
    const time = new Date(t.timestamp).toLocaleString();
    const from = t.fromAttractorId || "unknown";
    const to = t.toAttractorId || "unknown";
    lines.push(`### ${i + 1}. ${from} → ${to}`);
    lines.push(`- 日時: ${time}`);
    if (t.dominantDimensions.length > 0) {
      lines.push(`- 支配的変化次元:`);
      t.dominantDimensions.forEach(d => {
        lines.push(`  - ${d.name}: Δ${d.delta.toFixed(3)}`);
      });
    }
    if (t.externalTrigger) {
      lines.push(`- 外部トリガー: ${t.externalTrigger}`);
    }
    lines.push(``);
  });

  return lines.join("\n");
}

function handleListAttractors(system: BifurcationSystem): string {
  const landscape = system.landscape.getLandscape();
  const dims = system.observer.getDimensions();

  if (landscape.attractors.length === 0) {
    return [
      `## 発見済みアトラクター: 0個`,
      ``,
      `系はまだ安定状態を発見していません。`,
      `観測を続けると、系が十分な時間留まった領域が`,
      `自動的にアトラクターとして認識されます。`,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`## 発見済みアトラクター: ${landscape.attractors.length}個`);
  lines.push(``);

  for (const a of landscape.attractors) {
    const isCurrent = landscape.currentAttractorId === a.id;
    lines.push(`### ${a.id}${isCurrent ? " (現在)" : ""}`);

    // 重心の支配的次元
    const dominant = a.centroid
      .map((v, i) => ({ name: dims[i]?.name || `d${i}`, value: v }))
      .filter(d => d.value > 0.3)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    if (dominant.length > 0) {
      lines.push(`重心: ${dominant.map(d => `${d.name}=${d.value.toFixed(2)}`).join(", ")}`);
    }

    lines.push(`観測: ${a.sampleCount}回 | 安定性: ${(a.stability / 1000).toFixed(1)}s | 滞在: ${(a.totalResidenceTime / 60000).toFixed(1)}分`);
    lines.push(`発見: ${new Date(a.discoveredAt).toLocaleString()} | 最終訪問: ${new Date(a.lastVisited).toLocaleString()}`);

    // 分散（盆地の広さ）
    const avgVar = a.variance.reduce((s, v) => s + v, 0) / a.variance.length;
    lines.push(`盆地の広さ: ${avgVar < 0.01 ? "狭い(安定)" : avgVar < 0.05 ? "中程度" : "広い(変動的)"} (平均分散: ${avgVar.toFixed(4)})`);

    lines.push(``);
  }

  return lines.join("\n");
}
