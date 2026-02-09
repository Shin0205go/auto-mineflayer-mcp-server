/**
 * Meta-Prompt Manager - 創発的行動規範の生成
 *
 * テンプレートを使わない。
 * 発見されたアトラクターの統計的特徴から、
 * 行動規範（System Prompt）を動的に生成する。
 *
 * 生物学アナロジー: エピジェネティック制御。
 * 同じDNA（コードベース）でも、環境シグナルに応じて
 * 遺伝子発現パターン（行動規範）が変化する。
 * しかし発現パターンは設計されるのではなく、
 * 環境との相互作用から創発する。
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type {
  Attractor,
  EmergentBehaviorStats,
  PhaseDimension,
} from "../types/bifurcation.js";

const DATA_DIR = join(process.cwd(), "bifurcation");
const PROMPT_FILE = join(DATA_DIR, "active-prompt.md");
const PROMPT_HISTORY_FILE = join(DATA_DIR, "prompt-history.jsonl");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

interface PromptUpdateRecord {
  timestamp: number;
  attractorId: string | null;
  prompt: string;
  reason: string;
}

export class MetaPromptManager {
  private currentPrompt: string = "";
  private currentAttractorId: string | null = null;
  private updateHistory: PromptUpdateRecord[] = [];

  constructor() {
    this.restore();
  }

  /**
   * アトラクター遷移に伴いSystem Promptを再生成
   *
   * テンプレートを使わず、アトラクターの統計的特徴から
   * 行動規範を動的に導出する。
   */
  generateFromAttractor(
    attractor: Attractor | null,
    dimensions: PhaseDimension[],
    reason?: string
  ): string {
    const previousId = this.currentAttractorId;

    if (!attractor) {
      // 未知の領域 — 探索的な行動を促す
      const prompt = this.buildExploratoryPrompt(reason);
      this.update(null, prompt, reason || "未知の領域に遷移");
      return prompt;
    }

    const prompt = this.buildEmergentPrompt(attractor, dimensions, reason);
    this.update(attractor.id, prompt, reason || `アトラクター ${attractor.id} への遷移`);

    return prompt;
  }

  /**
   * 現在のアクティブプロンプトを取得
   */
  getCurrentPrompt(): string {
    return this.currentPrompt;
  }

  /**
   * 現在のフェーズに対応する追加指示を取得
   */
  getPhaseDirective(): string {
    if (!this.currentPrompt) {
      return "";
    }
    return `\n## 現在のフェーズ指示（創発的に導出）\n${this.currentPrompt}\n`;
  }

  /**
   * 更新履歴を取得
   */
  getHistory(limit?: number): PromptUpdateRecord[] {
    if (limit) return this.updateHistory.slice(-limit);
    return [...this.updateHistory];
  }

  // ========== Emergent Prompt Generation ==========

  /**
   * アトラクターの統計的特徴からプロンプトを生成
   *
   * 何が書かれるかは、系の過去の振る舞いによって決まる。
   * 設計者が事前に内容を知ることはできない。
   */
  private buildEmergentPrompt(
    attractor: Attractor,
    dimensions: PhaseDimension[],
    reason?: string
  ): string {
    const stats = attractor.behaviorStats;
    const sections: string[] = [];

    // ヘッダー: アトラクターの統計的アイデンティティ
    sections.push(`# 現在の安定状態: ${attractor.id}`);
    sections.push(`> この行動規範はシステムの観測データから自動的に導出されたものです。`);
    sections.push(`> 事前定義されたテンプレートではありません。`);
    sections.push(``);

    if (reason) {
      sections.push(`**遷移理由**: ${reason}`);
      sections.push(``);
    }

    // アトラクターの特性記述
    sections.push(`## この安定状態の特徴`);
    sections.push(this.describeAttractorCharacter(attractor, dimensions));
    sections.push(``);

    // 成功パターン: 高い成功率のツール → 優先行動
    if (stats.topTools.length > 0) {
      sections.push(`## 効果的な行動（この状態で成功率が高い）`);
      const effective = stats.topTools
        .filter(t => t.successRate > 0.6)
        .slice(0, 8);
      if (effective.length > 0) {
        effective.forEach(t => {
          sections.push(`- \`${t.tool}\` (成功率: ${(t.successRate * 100).toFixed(0)}%, 使用回数: ${t.frequency})`);
        });
      } else {
        sections.push(`- まだ十分なデータがありません。様々な行動を試してください。`);
      }
      sections.push(``);
    }

    // 問題パターン: 高い失敗率のツール → 回避行動
    if (stats.problematicTools.length > 0) {
      sections.push(`## 注意が必要な行動（この状態で失敗しやすい）`);
      stats.problematicTools.forEach(t => {
        sections.push(`- ⚠ \`${t.tool}\` (失敗率: ${(t.failureRate * 100).toFixed(0)}%, 試行: ${t.count}回)`);
      });
      sections.push(``);
    }

    // 環境認識
    sections.push(`## 環境状態`);
    sections.push(`- 資源多様性: ${(stats.avgResourceDiversity * 100).toFixed(0)}%`);
    sections.push(`- HP安定性: ${(stats.avgHealthStability * 100).toFixed(0)}%`);
    sections.push(`- 安定性スコア: ${(attractor.stability / 1000).toFixed(1)}秒/観測`);
    sections.push(`- 総滞在時間: ${(attractor.totalResidenceTime / 60000).toFixed(1)}分`);
    sections.push(`- 観測数: ${attractor.sampleCount}`);
    sections.push(``);

    // 意思決定ガイドライン（統計ベース）
    sections.push(`## 意思決定ガイドライン`);
    sections.push(this.generateDecisionGuidelines(attractor, dimensions));

    return sections.join("\n");
  }

  /**
   * 未知の領域にいる時の探索的プロンプト
   */
  private buildExploratoryPrompt(reason?: string): string {
    const sections: string[] = [];

    sections.push(`# 現在の状態: 未知の領域`);
    sections.push(`> 系は既知のアトラクター盆地の外にいます。`);
    sections.push(`> 新しい安定状態が形成されつつある可能性があります。`);
    sections.push(``);

    if (reason) {
      sections.push(`**遷移理由**: ${reason}`);
      sections.push(``);
    }

    sections.push(`## 推奨行動`);
    sections.push(`- 状況確認を最優先: \`minecraft_get_status\`, \`minecraft_get_surroundings\``);
    sections.push(`- 安全の確保: HPと食料の確認`);
    sections.push(`- 探索的行動: 新しい方法を試みることで、系は新しい安定状態を発見できる`);
    sections.push(`- 経験の記録: \`log_experience\` で行動と結果を記録`);
    sections.push(``);
    sections.push(`## 注意`);
    sections.push(`- 既知のパターンに固執しないこと`);
    sections.push(`- 失敗は情報。回避するのではなく、何が変化したかを観察する`);

    return sections.join("\n");
  }

  /**
   * アトラクターの位相座標から特性を自然言語で記述
   */
  private describeAttractorCharacter(
    attractor: Attractor,
    dimensions: PhaseDimension[]
  ): string {
    const centroid = attractor.centroid;
    const characteristics: string[] = [];

    // 高い次元（0.5以上）を特徴として抽出
    const high = centroid
      .map((v, i) => ({ name: dimensions[i]?.name || `dim_${i}`, value: v }))
      .filter(d => d.value > 0.5)
      .sort((a, b) => b.value - a.value);

    // 低い次元（0.2以下）も特徴
    const low = centroid
      .map((v, i) => ({ name: dimensions[i]?.name || `dim_${i}`, value: v }))
      .filter(d => d.value < 0.2)
      .sort((a, b) => a.value - b.value);

    if (high.length > 0) {
      characteristics.push(`**顕著な特徴**: ${high.map(d => this.dimensionToHuman(d.name, d.value)).join(", ")}`);
    }
    if (low.length > 0) {
      characteristics.push(`**低い特徴**: ${low.map(d => this.dimensionToHuman(d.name, d.value)).join(", ")}`);
    }

    // 分散から安定性を評価
    const avgVariance = attractor.variance.reduce((s, v) => s + v, 0) / attractor.variance.length;
    if (avgVariance < 0.01) {
      characteristics.push(`**安定性**: 非常に安定した状態（低分散）`);
    } else if (avgVariance < 0.05) {
      characteristics.push(`**安定性**: 適度に安定`);
    } else {
      characteristics.push(`**安定性**: 変動が大きい（高分散）— 遷移の前兆かもしれません`);
    }

    return characteristics.join("\n");
  }

  /**
   * 次元名を人間が読める記述に変換
   */
  private dimensionToHuman(name: string, value: number): string {
    const level = value > 0.7 ? "高" : value > 0.4 ? "中" : "低";
    const descriptions: Record<string, string> = {
      tool_failure_rate: `ツール失敗率(${level})`,
      tool_diversity: `ツール多様性(${level})`,
      tool_throughput: `ツール処理量(${level})`,
      repeated_failures: `連続失敗(${level})`,
      exploration_radius: `探索範囲(${level})`,
      combat_frequency: `戦闘頻度(${level})`,
      crafting_frequency: `クラフト頻度(${level})`,
      building_frequency: `建築頻度(${level})`,
      inventory_diversity: `資源多様性(${level})`,
      resource_surplus: `資源余剰(${level})`,
      health_stability: `HP安定性(${level})`,
      death_frequency: `死亡頻度(${level})`,
      demand_rate: `要求頻度(${level})`,
      demand_complexity: `要求複雑度(${level})`,
      agent_count: `エージェント数(${level})`,
      message_rate: `メッセージ頻度(${level})`,
    };
    return descriptions[name] || `${name}(${level})`;
  }

  /**
   * 統計ベースの意思決定ガイドラインを生成
   */
  private generateDecisionGuidelines(
    attractor: Attractor,
    dimensions: PhaseDimension[]
  ): string {
    const centroid = attractor.centroid;
    const guidelines: string[] = [];

    // 各次元の値に基づいて動的にガイドラインを生成
    const dimMap = new Map(dimensions.map((d, i) => [d.name, centroid[i] || 0]));

    const failureRate = dimMap.get("tool_failure_rate") || 0;
    const healthStab = dimMap.get("health_stability") || 1;
    const deathFreq = dimMap.get("death_frequency") || 0;
    const combatFreq = dimMap.get("combat_frequency") || 0;
    const buildingFreq = dimMap.get("building_frequency") || 0;
    const resourceSurplus = dimMap.get("resource_surplus") || 0;

    if (failureRate > 0.4) {
      guidelines.push(`- ツール失敗率が高い状態。行動前に前提条件（材料、位置、装備）を確認すること`);
    }

    if (healthStab < 0.5) {
      guidelines.push(`- HP不安定。食料・装備の確保を優先し、リスクの高い行動を控えること`);
    }

    if (deathFreq > 0.3) {
      guidelines.push(`- 死亡頻度が観測されている。安全確保を最優先に`);
    }

    if (combatFreq > 0.3) {
      guidelines.push(`- 戦闘頻度が高い。装備の維持と食料の備蓄を意識すること`);
    }

    if (buildingFreq > 0.3) {
      guidelines.push(`- 建築活動が活発。材料の事前確保と計画的な構造設計を心がけること`);
    }

    if (resourceSurplus > 0.6) {
      guidelines.push(`- 資源に余裕がある。より複雑なプロジェクトへの着手が可能`);
    } else if (resourceSurplus < 0.2) {
      guidelines.push(`- 資源が不足気味。基本資源の確保を優先すること`);
    }

    if (guidelines.length === 0) {
      guidelines.push(`- データ不足。多様な行動を試み、観測データを蓄積すること`);
    }

    return guidelines.join("\n");
  }

  // ========== Internal ==========

  private update(attractorId: string | null, prompt: string, reason: string): void {
    this.currentAttractorId = attractorId;
    this.currentPrompt = prompt;

    const record: PromptUpdateRecord = {
      timestamp: Date.now(),
      attractorId,
      prompt,
      reason,
    };
    this.updateHistory.push(record);

    this.persist(record);

    console.log(`[MetaPrompt] Updated for attractor: ${attractorId || "unknown"}`);
  }

  private persist(record: PromptUpdateRecord): void {
    try {
      ensureDataDir();
      writeFileSync(PROMPT_FILE, this.currentPrompt);
      writeFileSync(
        PROMPT_HISTORY_FILE,
        JSON.stringify(record) + "\n",
        { flag: "a" }
      );
    } catch (e) {
      console.error("[MetaPrompt] Persist failed:", e);
    }
  }

  private restore(): void {
    try {
      if (existsSync(PROMPT_FILE)) {
        this.currentPrompt = readFileSync(PROMPT_FILE, "utf-8");
      }
    } catch {
      // 初回起動
    }
  }
}
